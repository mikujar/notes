import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useAppChrome } from "./i18n/useAppChrome";
import { useAppUiLang } from "./appUiLang";
import type { AppDataMode } from "./appDataModeStorage";
import type { NewNotePlacement } from "./newNotePlacementStorage";
import type {
  AutoLinkRule,
  Collection,
  CollectionCardSchema,
  SchemaField,
  UserNotePrefs,
} from "./types";
import {
  PRESET_OBJECT_TYPES_GROUPS,
  buildSchemaFromPreset,
  findPresetGroupChildForCatalogId,
  listPresetAutoLinkRulesForSettings,
  presetTypeParentCard,
  type PresetObjectTypeItem,
  type PresetTypeGroup,
} from "./notePresetTypesCatalog";
import {
  createCollectionApi,
  enablePresetTypeApi,
  updateCollectionApi,
  deleteCollectionApi,
  migrateAttachmentsApi,
  migrateRelatedRefsJsonApi,
  migrateClipTaggedNotesApi,
  backfillMediaThumbnailsApi,
  type BackfillMediaThumbnailsResult,
  fetchMeNotePrefs,
  putMeNotePrefs,
  postAutoLinkRuleBackfillApi,
} from "./api/collections";
import { loadLocalNotePrefs, saveLocalNotePrefs } from "./notePrefsStorage";
import {
  walkCollections,
  walkCollectionsWithPath,
} from "./appkit/collectionModel";
import { mergedTemplateSchemaFieldsForCollection } from "./appkit/schemaTemplateFields";
import { NOTE_SETTINGS_POST_MIGRATE_HINTS } from "./noteSettingsPostMigrateHints";

const CATALOG_PRESET_IDS: Set<string> = (() => {
  const s = new Set<string>();
  for (const g of PRESET_OBJECT_TYPES_GROUPS) {
    s.add(g.baseId);
    for (const ch of g.children) s.add(ch.id);
  }
  return s;
})();

function collectionIdFromEnablePresetResponse(
  res: Collection | { alreadyExists: true; id: string } | null
): string | null {
  if (!res || typeof res !== "object" || !("id" in res)) return null;
  const id = (res as { id: string }).id;
  return typeof id === "string" && id.trim() ? id : null;
}

function findParentOfCollectionId(
  roots: Collection[],
  targetId: string
): Collection | null {
  for (const c of roots) {
    if (c.children?.some((ch) => ch.id === targetId)) return c;
    if (c.children?.length) {
      const r = findParentOfCollectionId(c.children, targetId);
      if (r) return r;
    }
  }
  return null;
}

function catalogGroupBaseForPresetId(presetId: string): string | null {
  const p = presetId.trim();
  if (!p) return null;
  for (const g of PRESET_OBJECT_TYPES_GROUPS) {
    if (g.baseId === p) return g.baseId;
    if (g.children.some((c) => c.id === p)) return g.baseId;
  }
  return null;
}

