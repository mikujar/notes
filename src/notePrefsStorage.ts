import type { UserNotePrefs } from "./types";

const NOTE_PREFS_STORAGE_KEY = "mikujar-note-prefs-v1";

function emptyPrefs(): UserNotePrefs {
  return { disabledAutoLinkRuleIds: [] };
}

export function loadLocalNotePrefs(): UserNotePrefs {
  try {
    const raw = localStorage.getItem(NOTE_PREFS_STORAGE_KEY);
    if (!raw) return emptyPrefs();
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== "object") return emptyPrefs();
    const o = p as Record<string, unknown>;
    const dis = Array.isArray(o.disabledAutoLinkRuleIds)
      ? o.disabledAutoLinkRuleIds.filter((x): x is string => typeof x === "string")
      : [];
    const extra = Array.isArray(o.extraAutoLinkRules) ? o.extraAutoLinkRules : undefined;
    const clipCreatorTargetCollectionByPreset =
      o.clipCreatorTargetCollectionByPreset &&
      typeof o.clipCreatorTargetCollectionByPreset === "object"
        ? {
            ...(typeof (o.clipCreatorTargetCollectionByPreset as Record<string, unknown>).post_xhs ===
            "string"
              ? {
                  post_xhs: String(
                    (o.clipCreatorTargetCollectionByPreset as Record<string, unknown>)
                      .post_xhs
                  ).trim(),
                }
              : {}),
            ...(typeof (o.clipCreatorTargetCollectionByPreset as Record<string, unknown>)
              .post_bilibili === "string"
              ? {
                  post_bilibili: String(
                    (o.clipCreatorTargetCollectionByPreset as Record<string, unknown>)
                      .post_bilibili
                  ).trim(),
                }
              : {}),
          }
        : undefined;
    const tgr = o.timelineGalleryOnRight;
    return {
      disabledAutoLinkRuleIds: dis,
      ...(Array.isArray(extra) ? { extraAutoLinkRules: extra as UserNotePrefs["extraAutoLinkRules"] } : {}),
      ...(clipCreatorTargetCollectionByPreset &&
      (clipCreatorTargetCollectionByPreset.post_xhs ||
        clipCreatorTargetCollectionByPreset.post_bilibili)
        ? { clipCreatorTargetCollectionByPreset }
        : {}),
      ...(typeof tgr === "boolean" ? { timelineGalleryOnRight: tgr } : {}),
    };
  } catch {
    return emptyPrefs();
  }
}

export function saveLocalNotePrefs(prefs: UserNotePrefs): void {
  try {
    localStorage.setItem(NOTE_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota */
  }
}