function dotColorFromName(name: string): string {
  let h = 0;
  const s = name.trim() || "x";
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsla(${hue}, 52%, 90%, 0.95)`;
}

const CUSTOM_SCHEMA_TYPE_OPTIONS: SchemaField["type"][] = [
  "text",
  "url",
  "number",
  "date",
  "checkbox",
  "cardLink",
  "cardLinks",
  "collectionLink",
];

type NoteSettingsPanel = "general" | "objectTypes" | "autoLink";

const CLIP_PRESET_CUSTOM_RULE_IDS = new Set(["xhs-auto-graph", "bili-auto-graph"]);

const CLIP_PRESET_CUSTOM_RULE_TEMPLATES: AutoLinkRule[] = [
  {
    ruleId: "xhs-auto-graph",
    trigger: "on_save",
    sourcePresetTypeId: "post_xhs",
    targetObjectKind: "person",
    targetPresetTypeId: "person",
    syncSchemaFieldId: "sf-xhs-author",
    linkType: "creator",
    labelZh: "小红书作者自动关联人物卡",
    labelEn: "XHS creator auto-link to Person",
  },
  {
    ruleId: "bili-auto-graph",
    trigger: "on_save",
    sourcePresetTypeId: "post_bilibili",
    targetObjectKind: "person",
    targetPresetTypeId: "person",
    syncSchemaFieldId: "sf-bili-author",
    linkType: "creator",
    labelZh: "B 站 UP 主自动关联人物卡",
    labelEn: "Bilibili uploader auto-link to Person",
  },
];

function flattenCollectionsForPicker(
  cols: Collection[] | undefined,
  prefix = ""
): { id: string; label: string }[] {
  if (!cols?.length) return [];
  const out: { id: string; label: string }[] = [];
  for (const c of cols) {
    const label = prefix ? `${prefix} / ${c.name}` : c.name;
    out.push({ id: c.id, label });
    if (c.children?.length) {
      out.push(...flattenCollectionsForPicker(c.children, label));
    }
  }
  return out;
}

/** 沿父链合并 card_schema，只取「关联卡片」类型字段（单卡/多卡） */
function mergedCardLinkFieldsForCollection(
  colId: string,
  roots: Collection[] | undefined
): SchemaField[] {
  if (!colId.trim() || !roots?.length) return [];
  return mergedTemplateSchemaFieldsForCollection(roots, colId)
    .filter((f) => f.type === "cardLink" || f.type === "cardLinks")
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** 源字段可用范围：关联字段 + 文本字段（用于“先填文字再自动建卡”） */
function mergedAutoLinkSourceFieldsForCollection(
  colId: string,
  roots: Collection[] | undefined
): SchemaField[] {
  if (!colId.trim() || !roots?.length) return [];
  const templateFields = mergedTemplateSchemaFieldsForCollection(roots, colId)
    .filter(
      (f) => f.type === "cardLink" || f.type === "cardLinks" || f.type === "text"
    )
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const sourceCol = findCollectionById(roots, colId);
  const observed = new Map<string, SchemaField>();
  for (const card of sourceCol?.cards ?? []) {
    const props = Array.isArray(card?.customProps) ? card.customProps : [];
    for (const p of props) {
      if (!p || typeof p !== "object") continue;
      const id = typeof p.id === "string" ? p.id.trim() : "";
      if (!id) continue;
      if (p.type !== "cardLink" && p.type !== "cardLinks" && p.type !== "text") {
        continue;
      }
      if (observed.has(id)) continue;
      observed.set(id, {
        id,
        name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : id,
        type: p.type,
        order: 9999,
      });
    }
  }
  const out: SchemaField[] = [];
  const seen = new Set<string>();
  for (const f of templateFields) {
    if (!f?.id || seen.has(f.id)) continue;
    out.push(f);
    seen.add(f.id);
  }
  for (const f of observed.values()) {
    if (!f?.id || seen.has(f.id)) continue;
    out.push(f);
    seen.add(f.id);
  }
  return out;
}

function findCollectionById(
  roots: Collection[] | undefined,
  id: string
): Collection | null {
  if (!roots) return null;
  for (const c of roots) {
    if (c.id === id) return c;
    const sub = findCollectionById(c.children, id);
    if (sub) return sub;
  }
  return null;
}

function summarizeCustomAutoLinkRule(
  rule: AutoLinkRule,
  lang: "zh" | "en"
): string {
  if (rule.labelZh?.trim() || rule.labelEn?.trim()) {
    return lang === "en"
      ? (rule.labelEn ?? rule.labelZh ?? rule.ruleId)
      : (rule.labelZh ?? rule.labelEn ?? rule.ruleId);
  }
  const parts: string[] = [];
  if (rule.sourceCollectionId)
    parts.push(lang === "en" ? `from col ${rule.sourceCollectionId}` : `源合集 ${rule.sourceCollectionId}`);
  if (rule.sourceObjectKind)
    parts.push(lang === "en" ? `kind ${rule.sourceObjectKind}` : `形态 ${rule.sourceObjectKind}`);
  if (rule.sourcePresetTypeId)
    parts.push(lang === "en" ? `preset ${rule.sourcePresetTypeId}` : `预设 ${rule.sourcePresetTypeId}`);
  const cond = parts.length ? parts.join(lang === "en" ? "; " : "，") : "—";
  const tgt = rule.targetObjectKind ?? "?";
  const place =
    rule.targetCollectionId ??
    (rule.targetPresetTypeId
      ? lang === "en"
        ? `preset:${rule.targetPresetTypeId}`
        : `预设:${rule.targetPresetTypeId}`
      : "?");
  const lt = rule.linkType ?? "related";
  return lang === "en"
    ? `If ${cond} → ${tgt} in ${place} (${lt})`
    : `若 ${cond} → 新建 ${tgt} 至 ${place}（${lt}）`;
}

function summarizeClipPresetCustomRule(
  rule: AutoLinkRule,
  collectionPickerOptions: { id: string; label: string }[],
  enabledByPresetTypeId: Map<string, Collection>,
  lang: "zh" | "en"
): string {
  const isXhs = rule.ruleId === "xhs-auto-graph";
  const isBili = rule.ruleId === "bili-auto-graph";
  if (!isXhs && !isBili) return summarizeCustomAutoLinkRule(rule, lang);
  const byId = new Map(collectionPickerOptions.map((x) => [x.id, x.label]));
  const sourcePresetTypeId = isXhs ? "post_xhs" : "post_bilibili";
  const sourceColId = enabledByPresetTypeId.get(sourcePresetTypeId)?.id ?? "";
  const sourceColLabelFromTree = sourceColId ? byId.get(sourceColId) : "";
  const sourceColLabelFromCatalog = (() => {
    const ctx = findPresetGroupChildForCatalogId(sourcePresetTypeId);
    if (!ctx?.child) return sourcePresetTypeId;
    return lang === "en"
      ? `${ctx.group.baseLabelEn} / ${ctx.child.nameEn}`
      : `${ctx.group.baseLabelZh} / ${ctx.child.nameZh}`;
  })();
  const srcCol = sourceColLabelFromTree || sourceColLabelFromCatalog;
  const srcProp = isXhs
    ? lang === "en"
      ? "Author"
      : "作者"
    : lang === "en"
      ? "Uploader"
      : "UP主";
  const targetLabel =
    collectionPickerOptions.find((x) => x.id === (rule.targetCollectionId ?? ""))?.label ||
    (() => {
      const personColId = enabledByPresetTypeId.get("person")?.id ?? "";
      if (personColId && byId.has(personColId)) return byId.get(personColId)!;
      const personCtx = findPresetGroupChildForCatalogId("person");
      if (personCtx?.child) {
        return lang === "en"
          ? `${personCtx.group.baseLabelEn} / ${personCtx.child.nameEn}`
          : `${personCtx.group.baseLabelZh} / ${personCtx.child.nameZh}`;
      }
      return lang === "en" ? "Person" : "人物";
    })();
  const targetProp = lang === "en" ? "Works" : "作品";
  return lang === "en"
    ? `${srcCol} · ${srcProp} ↔ ${targetLabel} · ${targetProp}`
    : `${srcCol}·${srcProp} ↔ ${targetLabel}·${targetProp}`;
}

function summarizeCompactCustomRule(
  rule: AutoLinkRule,
  collections: Collection[] | undefined,
  collectionPickerOptions: { id: string; label: string }[],
  lang: "zh" | "en"
): string {
  const srcColId = String(rule.sourceCollectionId ?? "").trim();
  const tgtColId = String(rule.targetCollectionId ?? "").trim();
  const srcFieldId = String(rule.syncSchemaFieldId ?? "").trim();
  const tgtFieldId = String(rule.targetSyncSchemaFieldId ?? "").trim();
  if (!srcColId || !tgtColId || !srcFieldId || !tgtFieldId) {
    return summarizeCustomAutoLinkRule(rule, lang);
  }
  const byId = new Map(collectionPickerOptions.map((x) => [x.id, x.label]));
  const srcColLabel = byId.get(srcColId) ?? srcColId;
  const tgtColLabel = byId.get(tgtColId) ?? tgtColId;
  const roots = collections ?? [];
  const srcFieldName =
    mergedTemplateSchemaFieldsForCollection(roots, srcColId).find(
      (f) => f.id === srcFieldId
    )?.name ?? srcFieldId;
  const tgtFieldName =
    mergedTemplateSchemaFieldsForCollection(roots, tgtColId).find(
      (f) => f.id === tgtFieldId
    )?.name ?? tgtFieldId;
  return lang === "en"
    ? `${srcColLabel} · ${srcFieldName} ↔ ${tgtColLabel} · ${tgtFieldName}`
    : `${srcColLabel}·${srcFieldName} ↔ ${tgtColLabel}·${tgtFieldName}`;
}

type NoteSettingsModalProps = {
  open: boolean;
  onClose: () => void;
  newNotePlacement: NewNotePlacement;
  setNewNotePlacement: (p: NewNotePlacement) => void;
  hideSidebarCollectionDots: boolean;
  setHideSidebarCollectionDots: (hide: boolean) => void;
  timelineFoldBodyThreeLines: boolean;
  setTimelineFoldBodyThreeLines: (on: boolean) => void;
  dataMode: AppDataMode;
  setDataMode: (mode: AppDataMode) => void;
  onOpenAppleNotesImport?: () => void;
  onOpenFlomoImport?: () => void;
  onOpenEvernoteImport?: () => void;
  onOpenYuqueImport?: () => void;
  /** 传入时，对象类型面板变为可交互（启用/禁用预设类型） */
  collections?: Collection[];
  /** 刷新合集树（启用/禁用类型后调用）；启用时可传入新合集 id 与 presetTypeId 以同步展开侧栏 */
  onCollectionsChange?: (
    ctx?: { enabledCollectionId?: string; presetTypeId?: string }
  ) => void | Promise<void>;
  /** 一键清除空白卡片（确认与提示由父组件处理） */
  onPurgeBlankCards?: () => void | Promise<void>;
  /** 笔记偏好写入本地/云端后通知父组件（如同步时间线附件左右栏） */
  onNotePrefsApplied?: (prefs: UserNotePrefs) => void;
  /** 文件卡：将正文首行/附件名写入属性「标题」 */
  onMigrateFileCardTitles?: () => Promise<{
    fileCards: number;
    eligible: number;
    updated: number;
    failed: number;
  } | null>;
};

function PresetTypeCard({
  item,
  label,
}: {
  item: PresetObjectTypeItem;
  label: string;
}) {
  return (
    <div className="note-settings-modal__preset-card" role="presentation" title={label}>
      <span
        className="note-settings-modal__preset-icon"
        style={{ background: item.tint }}
        aria-hidden
      >
        <span className="note-settings-modal__preset-emoji">{item.emoji}</span>
      </span>
      <span className="note-settings-modal__preset-name">{label}</span>
    </div>
  );
}


export function NoteSettingsModal({
  open,
  onClose,
  newNotePlacement,
  setNewNotePlacement,
  hideSidebarCollectionDots,
  setHideSidebarCollectionDots,
  timelineFoldBodyThreeLines,
  setTimelineFoldBodyThreeLines,
  dataMode,
  setDataMode,
  onOpenAppleNotesImport,
  onOpenFlomoImport,
  onOpenEvernoteImport,
  onOpenYuqueImport,
  collections,
  onCollectionsChange,
  onPurgeBlankCards,
  onNotePrefsApplied,
  onMigrateFileCardTitles,
}: NoteSettingsModalProps) {
  const c = useAppChrome();
  const { lang } = useAppUiLang();
  const [importSource, setImportSource] = useState<
    "" | "apple" | "flomo" | "evernote" | "yuque"
  >("");
  const [typeActionLoading, setTypeActionLoading] = useState<string | null>(null);
  const [migrateResult, setMigrateResult] = useState<{
    processed: number; created: number; skipped: number;
  } | null>(null);
  const [migrateLoading, setMigrateLoading] = useState(false);
  const [relatedRefsMigrateResult, setRelatedRefsMigrateResult] = useState<{
    withJson: number;
    migrated: number;
  } | null>(null);
  const [relatedRefsMigrateLoading, setRelatedRefsMigrateLoading] =
    useState(false);
  const [clipTaggedMigrateResult, setClipTaggedMigrateResult] = useState<{
    scanned: number;
    migrated: number;
    skippedNoPreset: number;
    skippedNoKind: number;
    errors: number;
    backfillTitles?: number;
  } | null>(null);
  const [clipTaggedMigrateLoading, setClipTaggedMigrateLoading] =
    useState(false);
  const [fileTitlesMigrateLoading, setFileTitlesMigrateLoading] =
    useState(false);
  const [fileTitlesMigrateResult, setFileTitlesMigrateResult] = useState<{
    fileCards: number;
    eligible: number;
    updated: number;
    failed: number;
  } | null>(null);
  const [syncBuiltinSchemaLoading, setSyncBuiltinSchemaLoading] =
    useState(false);
  const [syncBuiltinSchemaResult, setSyncBuiltinSchemaResult] = useState<{
    updated: number;
    failed: number;
  } | null>(null);
  const [purgeBlankBusy, setPurgeBlankBusy] = useState(false);
  const [backfillThumbsLoading, setBackfillThumbsLoading] = useState(false);
  const [backfillThumbsResult, setBackfillThumbsResult] =
    useState<BackfillMediaThumbnailsResult | null>(null);
  const [backfillThumbsError, setBackfillThumbsError] = useState<string | null>(
    null
  );
  const [notePrefs, setNotePrefs] = useState<UserNotePrefs>(() =>
    loadLocalNotePrefs()
  );
  const [notePrefsSyncErr, setNotePrefsSyncErr] = useState(false);
  const autoLinkCatalog = useMemo(
    () =>
      listPresetAutoLinkRulesForSettings().filter(
        (x) => !CLIP_PRESET_CUSTOM_RULE_IDS.has(x.ruleId)
      ),
    []
  );
  const collectionPickerOptions = useMemo(
    () => flattenCollectionsForPicker(collections),
    [collections]
  );
  const [autoLinkDraft, setAutoLinkDraft] = useState({
    sourceCollectionId: "",
    sourceFieldId: "",
    targetCollectionId: "",
    targetFieldId: "",
  });
  const sourceColLinkFields = useMemo(
    () =>
      mergedAutoLinkSourceFieldsForCollection(
        autoLinkDraft.sourceCollectionId,
        collections
      ),
    [autoLinkDraft.sourceCollectionId, collections]
  );
  const targetColLinkFields = useMemo(
    () =>
      mergedCardLinkFieldsForCollection(
        autoLinkDraft.targetCollectionId,
        collections
      ),
    [autoLinkDraft.targetCollectionId, collections]
  );

  useEffect(() => {
    setAutoLinkDraft((d) => {
      if (!d.sourceFieldId) return d;
      if (sourceColLinkFields.some((f) => f.id === d.sourceFieldId)) return d;
      return { ...d, sourceFieldId: "" };
    });
  }, [sourceColLinkFields]);
  useEffect(() => {
    setAutoLinkDraft((d) => {
      if (!d.targetFieldId) return d;
      if (targetColLinkFields.some((f) => f.id === d.targetFieldId)) return d;
      return { ...d, targetFieldId: "" };
    });
  }, [targetColLinkFields]);
  const [customRuleErr, setCustomRuleErr] = useState<string | null>(null);
  const [customRuleMsg, setCustomRuleMsg] = useState<string | null>(null);
  const [manualRunRuleId, setManualRunRuleId] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingRuleTargetCollectionId, setEditingRuleTargetCollectionId] =
    useState("");
  const customRulesForDisplay = useMemo(() => {
    const extras = Array.isArray(notePrefs.extraAutoLinkRules)
      ? notePrefs.extraAutoLinkRules
      : [];
    const byId = new Map<string, AutoLinkRule>();
    for (const r of extras) {
      if (!r?.ruleId?.trim()) continue;
      byId.set(r.ruleId, r);
    }
    for (const presetRule of CLIP_PRESET_CUSTOM_RULE_TEMPLATES) {
      const existing = byId.get(presetRule.ruleId);
      if (existing) {
        byId.set(presetRule.ruleId, { ...presetRule, ...existing });
      } else if (!notePrefs.disabledAutoLinkRuleIds.includes(presetRule.ruleId)) {
        byId.set(presetRule.ruleId, presetRule);
      }
    }
    return [...byId.values()];
  }, [notePrefs.extraAutoLinkRules, notePrefs.disabledAutoLinkRuleIds]);
  const [customTypeModal, setCustomTypeModal] = useState<
    | null
    | { mode: "create"; parentId?: string }
    | { mode: "edit"; collection: Collection }
  >(null);
  const [customTypeDraft, setCustomTypeDraft] = useState<{
    name: string;
    parentId: string;
    fields: { id?: string; name: string; type: SchemaField["type"] }[];
  }>({ name: "", parentId: "", fields: [] });
  const [customTypeFormErr, setCustomTypeFormErr] = useState<string | null>(
    null
  );
  const [customTypeSaving, setCustomTypeSaving] = useState(false);

  const customObjectTypeLayout = useMemo(() => {
    if (!collections?.length) {
      return {
        rootCustoms: [] as Collection[],
        extrasByBaseId: new Map<string, Collection[]>(),
        nestedCustomRows: [] as { parent: Collection; children: Collection[] }[],
      };
    }
    const flat: Collection[] = [];
    walkCollections(collections, (c) => flat.push(c));
    const customCols = flat.filter(
      (c) =>
        Boolean(
          c.isCategory &&
            c.presetTypeId &&
            !CATALOG_PRESET_IDS.has(c.presetTypeId)
        )
    );
    const extrasByBaseId = new Map<string, Collection[]>();
    const nestedCustomRowsMap = new Map<
      string,
      { parent: Collection; children: Collection[] }
    >();
    const rootCustoms: Collection[] = [];
    for (const col of customCols) {
      const parent = findParentOfCollectionId(collections, col.id);
      if (!parent) {
        rootCustoms.push(col);
        continue;
      }
      const base = parent.presetTypeId
        ? catalogGroupBaseForPresetId(parent.presetTypeId)
        : null;
      if (base) {
        const arr = extrasByBaseId.get(base) ?? [];
        arr.push(col);
        extrasByBaseId.set(base, arr);
        continue;
      }
      if (
        parent.presetTypeId &&
        !CATALOG_PRESET_IDS.has(parent.presetTypeId)
      ) {
        let row = nestedCustomRowsMap.get(parent.id);
        if (!row) {
          row = { parent, children: [] };
          nestedCustomRowsMap.set(parent.id, row);
        }
        row.children.push(col);
      } else {
        rootCustoms.push(col);
      }
    }
    return {
      rootCustoms,
      extrasByBaseId,
      nestedCustomRows: [...nestedCustomRowsMap.values()],
    };
  }, [collections]);

  const templateParentContainers = useMemo(() => {
    if (!collections?.length) return [];
    return walkCollectionsWithPath(collections, [])
      .filter((x) => x.col.isCategory)
      .map((x) => ({ id: x.col.id, label: x.path }));
  }, [collections]);

  useEffect(() => {
    if (!customTypeModal) return;
    if (customTypeModal.mode === "create") {
      setCustomTypeDraft({
        name: "",
        parentId: customTypeModal.parentId ?? "",
        fields: customTypeModal.parentId
          ? []
          : [{ name: lang === "en" ? "Title" : "标题", type: "text" }],
      });
    } else {
      const col = customTypeModal.collection;
      const fs = col.cardSchema?.fields ?? [];
      setCustomTypeDraft({
        name: col.name,
        parentId: "",
        fields:
          fs.length > 0
            ? fs.map((f) => ({
                id: f.id,
                name: f.name,
                type: f.type,
              }))
            : [{ name: lang === "en" ? "Title" : "标题", type: "text" }],
      });
    }
    setCustomTypeFormErr(null);
  }, [customTypeModal, lang]);

  // 从 collections 树中找出已启用的预设类型（preset_type_id → Collection）
  const enabledByPresetTypeId = new Map<string, Collection>();
  if (collections) {
    walkCollections(collections, (col) => {
      if (col.presetTypeId) enabledByPresetTypeId.set(col.presetTypeId, col);
    });
  }

  const openCreateSubtypeModal = useCallback(
    (parentId?: string) => {
      if (collections == null || dataMode !== "remote") return;
      setCustomTypeModal({ mode: "create", ...(parentId ? { parentId } : {}) });
    },
    [collections, dataMode]
  );

  async function handleEnablePresetType(group: PresetTypeGroup, child?: PresetObjectTypeItem) {
    const presetTypeId = child ? child.id : group.baseId;
    const name = lang === "en"
      ? (child ? child.nameEn : group.baseLabelEn)
      : (child ? child.nameZh : group.baseLabelZh);
    const dotColor = child ? child.tint : group.baseTint;
    const cardSchema = buildSchemaFromPreset(group, child);
    setTypeActionLoading(presetTypeId);
    try {
      const presetIdToColId = new Map<string, string>();
      for (const [pid, col] of enabledByPresetTypeId) {
        presetIdToColId.set(pid, col.id);
      }

      let parentId: string | undefined;
      if (child) {
        const pid = await ensurePresetCollectionEnabled(presetIdToColId, {
          presetTypeId: group.baseId,
          name: lang === "en" ? group.baseLabelEn : group.baseLabelZh,
          dotColor: group.baseTint,
          cardSchema: buildSchemaFromPreset(group),
        });
        if (!pid) return;
        parentId = pid;
      }

      await ensurePresetCollectionEnabled(presetIdToColId, {
        presetTypeId,
        name,
        dotColor,
        cardSchema,
        ...(parentId ? { parentId } : {}),
      });
    } finally {
      setTypeActionLoading(null);
    }
  }

  async function handleDisablePresetType(col: Collection) {
    setTypeActionLoading(col.presetTypeId ?? col.id);
    try {
      await deleteCollectionApi(col.id);
      await onCollectionsChange?.();
    } finally {
      setTypeActionLoading(null);
    }
  }

  function createPresetCollectionId(presetTypeId: string): string {
    return `preset-${presetTypeId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function ensurePresetCollectionEnabled(
    presetIdToColId: Map<string, string>,
    params: {
      presetTypeId: string;
      name: string;
      dotColor: string;
      cardSchema: CollectionCardSchema;
      parentId?: string;
    }
  ): Promise<string | null> {
    const existing = presetIdToColId.get(params.presetTypeId);
    if (existing) return existing;

    const res = await enablePresetTypeApi({
      presetTypeId: params.presetTypeId,
      collectionId: createPresetCollectionId(params.presetTypeId),
      name: params.name,
      dotColor: params.dotColor,
      cardSchema: params.cardSchema,
      ...(params.parentId ? { parentId: params.parentId } : {}),
    });
    const id = collectionIdFromEnablePresetResponse(res);
    if (!id) return null;

    presetIdToColId.set(params.presetTypeId, id);
    await onCollectionsChange?.({
      enabledCollectionId: id,
      presetTypeId: params.presetTypeId,
    });
    return id;
  }

  /** 按目录顺序补齐内置预设对应的模板合集（云端） */
  async function handleEnableAllCatalogPresetCollections() {
    if (collections == null || dataMode !== "remote") return;

    const presetIdToColId = new Map<string, string>();
    for (const [pid, col] of enabledByPresetTypeId) {
      presetIdToColId.set(pid, col.id);
    }

    setTypeActionLoading("__all__");
    try {
      for (const group of PRESET_OBJECT_TYPES_GROUPS) {
        const nameBase =
          lang === "en" ? group.baseLabelEn : group.baseLabelZh;

        if (group.baseId === "file") {
          await ensurePresetCollectionEnabled(presetIdToColId, {
            presetTypeId: "file",
            name: nameBase,
            dotColor: group.baseTint,
            cardSchema: buildSchemaFromPreset(group),
          });
          continue;
        }

        if (group.children.length === 0) {
          await ensurePresetCollectionEnabled(presetIdToColId, {
            presetTypeId: group.baseId,
            name: nameBase,
            dotColor: group.baseTint,
            cardSchema: buildSchemaFromPreset(group),
          });
          continue;
        }

        const parentId = await ensurePresetCollectionEnabled(presetIdToColId, {
          presetTypeId: group.baseId,
          name: nameBase,
          dotColor: group.baseTint,
          cardSchema: buildSchemaFromPreset(group),
        });
        if (!parentId) continue;

        for (const child of group.children) {
          await ensurePresetCollectionEnabled(presetIdToColId, {
            presetTypeId: child.id,
            name: lang === "en" ? child.nameEn : child.nameZh,
            dotColor: child.tint,
            cardSchema: buildSchemaFromPreset(group, child),
            parentId: parentId,
          });
        }
      }
    } finally {
      setTypeActionLoading(null);
    }
  }

  async function handleMigrateAttachments() {
    const fileCol = enabledByPresetTypeId.get("file");
    if (!fileCol) return;
    setMigrateLoading(true);
    try {
      const res = await migrateAttachmentsApi({ fileCollectionId: fileCol.id, clearOriginalMedia: false });
      setMigrateResult(res);
      await onCollectionsChange?.();
    } finally {
      setMigrateLoading(false);
    }
  }

  async function handleMigrateRelatedRefsJson() {
    if (dataMode !== "remote") return;
    setRelatedRefsMigrateLoading(true);
    try {
      const res = await migrateRelatedRefsJsonApi();
      setRelatedRefsMigrateResult(res);
      await onCollectionsChange?.();
    } finally {
      setRelatedRefsMigrateLoading(false);
    }
  }

  async function handleMigrateClipTaggedNotes() {
    if (dataMode !== "remote") return;
    setClipTaggedMigrateLoading(true);
    try {
      const res = await migrateClipTaggedNotesApi();
      setClipTaggedMigrateResult(res);
      await onCollectionsChange?.();
    } finally {
      setClipTaggedMigrateLoading(false);
    }
  }

  async function handleSyncCatalogPresetTemplates() {
    if (collections == null || dataMode !== "remote") return;
    setSyncBuiltinSchemaLoading(true);
    setSyncBuiltinSchemaResult(null);
    let updated = 0;
    let failed = 0;
    try {
      const rows: Collection[] = [];
      walkCollections(collections, (col) => rows.push(col));
      for (const col of rows) {
        const pid = (col.presetTypeId ?? "").trim();
        if (!pid || !CATALOG_PRESET_IDS.has(pid)) continue;
        const ctx = findPresetGroupChildForCatalogId(pid);
        if (!ctx) continue;
        const cardSchema = buildSchemaFromPreset(ctx.group, ctx.child);
        const ok = await updateCollectionApi(col.id, { cardSchema });
        if (ok) updated += 1;
        else failed += 1;
      }
      setSyncBuiltinSchemaResult({ updated, failed });
      await onCollectionsChange?.();
    } finally {
      setSyncBuiltinSchemaLoading(false);
    }
  }

  async function handleBackfillMediaThumbnails() {
    if (dataMode !== "remote") return;
    setBackfillThumbsLoading(true);
    setBackfillThumbsError(null);
    setBackfillThumbsResult(null);
    try {
      const res = await backfillMediaThumbnailsApi(20);
      if (!res.ok) {
        const detail = res.status
          ? `${res.status} ${res.error}`
          : res.error;
        setBackfillThumbsError(
          lang === "en"
            ? `Request failed: ${detail}`
            : `请求失败：${detail}`
        );
        return;
      }
      setBackfillThumbsResult(res.data);
      if (res.data.updated > 0) await onCollectionsChange?.();
    } finally {
      setBackfillThumbsLoading(false);
    }
  }

  async function handleMigrateFileCardTitles() {
    if (!onMigrateFileCardTitles) return;
    setFileTitlesMigrateLoading(true);
    try {
      setFileTitlesMigrateResult(null);
      const res = await onMigrateFileCardTitles();
      if (res) setFileTitlesMigrateResult(res);
    } finally {
      setFileTitlesMigrateLoading(false);
    }
  }
  const [settingsPanel, setSettingsPanel] = useState<NoteSettingsPanel>(
    "general"
  );

  useEffect(() => {
    if (!open) setImportSource("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) setSettingsPanel("general");
  }, [open]);

  useEffect(() => {
    if (settingsPanel === "autoLink") setCustomRuleErr(null);
    if (settingsPanel === "autoLink") setCustomRuleMsg(null);
  }, [settingsPanel]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setNotePrefsSyncErr(false);
    (async () => {
      const local = loadLocalNotePrefs();
      if (!cancelled) setNotePrefs(local);
      if (dataMode !== "remote") return;
      const remote = await fetchMeNotePrefs();
      if (cancelled || !remote) return;
      setNotePrefs(remote);
      saveLocalNotePrefs(remote);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, dataMode]);

  async function persistNotePrefs(next: UserNotePrefs) {
    saveLocalNotePrefs(next);
    setNotePrefs(next);
    setNotePrefsSyncErr(false);
    if (dataMode !== "remote") {
      onNotePrefsApplied?.(next);
      return;
    }
    const saved = await putMeNotePrefs(next);
    if (saved) {
      setNotePrefs(saved);
      saveLocalNotePrefs(saved);
      onNotePrefsApplied?.(saved);
    } else {
      setNotePrefsSyncErr(true);
      onNotePrefsApplied?.(next);
    }
  }

  async function saveCustomTypeForm() {
    if (!customTypeModal) return;
    if (dataMode !== "remote") {
      setCustomTypeFormErr(c.noteSettingsCustomTypeErrRemote);
      return;
    }
    const name = customTypeDraft.name.trim();
    if (!name) {
      setCustomTypeFormErr(c.noteSettingsCustomTypeErrName);
      return;
    }
    setCustomTypeSaving(true);
    setCustomTypeFormErr(null);
    try {
      const builtFields: SchemaField[] = [];
      let ord = 0;
      for (const f of customTypeDraft.fields) {
        const nm = f.name.trim();
        if (!nm) continue;
        builtFields.push({
          id:
            f.id?.trim() ||
            `sf-u-${Date.now()}-${ord}-${Math.random().toString(36).slice(2, 5)}`,
          name: nm,
          type: f.type,
          order: ord++,
        });
      }
      const hasParentInCreate =
        customTypeModal.mode === "create" &&
        Boolean(customTypeDraft.parentId.trim());
      if (builtFields.length === 0 && !hasParentInCreate) {
        builtFields.push({
          id: `sf-u-${Date.now()}-0`,
          name: lang === "en" ? "Title" : "标题",
          type: "text",
          order: 0,
        });
      }
      const cardSchema: CollectionCardSchema = {
        version: 1,
        fields: builtFields,
      };
      if (customTypeModal.mode === "create") {
        const collectionId = `custom-col-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 9)}`;
        const parentId = customTypeDraft.parentId.trim() || undefined;
        const created = await createCollectionApi({
          id: collectionId,
          name,
          dotColor: dotColorFromName(name),
          ...(parentId ? { parentId } : {}),
        });
        if (!created) {
          setCustomTypeFormErr(
            lang === "en" ? "Could not save. Try again." : "保存失败，请重试。"
          );
          return;
        }
        const ok = await updateCollectionApi(collectionId, {
          isCategory: true,
          cardSchema,
        });
        if (!ok) {
          await deleteCollectionApi(collectionId);
          setCustomTypeFormErr(
            lang === "en" ? "Could not save. Try again." : "保存失败，请重试。"
          );
          return;
        }
        await onCollectionsChange?.({
          enabledCollectionId: collectionId,
        });
      } else {
        const col = customTypeModal.collection;
        const ok = await updateCollectionApi(col.id, { name, cardSchema });
        if (!ok) {
          setCustomTypeFormErr(
            lang === "en" ? "Could not save. Try again." : "保存失败，请重试。"
          );
          return;
        }
        await onCollectionsChange?.();
      }
      setCustomTypeModal(null);
    } finally {
      setCustomTypeSaving(false);
    }
  }

  if (!open) return null;

  const presetObjectTypesLocked = Boolean(typeActionLoading);

  const presetLabel = (item: PresetObjectTypeItem) =>
    lang === "en" ? item.nameEn : item.nameZh;

  const autoLinkPanelContent = (
    <div className="note-settings-modal__panel-scroll">
      <p className="note-settings-modal__auto-link-lead">
        {c.noteSettingsAutoLinkPanelLead}
      </p>
      {dataMode === "local" ? (
        <p className="note-settings-modal__auto-link-hint">
          {c.noteSettingsAutoLinkLocalHint}
        </p>
      ) : null}
      {notePrefsSyncErr ? (
        <p className="note-settings-modal__auto-link-hint note-settings-modal__auto-link-hint--warn">
          {c.noteSettingsAutoLinkSyncErr}
        </p>
      ) : null}

      {autoLinkCatalog.length > 0 ? (
        <>
          <p className="note-settings-modal__label note-settings-modal__auto-link-section-label">
            {c.noteSettingsAutoLinkSectionBuiltin}
          </p>
          <div
            className="note-settings-modal__auto-link-list"
            role="list"
            aria-label={c.noteSettingsAutoLinkSectionBuiltin}
          >
            {autoLinkCatalog.map((item) => {
              const enabled = !notePrefs.disabledAutoLinkRuleIds.includes(
                item.ruleId
              );
              const line =
                lang === "en" ? item.summaryEn : item.summaryZh;
              const detailTitle =
                lang === "en"
                  ? `${item.contextEn} · ${item.labelEn}`
                  : `${item.contextZh} · ${item.labelZh}`;
              return (
                <div
                  key={item.ruleId}
                  className="note-settings-modal__auto-link-row note-settings-modal__auto-link-row--custom"
                  role="listitem"
                >
                  <span
                    className="note-settings-modal__auto-link-row-text"
                    title={detailTitle}
                  >
                    {line}
                  </span>
                  <button
                    type="button"
                    className={
                      "note-settings-modal__type-toggle" +
                      (enabled ? " note-settings-modal__type-toggle--on" : "")
                    }
                    aria-label={`${c.noteSettingsAutoLinkRuleAria}: ${line}`}
                    aria-pressed={enabled}
                    onClick={() => {
                      const dis = new Set(notePrefs.disabledAutoLinkRuleIds);
                      if (enabled) dis.add(item.ruleId);
                      else dis.delete(item.ruleId);
                      void persistNotePrefs({
                        ...notePrefs,
                        disabledAutoLinkRuleIds: [...dis],
                      });
                    }}
                  >
                    {enabled
                      ? lang === "en"
                        ? "On"
                        : "已启用"
                      : lang === "en"
                        ? "Off"
                        : "已关闭"}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      <p className="note-settings-modal__label note-settings-modal__auto-link-section-label">
        {c.noteSettingsAutoLinkSectionCustom}
      </p>
      {customRulesForDisplay.length === 0 ? (
        <p className="note-settings-modal__auto-link-hint">
          {lang === "en" ? "No custom rules yet." : "暂无自定义规则。"}
        </p>
      ) : null}
      {customRulesForDisplay.map((rule) => (
        <div
          key={rule.ruleId}
          className="note-settings-modal__auto-link-row note-settings-modal__auto-link-row--custom"
        >
          <span className="note-settings-modal__auto-link-row-text">
            {CLIP_PRESET_CUSTOM_RULE_IDS.has(rule.ruleId)
              ? summarizeClipPresetCustomRule(
                  rule,
                  collectionPickerOptions,
                  enabledByPresetTypeId,
                  lang === "en" ? "en" : "zh"
                )
              : summarizeCompactCustomRule(
                  rule,
                  collections,
                  collectionPickerOptions,
                  lang === "en" ? "en" : "zh"
                )}
          </span>
          <div className="note-settings-modal__auto-link-row-actions">
            <button
              type="button"
              className="note-settings-modal__type-toggle"
              disabled={manualRunRuleId === rule.ruleId}
              onClick={() => {
                const srcColId = String(rule.sourceCollectionId ?? "").trim();
                const resolvedSourceColId =
                  srcColId ||
                  (rule.sourcePresetTypeId
                    ? String(
                        enabledByPresetTypeId.get(rule.sourcePresetTypeId)?.id ?? ""
                      ).trim()
                    : "");
                const sourceLabel =
                  collectionPickerOptions.find((x) => x.id === resolvedSourceColId)
                    ?.label ??
                  (resolvedSourceColId
                    ? findCollectionById(collections, resolvedSourceColId)?.name ??
                      resolvedSourceColId
                    : lang === "en"
                      ? "source collection"
                      : "源合集");
                const okToRun = window.confirm(
                  lang === "en"
                    ? `Backfill auto-link for existing cards in "${sourceLabel}"?`
                    : `要对「${sourceLabel}」中的已有卡片补跑一次自动建卡吗？`
                );
                if (!okToRun) return;
                setCustomRuleErr(null);
                setCustomRuleMsg(
                  lang === "en"
                    ? "Running auto-link for existing cards..."
                    : "正在为已有卡片补跑自动建卡..."
                );
                setManualRunRuleId(rule.ruleId);
                void (async () => {
                  try {
                    const ret = await postAutoLinkRuleBackfillApi(rule.ruleId);
                    if (!ret.ok) {
                      setCustomRuleMsg(null);
                      setCustomRuleErr(
                        lang === "en"
                          ? `Backfill failed: ${ret.error || "unknown error"}`
                          : `补跑失败：${ret.error || "未知错误"}`
                      );
                      return;
                    }
                    await onCollectionsChange?.();
                    const scanned = Number(ret.scanned ?? 0);
                    const ok = Number(ret.succeeded ?? 0);
                    const createdTargets = Number(ret.createdTargets ?? 0);
                    const noEffect = Number(ret.noEffect ?? 0);
                    const failed = Number(ret.failed ?? 0);
                    const sourceName = String(ret.sourceCollectionName ?? "").trim();
                    const reasonsObj =
                      ret.reasons && typeof ret.reasons === "object" ? ret.reasons : {};
                    const reasonEntries = Object.entries(reasonsObj)
                      .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
                      .slice(0, 3)
                      .map(([k, v]) => `${k}:${v}`)
                      .join("，");
                    if (ok === 0) {
                      const warn =
                        lang === "en"
                          ? `Backfill finished, but no cards were linked. Scanned ${scanned}, no-effect ${noEffect}, failed ${failed}.${reasonEntries ? ` Reasons: ${reasonEntries}.` : ""}`
                          : `补跑完成，但没有任何卡片被关联。扫描 ${scanned}，无变化 ${noEffect}，失败 ${failed}。${reasonEntries ? `主要原因：${reasonEntries}。` : ""}`;
                      setCustomRuleMsg(null);
                      setCustomRuleErr(warn);
                      window.alert(warn);
                      return;
                    }
                    setCustomRuleErr(
                      failed > 0
                        ? lang === "en"
                          ? `Done with partial failures: ${ok} linked (${createdTargets} created), ${noEffect} no-effect, ${failed} failed (scanned ${scanned}${sourceName ? ` from "${sourceName}"` : ""}).`
                          : `执行完成：成功关联 ${ok}（新建 ${createdTargets}），无变化 ${noEffect}，失败 ${failed}（扫描 ${scanned}${sourceName ? `，来源「${sourceName}」` : ""}）。`
                        : null
                    );
                    setCustomRuleMsg(
                      failed === 0
                        ? lang === "en"
                          ? `Done: ${ok} linked (${createdTargets} created), ${noEffect} no-effect (scanned ${scanned}${sourceName ? ` from "${sourceName}"` : ""}).${reasonEntries ? ` Reasons: ${reasonEntries}.` : ""}`
                          : `执行完成：成功关联 ${ok}（新建 ${createdTargets}），无变化 ${noEffect}（扫描 ${scanned}${sourceName ? `，来源「${sourceName}」` : ""}）。${reasonEntries ? `主要原因：${reasonEntries}。` : ""}`
                        : null
                    );
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    setCustomRuleMsg(null);
                    setCustomRuleErr(
                      lang === "en"
                        ? `Backfill failed: ${msg || "unknown error"}`
                        : `补跑失败：${msg || "未知错误"}`
                    );
                  } finally {
                    setManualRunRuleId(null);
                  }
                })();
              }}
            >
              {manualRunRuleId === rule.ruleId
                ? lang === "en"
                  ? "Running..."
                  : "执行中..."
                : lang === "en"
                  ? "Run existing"
                  : "补跑"}
            </button>
            <button
              type="button"
              className="note-settings-modal__type-toggle"
              disabled={manualRunRuleId === rule.ruleId}
              onClick={() => {
                setEditingRuleId(rule.ruleId);
                setEditingRuleTargetCollectionId(
                  String(rule.targetCollectionId || "").trim()
                );
              }}
            >
              {lang === "en" ? "Edit" : "修改"}
            </button>
            <button
              type="button"
              className="note-settings-modal__type-toggle"
              disabled={manualRunRuleId === rule.ruleId}
              onClick={() => {
                const extras = (notePrefs.extraAutoLinkRules ?? []).filter(
                  (r) => r.ruleId !== rule.ruleId
                );
                const nextDisabled = new Set(notePrefs.disabledAutoLinkRuleIds);
                if (CLIP_PRESET_CUSTOM_RULE_IDS.has(rule.ruleId)) {
                  nextDisabled.add(rule.ruleId);
                }
                void persistNotePrefs({
                  ...notePrefs,
                  extraAutoLinkRules: extras,
                  disabledAutoLinkRuleIds: [...nextDisabled],
                });
              }}
            >
              {c.noteSettingsAutoLinkDelete}
            </button>
          </div>
          {editingRuleId === rule.ruleId ? (
            <div
              className="note-settings-modal__auto-link-form"
              style={{ marginTop: 8, width: "100%" }}
            >
              <label
                className="note-settings-modal__label"
                htmlFor={`edit-target-col-${rule.ruleId}`}
              >
                {lang === "en" ? "Target collection" : "目标合集"}
              </label>
              <select
                id={`edit-target-col-${rule.ruleId}`}
                className="auth-modal__input"
                value={editingRuleTargetCollectionId}
                onChange={(e) =>
                  setEditingRuleTargetCollectionId(e.target.value.trim())
                }
              >
                <option value="">
                  {lang === "en" ? "Default target" : "默认目标合集"}
                </option>
                {collectionPickerOptions.map((row) => (
                  <option key={`edit-target-${rule.ruleId}-${row.id}`} value={row.id}>
                    {row.label}
                  </option>
                ))}
              </select>
              <div
                className="note-settings-modal__choice-row"
                style={{ marginTop: 8 }}
              >
                <button
                  type="button"
                  className="auth-modal__btn auth-modal__btn--primary"
                  onClick={() => {
                    const extrasWithoutCurrent = (
                      notePrefs.extraAutoLinkRules ?? []
                    ).filter((r) => r.ruleId !== rule.ruleId);
                    const { targetCollectionId: _oldTarget, ...baseRule } = rule;
                    const nextRule: AutoLinkRule = {
                      ...baseRule,
                      ...(editingRuleTargetCollectionId
                        ? { targetCollectionId: editingRuleTargetCollectionId }
                        : {}),
                    };
                    const nextDisabled = new Set(notePrefs.disabledAutoLinkRuleIds);
                    if (CLIP_PRESET_CUSTOM_RULE_IDS.has(rule.ruleId)) {
                      nextDisabled.delete(rule.ruleId);
                    }
                    void persistNotePrefs({
                      ...notePrefs,
                      extraAutoLinkRules: [...extrasWithoutCurrent, nextRule],
                      disabledAutoLinkRuleIds: [...nextDisabled],
                    });
                    setEditingRuleId(null);
                    setEditingRuleTargetCollectionId("");
                  }}
                >
                  {lang === "en" ? "Save" : "保存"}
                </button>
                <button
                  type="button"
                  className="auth-modal__btn"
                  onClick={() => {
                    setEditingRuleId(null);
                    setEditingRuleTargetCollectionId("");
                  }}
                >
                  {lang === "en" ? "Cancel" : "取消"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ))}

      {customRuleErr ? (
        <p className="note-settings-modal__auto-link-hint note-settings-modal__auto-link-hint--warn">
          {customRuleErr}
        </p>
      ) : null}
      {customRuleMsg ? (
        <p className="note-settings-modal__auto-link-hint">{customRuleMsg}</p>
      ) : null}

      <div className="note-settings-modal__auto-link-form">
        <p className="note-settings-modal__auto-link-hint note-settings-modal__auto-link-hint--steps">
          {c.noteSettingsAutoLinkFourStepsHint}
        </p>

        <label className="note-settings-modal__label" htmlFor="auto-link-src-col">
          {c.noteSettingsAutoLinkStep1}
        </label>
        {collectionPickerOptions.length === 0 ? (
          <p className="note-settings-modal__auto-link-hint">
            {c.noteSettingsAutoLinkCollectionsHint}
          </p>
        ) : null}
        <select
          id="auto-link-src-col"
          className="auth-modal__input"
          value={autoLinkDraft.sourceCollectionId}
          onChange={(e) =>
            setAutoLinkDraft((d) => ({
              ...d,
              sourceCollectionId: e.target.value,
            }))
          }
        >
          <option value="">
            {lang === "en" ? "Choose source collection…" : "选择源合集…"}
          </option>
          {collectionPickerOptions.map((row) => (
            <option key={`src-${row.id}`} value={row.id}>
              {row.label}
            </option>
          ))}
        </select>

        <label className="note-settings-modal__label" htmlFor="auto-link-src-field">
          {c.noteSettingsAutoLinkStep2}
        </label>
        {!autoLinkDraft.sourceCollectionId.trim() ? (
          <p className="note-settings-modal__auto-link-hint">
            {c.noteSettingsAutoLinkPickSourceColFirst}
          </p>
        ) : sourceColLinkFields.length === 0 ? (
          <p className="note-settings-modal__auto-link-hint">
            {c.noteSettingsAutoLinkSyncFieldNoCardLink}
          </p>
        ) : (
          <select
            id="auto-link-src-field"
            className="auth-modal__input"
            value={autoLinkDraft.sourceFieldId}
            onChange={(e) =>
              setAutoLinkDraft((d) => ({
                ...d,
                sourceFieldId: e.target.value,
              }))
            }
          >
            <option value="">
              {lang === "en" ? "Choose field…" : "选择属性…"}
            </option>
            {sourceColLinkFields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}

        <label className="note-settings-modal__label" htmlFor="auto-link-tgt-col">
          {c.noteSettingsAutoLinkStep3}
        </label>
        <select
          id="auto-link-tgt-col"
          className="auth-modal__input"
          value={autoLinkDraft.targetCollectionId}
          onChange={(e) =>
            setAutoLinkDraft((d) => ({
              ...d,
              targetCollectionId: e.target.value,
            }))
          }
        >
          <option value="">
            {lang === "en" ? "Choose target collection…" : "选择目标合集…"}
          </option>
          {collectionPickerOptions.map((row) => (
            <option key={`tgt-${row.id}`} value={row.id}>
              {row.label}
            </option>
          ))}
        </select>

        <label className="note-settings-modal__label" htmlFor="auto-link-tgt-field">
          {c.noteSettingsAutoLinkStep4}
        </label>
        {!autoLinkDraft.targetCollectionId.trim() ? (
          <p className="note-settings-modal__auto-link-hint">
            {c.noteSettingsAutoLinkPickTargetColFirst}
          </p>
        ) : targetColLinkFields.length === 0 ? (
          <p className="note-settings-modal__auto-link-hint">
            {c.noteSettingsAutoLinkSyncFieldNoCardLink}
          </p>
        ) : (
          <select
            id="auto-link-tgt-field"
            className="auth-modal__input"
            value={autoLinkDraft.targetFieldId}
            onChange={(e) =>
              setAutoLinkDraft((d) => ({
                ...d,
                targetFieldId: e.target.value,
              }))
            }
          >
            <option value="">
              {lang === "en" ? "Choose field…" : "选择属性…"}
            </option>
            {targetColLinkFields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          className="auth-modal__btn auth-modal__btn--primary note-settings-modal__auto-link-add-btn"
          onClick={() => {
            const srcCol = autoLinkDraft.sourceCollectionId.trim();
            const srcField = autoLinkDraft.sourceFieldId.trim();
            const tgtCol = autoLinkDraft.targetCollectionId.trim();
            const tgtField = autoLinkDraft.targetFieldId.trim();
            if (!srcCol || !srcField || !tgtCol || !tgtField) {
              setCustomRuleErr(c.noteSettingsAutoLinkErrFourSteps);
              return;
            }
            if (srcCol === tgtCol) {
              setCustomRuleErr(c.noteSettingsAutoLinkErrSameCollection);
              return;
            }
            setCustomRuleErr(null);
            const tgtNode = findCollectionById(collections, tgtCol);
            const targetObjectKind = tgtNode?.presetTypeId?.trim() || "note";
            const ruleId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
            const srcLabel =
              collectionPickerOptions.find((x) => x.id === srcCol)?.label ?? srcCol;
            const tgtLabel =
              collectionPickerOptions.find((x) => x.id === tgtCol)?.label ?? tgtCol;
            const srcFieldName =
              sourceColLinkFields.find((f) => f.id === srcField)?.name ?? srcField;
            const tgtFieldName =
              targetColLinkFields.find((f) => f.id === tgtField)?.name ?? tgtField;
            const labelZh = `「${srcLabel}」的「${srcFieldName}」 ↔ 「${tgtLabel}」的「${tgtFieldName}」（保存时自动建卡并互链）`;
            const labelEn = `${srcLabel} · ${srcFieldName} ↔ ${tgtLabel} · ${tgtFieldName} (auto-link on save)`;
            const rule: AutoLinkRule = {
              ruleId,
              trigger: "on_save",
              sourceCollectionId: srcCol,
              syncSchemaFieldId: srcField,
              targetCollectionId: tgtCol,
              targetSyncSchemaFieldId: tgtField,
              targetObjectKind,
              linkType: "related",
              labelZh,
              labelEn,
            };
            void persistNotePrefs({
              ...notePrefs,
              extraAutoLinkRules: [...(notePrefs.extraAutoLinkRules ?? []), rule],
            });
          }}
        >
          {c.noteSettingsAutoLinkAdd}
        </button>
      </div>
    </div>
  );

  const showRerunAndMigrationTools =
    (globalThis as { __MIKUJAR_SHOW_NOTE_SETTINGS_MIGRATION_TOOLS__?: boolean })
      .__MIKUJAR_SHOW_NOTE_SETTINGS_MIGRATION_TOOLS__ === true;

  const panelContent =
    settingsPanel === "general" ? (
      <div className="note-settings-modal__panel-scroll">
        <p className="note-settings-modal__label">
          {c.noteSettingsPlacementLabel}
        </p>
        <div
          className="note-settings-modal__choice-row"
          role="group"
          aria-label={c.noteSettingsPlacementAria}
        >
          <button
            type="button"
            className={
              "note-settings-modal__choice" +
              (newNotePlacement === "top"
                ? " note-settings-modal__choice--active"
                : "")
            }
            aria-pressed={newNotePlacement === "top"}
            onClick={() => setNewNotePlacement("top")}
          >
            {c.noteSettingsTop}
          </button>
          <button
            type="button"
            className={
              "note-settings-modal__choice" +
              (newNotePlacement === "bottom"
                ? " note-settings-modal__choice--active"
                : "")
            }
            aria-pressed={newNotePlacement === "bottom"}
            onClick={() => setNewNotePlacement("bottom")}
          >
            {c.noteSettingsBottom}
          </button>
        </div>

        <p className="note-settings-modal__label">
          {c.noteSettingsSidebarDotsLabel}
        </p>
        <div
          className="note-settings-modal__choice-row"
          role="group"
          aria-label={c.noteSettingsSidebarDotsAria}
        >
          <button
            type="button"
            className={
              "note-settings-modal__choice" +
              (!hideSidebarCollectionDots
                ? " note-settings-modal__choice--active"
                : "")
            }
            aria-pressed={!hideSidebarCollectionDots}
            onClick={() => setHideSidebarCollectionDots(false)}
          >
            {c.noteSettingsSidebarDotsShow}
          </button>
          <button
            type="button"
            className={
              "note-settings-modal__choice" +
              (hideSidebarCollectionDots
                ? " note-settings-modal__choice--active"
                : "")
            }
            aria-pressed={hideSidebarCollectionDots}
            onClick={() => setHideSidebarCollectionDots(true)}
          >
            {c.noteSettingsSidebarDotsHide}
          </button>
        </div>

        <p className="note-settings-modal__label">
          {c.noteSettingsFoldLabel}
        </p>
        <div
          className="note-settings-modal__choice-row"
          role="group"
          aria-label={c.noteSettingsFoldAria}
        >
          <button
            type="button"
            className={
              "note-settings-modal__choice" +
              (!timelineFoldBodyThreeLines
                ? " note-settings-modal__choice--active"
                : "")
            }
            aria-pressed={!timelineFoldBodyThreeLines}
            onClick={() => setTimelineFoldBodyThreeLines(false)}
          >
            {c.noteSettingsFoldOff}
          </button>
          <button
            type="button"
            className={
              "note-settings-modal__choice" +
              (timelineFoldBodyThreeLines
                ? " note-settings-modal__choice--active"
                : "")
            }
            aria-pressed={timelineFoldBodyThreeLines}
            onClick={() => setTimelineFoldBodyThreeLines(true)}
          >
            {c.noteSettingsFoldOn}
          </button>
        </div>

        <p className="note-settings-modal__label">
          {c.noteSettingsGallerySideLabel}
        </p>
        <div
          className="note-settings-modal__choice-row"
          role="group"
          aria-label={c.noteSettingsGallerySideAria}
        >
          <button
            type="button"
            className={
              "note-settings-modal__choice" +
              (notePrefs.timelineGalleryOnRight !== false
                ? " note-settings-modal__choice--active"
                : "")
            }
            aria-pressed={notePrefs.timelineGalleryOnRight !== false}
            onClick={() =>
              void persistNotePrefs({
                ...notePrefs,
                timelineGalleryOnRight: true,
              })
            }
          >
            {c.noteSettingsGalleryRight}
          </button>
          <button
            type="button"
            className={
              "note-settings-modal__choice" +
              (notePrefs.timelineGalleryOnRight === false
                ? " note-settings-modal__choice--active"
                : "")
            }
            aria-pressed={notePrefs.timelineGalleryOnRight === false}
            onClick={() =>
              void persistNotePrefs({
                ...notePrefs,
                timelineGalleryOnRight: false,
              })
            }
          >
            {c.noteSettingsGalleryLeft}
          </button>
        </div>

        {onPurgeBlankCards ? (
          <>
            <p className="note-settings-modal__label">
              {c.noteSettingsPurgeBlankTitle}
            </p>
            <p className="note-settings-modal__migrate-desc">
              {c.noteSettingsPurgeBlankHint}
            </p>
            <button
              type="button"
              className="note-settings-modal__migrate-btn note-settings-modal__purge-blank-btn"
              disabled={purgeBlankBusy}
              onClick={() => {
                if (purgeBlankBusy) return;
                setPurgeBlankBusy(true);
                void Promise.resolve(onPurgeBlankCards()).finally(() =>
                  setPurgeBlankBusy(false)
                );
              }}
            >
              {purgeBlankBusy
                ? c.noteSettingsPurgeBlankBusy
                : c.noteSettingsPurgeBlankBtn}
            </button>
          </>
        ) : null}

        {dataMode === "remote" ? (
          <>
            <p className="note-settings-modal__label">
              {c.noteSettingsBackfillThumbsTitle}
            </p>
            <p className="note-settings-modal__migrate-desc">
              {c.noteSettingsBackfillThumbsHint}
            </p>
            {backfillThumbsResult ? (
              <p className="note-settings-modal__migrate-result">
                {c.noteSettingsBackfillThumbsResult(
                  backfillThumbsResult.scanned,
                  backfillThumbsResult.updated,
                  backfillThumbsResult.failed,
                  backfillThumbsResult.remaining
                )}
              </p>
            ) : null}
            {backfillThumbsError ? (
              <p className="note-settings-modal__migrate-result">
                {backfillThumbsError}
              </p>
            ) : null}
            <button
              type="button"
              className="note-settings-modal__migrate-btn"
              disabled={backfillThumbsLoading}
              onClick={() => void handleBackfillMediaThumbnails()}
            >
              {backfillThumbsLoading
                ? c.noteSettingsBackfillThumbsBusy
                : c.noteSettingsBackfillThumbsBtn}
            </button>
          </>
        ) : null}

        <p className="note-settings-modal__label">
          {c.noteSettingsStorageLabel}
        </p>
        <div
          className="note-settings-modal__choice-row note-settings-modal__choice-row--stack"
          role="group"
          aria-label={c.noteSettingsStorageAria}
        >
          <button
            type="button"
            className={
              "note-settings-modal__choice note-settings-modal__choice--block" +
              (dataMode === "remote"
                ? " note-settings-modal__choice--active"
                : "")
            }
            aria-pressed={dataMode === "remote"}
            onClick={() => setDataMode("remote")}
          >
            {c.noteSettingsCloud}
          </button>
        </div>

        {onOpenAppleNotesImport ||
        onOpenFlomoImport ||
        onOpenEvernoteImport ||
        onOpenYuqueImport ? (
          <>
            <p className="note-settings-modal__label">
              {c.noteSettingsImportSectionLabel}
            </p>
            <select
              className="auth-modal__input note-settings-modal__import-select"
              aria-label={c.noteSettingsImportSourceAria}
              value={importSource}
              onChange={(e) => {
                const v = e.target.value as
                  | ""
                  | "apple"
                  | "flomo"
                  | "evernote"
                  | "yuque";
                if (v === "apple" && onOpenAppleNotesImport) {
                  onOpenAppleNotesImport();
                } else if (v === "flomo" && onOpenFlomoImport) {
                  onOpenFlomoImport();
                } else if (v === "evernote" && onOpenEvernoteImport) {
                  onOpenEvernoteImport();
                } else if (v === "yuque" && onOpenYuqueImport) {
                  onOpenYuqueImport();
                }
                setImportSource("");
              }}
            >
              <option value="">{c.noteSettingsImportSourcePlaceholder}</option>
              {onOpenAppleNotesImport ? (
                <option value="apple">{c.noteSettingsImportSourceApple}</option>
              ) : null}
              {onOpenFlomoImport ? (
                <option value="flomo">{c.noteSettingsImportSourceFlomo}</option>
              ) : null}
              {onOpenEvernoteImport ? (
                <option value="evernote">
                  {c.noteSettingsImportSourceEvernote}
                </option>
              ) : null}
              {onOpenYuqueImport ? (
                <option value="yuque">{c.noteSettingsImportSourceYuque}</option>
              ) : null}
            </select>
          </>
        ) : null}
      </div>
    ) : settingsPanel === "autoLink" ? (
      autoLinkPanelContent
    ) : (
      <div className="note-settings-modal__panel-scroll">
        <p className="note-settings-modal__object-types-lead">
          {c.noteSettingsObjectTypesLead}
        </p>

        {showRerunAndMigrationTools && collections != null && dataMode === "remote" ? (
          <div className="note-settings-modal__choice-row note-settings-modal__choice-row--stack">
            <button
              type="button"
              className="note-settings-modal__choice note-settings-modal__choice--block"
              disabled={presetObjectTypesLocked}
              onClick={() => void handleEnableAllCatalogPresetCollections()}
            >
              {typeActionLoading === "__all__"
                ? c.noteSettingsEnableAllPresetsBusy
                : c.noteSettingsEnableAllPresets}
            </button>
          </div>
        ) : null}

        {showRerunAndMigrationTools && collections != null && dataMode === "remote" ? (
          <div className="note-settings-modal__migrate-section">
            <p className="note-settings-modal__label">
              {c.noteSettingsSyncBuiltinSchemaTitle}
            </p>
            <p className="note-settings-modal__migrate-desc">
              {c.noteSettingsSyncBuiltinSchemaDesc}
            </p>
            {syncBuiltinSchemaResult ? (
              <p className="note-settings-modal__migrate-result">
                {c.noteSettingsSyncBuiltinSchemaResult(
                  syncBuiltinSchemaResult.updated,
                  syncBuiltinSchemaResult.failed
                )}
              </p>
            ) : null}
            <button
              type="button"
              className="note-settings-modal__migrate-btn"
              disabled={
                presetObjectTypesLocked || syncBuiltinSchemaLoading
              }
              onClick={() => void handleSyncCatalogPresetTemplates()}
            >
              {syncBuiltinSchemaLoading
                ? c.noteSettingsSyncBuiltinSchemaBusy
                : c.noteSettingsSyncBuiltinSchemaBtn}
            </button>
          </div>
        ) : null}

        <div className="note-settings-modal__type-root-grid">
          <div className="note-settings-modal__preset-grid" role="list">
            {PRESET_OBJECT_TYPES_GROUPS.map((group) => {
              const parent = presetTypeParentCard(group);
              const parentEnabled = enabledByPresetTypeId.get(group.baseId);
              return (
                <div
                  key={group.baseId}
                  className="note-settings-modal__preset-grid-cell"
                  role="listitem"
                >
                  <PresetTypeCard item={parent} label={presetLabel(parent)} />
                  {collections != null && (
                    <button
                      type="button"
                      className={
                        "note-settings-modal__type-toggle" +
                        (parentEnabled
                          ? " note-settings-modal__type-toggle--on"
                          : "")
                      }
                      disabled={presetObjectTypesLocked}
                      onClick={() =>
                        parentEnabled
                          ? handleDisablePresetType(parentEnabled)
                          : handleEnablePresetType(group)
                      }
                    >
                      {typeActionLoading === group.baseId
                        ? "…"
                        : parentEnabled
                          ? lang === "en"
                            ? "Added"
                            : "已添加"
                          : lang === "en"
                            ? "Add"
                            : "添加"}
                    </button>
                  )}
                </div>
              );
            })}

            {customObjectTypeLayout.rootCustoms.length > 0
              ? customObjectTypeLayout.rootCustoms.map((col) => {
                  const item: PresetObjectTypeItem = {
                    id: col.presetTypeId ?? col.id,
                    nameZh: col.name,
                    nameEn: col.name,
                    emoji: "📦",
                    tint: col.dotColor || "rgba(55, 53, 47, 0.08)",
                  };
                  const isLoading = typeActionLoading === (col.presetTypeId ?? col.id);
                  return (
                    <div
                      key={col.id}
                      className="note-settings-modal__preset-grid-cell"
                      role="listitem"
                    >
                      <PresetTypeCard item={item} label={col.name} />
                      {collections != null && dataMode === "remote" ? (
                        <>
                          <button
                            type="button"
                            className="note-settings-modal__type-toggle note-settings-modal__type-toggle--on note-settings-modal__type-toggle--compact"
                            disabled={presetObjectTypesLocked || isLoading}
                            onClick={() =>
                              setCustomTypeModal({ mode: "edit", collection: col })
                            }
                          >
                            {c.noteSettingsCustomTypeEditSchema}
                          </button>
                          <button
                            type="button"
                            className={
                              "note-settings-modal__type-toggle" +
                              " note-settings-modal__type-toggle--on"
                            }
                            disabled={presetObjectTypesLocked || isLoading}
                            onClick={() => handleDisablePresetType(col)}
                          >
                            {isLoading
                              ? "…"
                              : lang === "en"
                                ? "Remove"
                                : "移除"}
                          </button>
                        </>
                      ) : null}
                    </div>
                  );
                })
              : null}
          </div>
        </div>

        <div className="note-settings-modal__subtype-stack">
          {PRESET_OBJECT_TYPES_GROUPS.map((group) => {
            const extras =
              customObjectTypeLayout.extrasByBaseId.get(group.baseId) ?? [];
            if (group.children.length === 0 && extras.length === 0) return null;
            const parent = presetTypeParentCard(group);
            const parentEnabled = enabledByPresetTypeId.get(group.baseId);
            return (
              <div key={group.baseId} className="note-settings-modal__type-group">
              <div className="note-settings-modal__type-section-head">
                <p className="note-settings-modal__type-section-title">
                  {presetLabel(parent)}
                </p>
                <button
                  type="button"
                  className="note-settings-modal__type-section-add-btn"
                  title={c.noteSettingsAddCustomType}
                  aria-label={`${c.noteSettingsAddCustomType}：${presetLabel(parent)}`}
                  disabled={
                    collections == null ||
                    dataMode !== "remote" ||
                    presetObjectTypesLocked ||
                    !parentEnabled
                  }
                  onClick={() => openCreateSubtypeModal(parentEnabled?.id)}
                >
                  +
                </button>
              </div>
                <div
                  className="note-settings-modal__subtype-row note-settings-modal__preset-grid"
                  role="list"
                >
                  {group.children.map((child) => {
                    const childCollection = enabledByPresetTypeId.get(child.id);
                    const childInheritsParent =
                      group.baseId === "file" && Boolean(parentEnabled);
                    const childShownOn = Boolean(
                      childCollection || childInheritsParent
                    );
                    const childToggleInherited =
                      childInheritsParent && !childCollection;
                    return (
                      <div
                        key={child.id}
                        className="note-settings-modal__preset-grid-cell"
                        role="listitem"
                      >
                        <PresetTypeCard
                          item={child}
                          label={presetLabel(child)}
                        />
                        {collections != null && (
                          <button
                            type="button"
                            className={
                              "note-settings-modal__type-toggle" +
                              (childShownOn
                                ? " note-settings-modal__type-toggle--on"
                                : "")
                            }
                            disabled={
                              presetObjectTypesLocked || childToggleInherited
                            }
                            title={
                              childToggleInherited
                                ? lang === "en"
                                  ? "Included when File above is added."
                                  : "已添加「文件」时已包含此项。"
                                : undefined
                            }
                            onClick={() => {
                              if (childCollection) {
                                handleDisablePresetType(childCollection);
                              } else if (!childToggleInherited) {
                                handleEnablePresetType(group, child);
                              }
                            }}
                          >
                            {typeActionLoading === child.id
                              ? "…"
                              : childShownOn
                                ? lang === "en"
                                  ? "Added"
                                  : "已添加"
                                : lang === "en"
                                  ? "Add"
                                  : "添加"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {extras.map((col) => {
                    const item: PresetObjectTypeItem = {
                      id: col.presetTypeId ?? col.id,
                      nameZh: col.name,
                      nameEn: col.name,
                      emoji: "📦",
                      tint: col.dotColor || "rgba(55, 53, 47, 0.08)",
                    };
                    const isLoading =
                      typeActionLoading === (col.presetTypeId ?? col.id);
                    return (
                      <div
                        key={col.id}
                        className="note-settings-modal__preset-grid-cell"
                        role="listitem"
                      >
                        <PresetTypeCard item={item} label={col.name} />
                        {collections != null && dataMode === "remote" ? (
                          <>
                            <button
                              type="button"
                              className="note-settings-modal__type-toggle note-settings-modal__type-toggle--on note-settings-modal__type-toggle--compact"
                              disabled={presetObjectTypesLocked || isLoading}
                              onClick={() =>
                                setCustomTypeModal({
                                  mode: "edit",
                                  collection: col,
                                })
                              }
                            >
                              {c.noteSettingsCustomTypeEditSchema}
                            </button>
                            <button
                              type="button"
                              className={
                                "note-settings-modal__type-toggle" +
                                " note-settings-modal__type-toggle--on"
                              }
                              disabled={presetObjectTypesLocked || isLoading}
                              onClick={() => handleDisablePresetType(col)}
                            >
                              {isLoading
                                ? "…"
                                : lang === "en"
                                  ? "Remove"
                                  : "移除"}
                            </button>
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {customObjectTypeLayout.nestedCustomRows.map((row) => (
            <div key={row.parent.id} className="note-settings-modal__type-group">
              <div className="note-settings-modal__type-section-head">
                <p className="note-settings-modal__type-section-title">
                  {row.parent.name}
                </p>
                <button
                  type="button"
                  className="note-settings-modal__type-section-add-btn"
                  title={c.noteSettingsAddCustomType}
                  aria-label={`${c.noteSettingsAddCustomType}：${row.parent.name}`}
                  disabled={
                    collections == null ||
                    dataMode !== "remote" ||
                    presetObjectTypesLocked
                  }
                  onClick={() => openCreateSubtypeModal(row.parent.id)}
                >
                  +
                </button>
              </div>
              <div
                className="note-settings-modal__subtype-row note-settings-modal__preset-grid"
                role="list"
              >
                {row.children.map((col) => {
                  const item: PresetObjectTypeItem = {
                    id: col.presetTypeId ?? col.id,
                    nameZh: col.name,
                    nameEn: col.name,
                    emoji: "📦",
                    tint: col.dotColor || "rgba(55, 53, 47, 0.08)",
                  };
                  const isLoading =
                    typeActionLoading === (col.presetTypeId ?? col.id);
                  return (
                    <div
                      key={col.id}
                      className="note-settings-modal__preset-grid-cell"
                      role="listitem"
                    >
                      <PresetTypeCard item={item} label={col.name} />
                      {collections != null && dataMode === "remote" ? (
                        <>
                          <button
                            type="button"
                            className="note-settings-modal__type-toggle note-settings-modal__type-toggle--on note-settings-modal__type-toggle--compact"
                            disabled={presetObjectTypesLocked || isLoading}
                            onClick={() =>
                              setCustomTypeModal({ mode: "edit", collection: col })
                            }
                          >
                            {c.noteSettingsCustomTypeEditSchema}
                          </button>
                          <button
                            type="button"
                            className={
                              "note-settings-modal__type-toggle" +
                              " note-settings-modal__type-toggle--on"
                            }
                            disabled={presetObjectTypesLocked || isLoading}
                            onClick={() => handleDisablePresetType(col)}
                          >
                            {isLoading
                              ? "…"
                              : lang === "en"
                                ? "Remove"
                                : "移除"}
                          </button>
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {showRerunAndMigrationTools && collections != null && dataMode === "remote" && (
          <div className="note-settings-modal__migrate-section">
            <p className="note-settings-modal__label">
              {c.noteSettingsMigrateRelatedRefsTitle}
            </p>
            <p className="note-settings-modal__migrate-desc">
              {c.noteSettingsMigrateRelatedRefsDesc}
            </p>
            {relatedRefsMigrateResult && (
              <p className="note-settings-modal__migrate-result">
                {c.noteSettingsMigrateRelatedRefsResult(
                  relatedRefsMigrateResult.withJson,
                  relatedRefsMigrateResult.migrated
                )}
              </p>
            )}
            <button
              type="button"
              className="note-settings-modal__migrate-btn"
              disabled={relatedRefsMigrateLoading}
              onClick={handleMigrateRelatedRefsJson}
            >
              {relatedRefsMigrateLoading
                ? c.noteSettingsMigrateRelatedRefsBusy
                : c.noteSettingsMigrateRelatedRefsBtn}
            </button>
          </div>
        )}

        {showRerunAndMigrationTools && collections != null && onMigrateFileCardTitles ? (
          <div className="note-settings-modal__migrate-section">
            <p className="note-settings-modal__label">
              {c.noteSettingsMigrateFileTitlesTitle}
            </p>
            <p className="note-settings-modal__migrate-desc">
              {c.noteSettingsMigrateFileTitlesDesc}
            </p>
            {fileTitlesMigrateResult ? (
              <p className="note-settings-modal__migrate-result">
                {c.noteSettingsMigrateFileTitlesResult(
                  fileTitlesMigrateResult.fileCards,
                  fileTitlesMigrateResult.eligible,
                  fileTitlesMigrateResult.updated,
                  fileTitlesMigrateResult.failed
                )}
              </p>
            ) : null}
            <button
              type="button"
              className="note-settings-modal__migrate-btn"
              disabled={fileTitlesMigrateLoading}
              onClick={() => void handleMigrateFileCardTitles()}
            >
              {fileTitlesMigrateLoading
                ? c.noteSettingsMigrateFileTitlesBusy
                : c.noteSettingsMigrateFileTitlesBtn}
            </button>
          </div>
        ) : null}

        {showRerunAndMigrationTools && collections != null && dataMode === "remote" && (
          <div className="note-settings-modal__migrate-section">
            <p className="note-settings-modal__label">
              {c.noteSettingsMigrateClipTaggedTitle}
            </p>
            <p className="note-settings-modal__migrate-desc">
              {c.noteSettingsMigrateClipTaggedDesc}
            </p>
            {clipTaggedMigrateResult && (
              <p className="note-settings-modal__migrate-result">
                {c.noteSettingsMigrateClipTaggedResult(
                  clipTaggedMigrateResult.scanned,
                  clipTaggedMigrateResult.migrated,
                  clipTaggedMigrateResult.skippedNoPreset,
                  clipTaggedMigrateResult.skippedNoKind,
                  clipTaggedMigrateResult.errors,
                  clipTaggedMigrateResult.backfillTitles ?? 0
                )}
              </p>
            )}
            <button
              type="button"
              className="note-settings-modal__migrate-btn"
              disabled={clipTaggedMigrateLoading}
              onClick={handleMigrateClipTaggedNotes}
            >
              {clipTaggedMigrateLoading
                ? c.noteSettingsMigrateClipTaggedBusy
                : c.noteSettingsMigrateClipTaggedBtn}
            </button>
          </div>
        )}

        {showRerunAndMigrationTools && collections != null && enabledByPresetTypeId.has("file") && (
          <div className="note-settings-modal__migrate-section">
            <p className="note-settings-modal__label">
              {lang === "en" ? "Migrate attachments to File cards" : "将附件迁移为文件卡片"}
            </p>
            <p className="note-settings-modal__migrate-desc">
              {lang === "en"
                ? "Existing inline attachments will become independent File-type cards with bidirectional links."
                : "现有内嵌附件将变为独立文件卡片，并与原卡片建立双向连接。"}
            </p>
            {migrateResult && (
              <p className="note-settings-modal__migrate-result">
                {lang === "en"
                  ? `Done: ${migrateResult.processed} scanned, ${migrateResult.created} created, ${migrateResult.skipped} skipped.`
                  : `完成：扫描 ${migrateResult.processed} 张卡片，创建 ${migrateResult.created} 个文件卡，跳过 ${migrateResult.skipped} 个。`}
              </p>
            )}
            <button
              type="button"
              className="note-settings-modal__migrate-btn"
              disabled={migrateLoading}
              onClick={handleMigrateAttachments}
            >
              {migrateLoading
                ? (lang === "en" ? "Migrating…" : "迁移中…")
                : (lang === "en" ? "Start Migration" : "开始迁移")}
            </button>
          </div>
        )}
      </div>
    );

  const modalTree = (
    <div
      className="auth-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="auth-modal note-settings-modal note-settings-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="note-settings-modal__shell">
          <nav
            className="note-settings-modal__nav"
            aria-label={c.noteSettingsTitle}
          >
            <p className="note-settings-modal__nav-title" id="note-settings-title">
              {c.noteSettingsTitle}
            </p>
            <button
              type="button"
              className={
                "note-settings-modal__nav-item" +
                (settingsPanel === "general" ? " is-active" : "")
              }
              aria-current={settingsPanel === "general" ? "page" : undefined}
              onClick={() => setSettingsPanel("general")}
            >
              {c.noteSettingsNavGeneral}
            </button>
            <button
              type="button"
              className={
                "note-settings-modal__nav-item" +
                (settingsPanel === "objectTypes" ? " is-active" : "")
              }
              aria-current={
                settingsPanel === "objectTypes" ? "page" : undefined
              }
              onClick={() => setSettingsPanel("objectTypes")}
            >
              {c.noteSettingsNavObjectTypes}
            </button>
            <button
              type="button"
              className={
                "note-settings-modal__nav-item" +
                (settingsPanel === "autoLink" ? " is-active" : "")
              }
              aria-current={settingsPanel === "autoLink" ? "page" : undefined}
              onClick={() => setSettingsPanel("autoLink")}
            >
              {c.noteSettingsNavAutoLink}
            </button>
          </nav>
          <div className="note-settings-modal__main">
            {showRerunAndMigrationTools && NOTE_SETTINGS_POST_MIGRATE_HINTS.length > 0 ? (
              <div
                className="note-settings-modal__post-migrate"
                role="region"
                aria-label={c.noteSettingsPostMigrateAria}
              >
                <p className="note-settings-modal__post-migrate-head">
                  {c.noteSettingsPostMigrateTitle}
                </p>
                {NOTE_SETTINGS_POST_MIGRATE_HINTS.map((h) => (
                  <div
                    key={h.id}
                    className="note-settings-modal__post-migrate-card"
                  >
                    <p className="note-settings-modal__post-migrate-card-title">
                      {lang === "en" ? h.titleEn : h.titleZh}
                    </p>
                    <p className="note-settings-modal__migrate-desc note-settings-modal__post-migrate-body">
                      {lang === "en" ? h.bodyEn : h.bodyZh}
                    </p>
                    {h.focusPanel ? (
                      <button
                        type="button"
                        className="note-settings-modal__post-migrate-jump"
                        onClick={() => setSettingsPanel(h.focusPanel!)}
                      >
                        {h.focusPanel === "general"
                          ? c.noteSettingsPostMigrateJumpGeneral
                          : h.focusPanel === "objectTypes"
                            ? c.noteSettingsPostMigrateJumpObjectTypes
                            : c.noteSettingsPostMigrateJumpAutoLink}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {settingsPanel === "objectTypes" ? (
              <div className="note-settings-modal__content-head">
                <h3
                  className="note-settings-modal__content-title"
                  id="note-settings-object-types-heading"
                >
                  {c.noteSettingsObjectTypesTitle}
                </h3>
                <button
                  type="button"
                  className="note-settings-modal__add-type-btn"
                  title={c.noteSettingsAddCustomType}
                  aria-label={c.noteSettingsAddCustomType}
                  disabled={
                    collections == null ||
                    dataMode !== "remote" ||
                    presetObjectTypesLocked
                  }
                  onClick={() => {
                    if (collections == null || dataMode !== "remote") return;
                    openCreateSubtypeModal();
                  }}
                >
                  <span aria-hidden className="note-settings-modal__add-type-btn-icon">
                    +
                  </span>
                </button>
              </div>
            ) : settingsPanel === "autoLink" ? (
              <div className="note-settings-modal__content-head">
                <h3
                  className="note-settings-modal__content-title"
                  id="note-settings-auto-link-heading"
                >
                  {c.noteSettingsAutoLinkPanelTitle}
                </h3>
              </div>
            ) : null}
            {panelContent}
            {customTypeModal ? (
              <div
                className="note-settings-modal__custom-type-overlay"
                role="presentation"
                onClick={() => {
                  if (!customTypeSaving) setCustomTypeModal(null);
                }}
              >
                <div
                  className="note-settings-modal__custom-type-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="note-settings-custom-type-title"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h4
                    className="note-settings-modal__custom-type-title"
                    id="note-settings-custom-type-title"
                  >
                    {customTypeModal.mode === "create"
                      ? c.noteSettingsCustomTypeTitleCreate
                      : c.noteSettingsCustomTypeTitleEdit}
                  </h4>
                  {customTypeFormErr ? (
                    <p className="note-settings-modal__custom-type-err">
                      {customTypeFormErr}
                    </p>
                  ) : null}
                  <label
                    className="note-settings-modal__label"
                    htmlFor="custom-type-name"
                  >
                    {c.noteSettingsCustomTypeName}
                  </label>
                  <input
                    id="custom-type-name"
                    className="auth-modal__input"
                    value={customTypeDraft.name}
                    onChange={(e) =>
                      setCustomTypeDraft((d) => ({
                        ...d,
                        name: e.target.value,
                      }))
                    }
                    placeholder={c.noteSettingsCustomTypeNamePh}
                  />
                  {customTypeModal.mode === "create" ? (
                    <>
                      <label
                        className="note-settings-modal__label"
                        htmlFor="custom-type-parent"
                      >
                        {c.noteSettingsCustomTypeParent}
                      </label>
                      <select
                        id="custom-type-parent"
                        className="auth-modal__input"
                        value={customTypeDraft.parentId}
                        onChange={(e) =>
                          setCustomTypeDraft((d) => ({
                            ...d,
                            parentId: e.target.value,
                          }))
                        }
                      >
                        <option value="">
                          {c.noteSettingsCustomTypeParentTop}
                        </option>
                        {templateParentContainers.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : null}
                  <p className="note-settings-modal__label">
                    {c.noteSettingsCustomTypeFields}
                  </p>
                  <div className="note-settings-modal__custom-type-fields">
                    {customTypeDraft.fields.map((f, idx) => (
                      <div
                        key={`${f.id ?? "n"}-${idx}`}
                        className="note-settings-modal__custom-type-field-row"
                      >
                        <input
                          className="auth-modal__input"
                          aria-label={c.noteSettingsCustomTypeFieldName}
                          value={f.name}
                          onChange={(e) =>
                            setCustomTypeDraft((d) => {
                              const next = [...d.fields];
                              next[idx] = { ...next[idx], name: e.target.value };
                              return { ...d, fields: next };
                            })
                          }
                        />
                        <select
                          className="auth-modal__input"
                          aria-label={c.noteSettingsCustomTypeFieldType}
                          value={f.type}
                          onChange={(e) =>
                            setCustomTypeDraft((d) => {
                              const next = [...d.fields];
                              next[idx] = {
                                ...next[idx],
                                type: e.target.value as SchemaField["type"],
                              };
                              return { ...d, fields: next };
                            })
                          }
                        >
                          {CUSTOM_SCHEMA_TYPE_OPTIONS.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                        {customTypeDraft.fields.length > 1 ? (
                          <button
                            type="button"
                            className="note-settings-modal__custom-type-remove-field"
                            aria-label={lang === "en" ? "Remove field" : "删除此属性"}
                            onClick={() =>
                              setCustomTypeDraft((d) => ({
                                ...d,
                                fields: d.fields.filter((_, i) => i !== idx),
                              }))
                            }
                          >
                            −
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="auth-modal__btn note-settings-modal__custom-type-add-field"
                    onClick={() =>
                      setCustomTypeDraft((d) => ({
                        ...d,
                        fields: [...d.fields, { name: "", type: "text" }],
                      }))
                    }
                  >
                    {c.noteSettingsCustomTypeAddField}
                  </button>
                  <div className="note-settings-modal__custom-type-actions">
                    <button
                      type="button"
                      className="auth-modal__btn"
                      disabled={customTypeSaving}
                      onClick={() => setCustomTypeModal(null)}
                    >
                      {c.noteSettingsCustomTypeCancel}
                    </button>
                    <button
                      type="button"
                      className="auth-modal__btn auth-modal__btn--primary"
                      disabled={customTypeSaving}
                      onClick={() => void saveCustomTypeForm()}
                    >
                      {customTypeSaving ? "…" : c.noteSettingsCustomTypeSave}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="note-settings-modal__footer-actions">
              <button
                type="button"
                className="auth-modal__btn auth-modal__btn--primary auth-modal__btn--primary--full"
                onClick={onClose}
              >
                {c.done}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalTree, document.body);
}
