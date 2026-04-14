import { htmlToPlainTextForImportCard } from "../noteEditor/plainHtml";

const TEXT_EXT_PRIORITY = [".md", ".markdown", ".txt", ".html", ".htm"] as const;

export type ParsedExportNote = {
  title: string;
  bodyHtml: string;
  attachmentFiles: File[];
  /** 相对导出根目录的文件夹路径（已去掉 iCloud / applenote 等外层），用于恢复侧栏子合集 */
  folderSegments: string[];
  /** 从路径或文件名解析出的日历日与时刻（用于导入时对齐原笔记时间） */
  timeFromFilename?: { addedOn: string; minutesOfDay: number };
};

function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.[^.]+$/);
  return m ? m[0] : "";
}

function isTextExt(ext: string): boolean {
  return (TEXT_EXT_PRIORITY as readonly string[]).includes(ext);
}

/** 列表中的系统/元数据文件，不算「附件」，也不阻止「一夹多条纯文本」拆分 */
function isIgnorableListingFile(name: string): boolean {
  const n = name.trim();
  if (n === ".DS_Store") return true;
  if (n.startsWith("._")) return true;
  if (/^thumbs\.db$/i.test(n)) return true;
  return false;
}

/** 估算正文长度，用于在多个 .txt/.html/.md 中选「主正文」 */
async function measureTextFileBodyLength(f: File): Promise<number> {
  const raw = await f.text();
  const ext = extOf(f.name);
  if (ext === ".html" || ext === ".htm") {
    return htmlToPlainTextForImportCard(raw).length;
  }
  if (ext === ".md" || ext === ".markdown") {
    return stripDataUrlImages(raw).text.length;
  }
  return raw.trim().length;
}

function extPriorityIndex(name: string): number {
  const e = extOf(name);
  const i = (TEXT_EXT_PRIORITY as readonly string[]).indexOf(e);
  return i === -1 ? 99 : i;
}

/**
 * 同一条笔记对应多个文本文件时，取长正文；平局时优先非「附件/资源目录」路径下的文件。
 */
async function pickBestTextFileForGroup(
  group: File[],
  opts?: { tieBreakPreferOutsideAttachments?: boolean }
): Promise<File | null> {
  const texts = group.filter((f) => isTextExt(extOf(f.name)));
  if (texts.length === 0) return null;
  if (texts.length === 1) return texts[0]!;

  const preferOut = opts?.tieBreakPreferOutsideAttachments ?? false;
  const scored: { f: File; score: number }[] = [];
  for (const f of texts) {
    scored.push({ f, score: await measureTextFileBodyLength(f) });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0]!.score;
  const tied = scored.filter((s) => s.score === top);
  if (tied.length === 1) return tied[0]!.f;

  tied.sort((a, b) => {
    if (preferOut) {
      const ap = pathContainsAuxiliaryExportBundleFolder(relativePathOfFile(a.f))
        ? 1
        : 0;
      const bp = pathContainsAuxiliaryExportBundleFolder(relativePathOfFile(b.f))
        ? 1
        : 0;
      if (ap !== bp) return ap - bp;
    }
    return extPriorityIndex(a.f.name) - extPriorityIndex(b.f.name);
  });
  return tied[0]!.f;
}

function dirname(path: string): string {
  const n = path.replace(/\\/g, "/");
  const i = n.lastIndexOf("/");
  return i <= 0 ? "" : n.slice(0, i);
}

function relativePathOfFile(f: File): string {
  return (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
}

/** 去掉导出工具常见顶层目录（iCloud、压缩包根文件夹名等），保留备忘录「笔记本」文件夹名 */
export function normalizeExportFolderSegments(segments: string[]): string[] {
  const stripFirst = new Set([
    "icloud",
    "on my mac",
    "onmymac",
    "applenote",
    "applenotes",
    "apple notes",
    "apple_notes",
  ]);
  const out = [...segments];
  while (out.length > 0) {
    const low = out[0]!.trim().toLowerCase();
    if (stripFirst.has(low)) {
      out.shift();
      continue;
    }
    break;
  }
  return out;
}

/**
 * 苹果备忘录附件目录名：英文名 `(Attachments)` 或含「附件」的括号段（避免把任意含 attachments 字样的文件夹当附件）。
 */
function segmentLooksLikeAppleMemoAttachmentFolder(seg: string): boolean {
  if (/\([^)]*attachments[^)]*\)/i.test(seg)) return true;
  if (/[（(][^）)]*附件[^）)]*[）)]/.test(seg)) return true;
  return false;
}

/** Safari / 浏览器「网页，仅 HTML」另存：与 .html 同名的 `标题_files` 资源子目录 */
function segmentLooksLikeWebHtmlResourceFolder(seg: string): boolean {
  const s = seg.toLowerCase();
  return /_files$/i.test(s) && s.length > 6;
}

function pathContainsAppleMemoAttachmentFolder(rel: string): boolean {
  return rel.split("/").some(segmentLooksLikeAppleMemoAttachmentFolder);
}

function pathContainsWebHtmlResourceFolder(rel: string): boolean {
  return rel.split("/").some(segmentLooksLikeWebHtmlResourceFolder);
}

/** 附件夹（苹果）或 HTML 资源夹（_files），用于平局时优先「非资源目录里的正文」 */
function pathContainsAuxiliaryExportBundleFolder(rel: string): boolean {
  return pathContainsAppleMemoAttachmentFolder(rel) || pathContainsWebHtmlResourceFolder(rel);
}

function filePathIsUnderAppleMemoAttachmentFolder(rel: string): boolean {
  return rel.split("/").some(segmentLooksLikeAppleMemoAttachmentFolder);
}

function filePathIsUnderWebHtmlResourceFolder(rel: string): boolean {
  return rel.split("/").some(segmentLooksLikeWebHtmlResourceFolder);
}

function dedupeFilesByRel(files: File[]): File[] {
  const seen = new Set<string>();
  const out: File[] = [];
  for (const f of files) {
    const k = relativePathOfFile(f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}

/** `标题_files` 是否对应当前 html 主文件名（避免同目录多份网页抢同一资源夹） */
function fileBelongsToWebResourceBundleOfHtml(htmlFile: File, fileRel: string): boolean {
  if (!filePathIsUnderWebHtmlResourceFolder(fileRel)) return false;
  const htmlRel = relativePathOfFile(htmlFile).replace(/\\/g, "/");
  const stem = htmlRel.split("/").pop()!.replace(/\.[^.]+$/, "");
  const parts = fileRel.replace(/\\/g, "/").split("/").filter(Boolean);
  const filesSeg = parts.find(
    (p) => segmentLooksLikeWebHtmlResourceFolder(p)
  );
  if (!filesSeg) return false;
  return filesSeg.toLowerCase() === `${stem.toLowerCase()}_files`;
}

/**
 * 正文与 `同主文件名 (Attachments)/` 为兄弟目录（导出常见），用路径前缀配对（无时间戳时仍可用）。
 */
function relIsUnderSiblingAppleAttachmentFolderOfHtml(
  htmlFile: File,
  otherRel: string
): boolean {
  const htmlRel = relativePathOfFile(htmlFile).replace(/\\/g, "/");
  const dir = dirname(htmlRel);
  const stem = htmlRel.split("/").pop()!.replace(/\.[^.]+$/, "");
  const norm = otherRel.replace(/\\/g, "/");
  const prefixes = [`${dir}/${stem} (Attachments)`, `${dir}/${stem}（附件）`];
  for (const p of prefixes) {
    if (norm === p || norm.startsWith(p + "/")) return true;
  }
  return false;
}

/**
 * 判断某个文件是否应作为该条导出笔记的「附件」：仅苹果 (Attachments)/（附件）内，或该 html 对应的 `stem_files`。
 * 不包含与正文同层的其它图片/子文件夹（如年份目录下的杂文件）。
 */
function fileIsAttachmentForHtmlNote(htmlFile: File, f: File): boolean {
  if (f === htmlFile) return false;
  if (isTextExt(extOf(f.name))) return false;
  if (isIgnorableListingFile(f.name)) return false;
  const rel = relativePathOfFile(f).replace(/\\/g, "/");

  if (filePathIsUnderWebHtmlResourceFolder(rel)) {
    return fileBelongsToWebResourceBundleOfHtml(htmlFile, rel);
  }

  if (filePathIsUnderAppleMemoAttachmentFolder(rel)) {
    const htk = extractTimestampKeyFromRelativePath(relativePathOfFile(htmlFile));
    const ftk = extractTimestampKeyFromRelativePath(rel);
    if (htk && ftk && htk.sortKey === ftk.sortKey) return true;
    return relIsUnderSiblingAppleAttachmentFolderOfHtml(htmlFile, rel);
  }

  return false;
}

function plainTextToCardHtml(text: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const t = text.trim();
  if (!t) return "<p></p>";
  const paras = t.split(/\n\n+/).map((p) => esc(p).replace(/\n/g, "<br>"));
  return paras.map((p) => `<p>${p}</p>`).join("") || "<p></p>";
}

function dataUrlToFile(dataUrl: string, index: number): File | null {
  const m = /^data:(image\/(\w+));base64,(.+)$/is.exec(dataUrl.trim());
  if (!m) return null;
  const mime = m[1]!;
  const subtype = m[2]!.toLowerCase();
  const b64 = m[3]!.replace(/\s/g, "");
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = subtype === "jpeg" ? "jpg" : subtype;
    return new File([bytes], `inline-${index}.${ext}`, { type: mime });
  } catch {
    return null;
  }
}

/** 从 Markdown/HTML 正文中拆出 data URL 图片，便于作为附件上传 */
export function stripDataUrlImages(source: string): { text: string; files: File[] } {
  let idx = 0;
  const files: File[] = [];
  let text = source.replace(
    /!\[[^\]]*\]\((data:image\/[^)]+)\)/gi,
    (_m, dataUrl: string) => {
      const f = dataUrlToFile(dataUrl, idx++);
      if (f) files.push(f);
      return "";
    }
  );
  text = text.replace(
    /<img[^>]+src=["'](data:image\/[^"']+)["'][^>]*>/gi,
    (_m, dataUrl: string) => {
      const f = dataUrlToFile(dataUrl, idx++);
      if (f) files.push(f);
      return "";
    }
  );
  return { text: text.trim(), files };
}

function titleFromDir(dir: string, textFile: File): string {
  const base = textFile.name.replace(/\.[^.]+$/, "");
  if (!dir) return base;
  const seg = dir.split("/").filter(Boolean);
  const last = seg[seg.length - 1];
  return last && last.trim() ? last.trim() : base;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function clampMinutesOfDay(h: number, m: number): number {
  const hh = Math.max(0, Math.min(23, Math.floor(h)));
  const mm = Math.max(0, Math.min(59, Math.floor(m)));
  return hh * 60 + mm;
}

/** 校验并格式化为 YYYY-MM-DD */
function toAddedOn(y: number, mo: number, d: number): string | undefined {
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  const dt = new Date(y, mo - 1, d);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo - 1 ||
    dt.getDate() !== d
  ) {
    return undefined;
  }
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

/**
 * 从路径任一段（文件名或文件夹名）解析「YYYY-MM-DD HHMM」前缀（备忘录 HTML 导出常见）。
 */
function extractTimestampKeyFromRelativePath(
  rel: string
): { sortKey: string; addedOn: string; minutesOfDay: number } | null {
  const segPrefix = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2})(\d{2})/;
  for (const seg of rel.split("/").filter(Boolean)) {
    const m = seg.match(segPrefix);
    if (!m) continue;
    const addedOn = toAddedOn(+m[1]!, +m[2]!, +m[3]!);
    if (!addedOn) continue;
    const minutesOfDay = clampMinutesOfDay(+m[4]!, +m[5]!);
    return { sortKey: `${addedOn}|${minutesOfDay}`, addedOn, minutesOfDay };
  }
  return null;
}

function titleFromAppleFlatNoteFilename(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "");
  return (
    stem.replace(/^(\d{4}-\d{2}-\d{2}\s+\d{4})\s+/, "").trim() || stem
  );
}

/**
 * 从单段字符串（文件夹名、文件名不含扩展名、或路径拼成的提示串）解析日期与时间。
 * 支持常见导出命名：ISO 日期、YYYYMMDD、YYYY-MM-DD HH:mm、YYYY-MM-DD-HH-mm、`_HHmm` 等。
 * 「仅日期」无时刻时默认当天 12:00。
 */
export function parseDateTimeFromAppleExportFilename(
  hint: string
): { addedOn: string; minutesOfDay: number } | undefined {
  const t = hint.trim();
  if (!t) return undefined;

  const pack = (
    y: number,
    mo: number,
    d: number,
    h: number,
    min: number
  ): { addedOn: string; minutesOfDay: number } | undefined => {
    const addedOn = toAddedOn(y, mo, d);
    if (!addedOn) return undefined;
    return { addedOn, minutesOfDay: clampMinutesOfDay(h, min) };
  };

  let m: RegExpMatchArray | null;

  // 2024-03-15T14:30 / 2024-03-15 14:30
  m = t.match(
    /\b(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?(?!\d)/i
  );
  if (m) {
    const r = pack(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!);
    if (r) return r;
  }

  // Apple 备忘录导出 HTML：2025-10-01 2043 标题.html（空格 + 四位 HHMM，无冒号）
  m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\s+(\d{2})(\d{2})\b/);
  if (m) {
    const r = pack(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!);
    if (r) return r;
  }

  // 2024-03-15-14-30（须在「仅 YYYY-MM-DD」之前）
  m = t.match(/\b(\d{4})-(\d{2})-(\d{2})-(\d{1,2})-(\d{2})\b/);
  if (m) {
    const r = pack(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!);
    if (r) return r;
  }

  // 2024-03-15_1430 / 2024-03-15-1430
  m = t.match(/\b(\d{4})-(\d{2})-(\d{2})[-_](\d{2})(\d{2})\b/);
  if (m) {
    const r = pack(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!);
    if (r) return r;
  }

  // 2024_3_15 后接 14-30 / 14.30
  m = t.match(
    /\b(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})[-\sT_]+(\d{1,2})[-.:](\d{2})(?!\d)/i
  );
  if (m) {
    const r = pack(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!);
    if (r) return r;
  }

  // 202403151430 / 20240315_1430
  m = t.match(/\b(20\d{2})(\d{2})(\d{2})[-_]?(\d{2})(\d{2})\b/);
  if (m) {
    const r = pack(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!);
    if (r) return r;
  }

  // 仅日期 YYYY-MM-DD → 12:00
  m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) {
    const r = pack(+m[1]!, +m[2]!, +m[3]!, 12, 0);
    if (r) return r;
  }

  // 仅八位 YYYYMMDD → 12:00
  m = t.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
  if (m) {
    const r = pack(+m[1]!, +m[2]!, +m[3]!, 12, 0);
    if (r) return r;
  }

  return undefined;
}

/** 合并路径与文件名，多候选串依次尝试（子文件夹名、整路径拼成一句、纯文件名） */
export function resolveTimeFromExportPath(
  dir: string,
  textFile: File
): { addedOn: string; minutesOfDay: number } | undefined {
  const stem = textFile.name.replace(/\.[^.]+$/, "");
  const hints: string[] = [];
  if (dir) {
    hints.push(`${dir.replace(/\//g, " ")} ${stem}`);
    const segs = dir.split("/").filter(Boolean);
    if (segs.length) hints.push(segs[segs.length - 1]!);
  }
  hints.push(stem);
  const seen = new Set<string>();
  for (const h of hints) {
    if (seen.has(h)) continue;
    seen.add(h);
    const parsed = parseDateTimeFromAppleExportFilename(h);
    if (parsed) return parsed;
  }
  return undefined;
}

function sortParsedNotes(a: ParsedExportNote, b: ParsedExportNote): number {
  const ta = a.timeFromFilename;
  const tb = b.timeFromFilename;
  if (ta && tb) {
    const c =
      ta.addedOn.localeCompare(tb.addedOn) || ta.minutesOfDay - tb.minutesOfDay;
    if (c !== 0) return c;
  } else if (ta && !tb) return -1;
  else if (!ta && tb) return 1;
  return a.title.localeCompare(b.title, "zh-Hans-CN");
}

/**
 * 仅在「必须用时间戳桶拆开」时使用扁平布局。
 * 若仅因某处有 `(Attachments)`/`_files` 就整树扁平，子文件夹里**文件名无日期前缀**的笔记会被跳过；
 * 子文件夹场景应走按目录解析（附件仍通过全路径 list + 兄弟 `(Attachments)` 配对）。
 */
function shouldUseFlatAppleExportLayout(byDir: Map<string, File[]>): boolean {
  const root = byDir.get("") ?? [];
  const rootTextCount = root.filter((f) => isTextExt(extOf(f.name))).length;
  if (rootTextCount > 1) return true;

  for (const [, group] of byDir) {
    const textFiles = group.filter(
      (f) => isTextExt(extOf(f.name)) && !isIgnorableListingFile(f.name)
    );
    const hasRealBinary = group.some(
      (f) =>
        !isTextExt(extOf(f.name)) && !isIgnorableListingFile(f.name)
    );
    // 同目录多条正文且同层有二进制：按目录会只保留一条，必须按时间戳分组
    if (textFiles.length > 1 && hasRealBinary) return true;
  }
  return false;
}

async function parseAppleNotesFlatExport(
  files: File[]
): Promise<ParsedExportNote[]> {
  const list = Array.from(files);
  const byKey = new Map<
    string,
    { files: File[]; addedOn: string; minutesOfDay: number }
  >();

  for (const f of list) {
    const rel = relativePathOfFile(f);
    const keyData = extractTimestampKeyFromRelativePath(rel);
    if (!keyData) continue;
    const { sortKey, addedOn, minutesOfDay } = keyData;
    if (!byKey.has(sortKey)) {
      byKey.set(sortKey, { files: [], addedOn, minutesOfDay });
    }
    byKey.get(sortKey)!.files.push(f);
  }

  const out: ParsedExportNote[] = [];
  for (const [, bucket] of byKey) {
    const { files: group } = bucket;
    const textFile = await pickBestTextFileForGroup(group, {
      tieBreakPreferOutsideAttachments: true,
    });
    if (!textFile) continue;

    const { bodyHtml, inlineFiles } = await fileToBodyAndExtras(textFile);
    const textTk = extractTimestampKeyFromRelativePath(relativePathOfFile(textFile));
    if (!textTk) continue;
    const attachmentFiles = list.filter((f) => {
      const fk = extractTimestampKeyFromRelativePath(relativePathOfFile(f));
      if (fk?.sortKey !== textTk.sortKey) return false;
      return fileIsAttachmentForHtmlNote(textFile, f);
    });

    const title = titleFromAppleFlatNoteFilename(textFile.name);
    const dirOnly = dirname(relativePathOfFile(textFile));
    const folderSegments = normalizeExportFolderSegments(
      dirOnly.split("/").filter(Boolean)
    );
    out.push({
      title,
      bodyHtml,
      attachmentFiles: [...dedupeFilesByRel(attachmentFiles), ...inlineFiles],
      folderSegments,
      timeFromFilename: {
        addedOn: textTk.addedOn,
        minutesOfDay: textTk.minutesOfDay,
      },
    });
  }
  out.sort(sortParsedNotes);
  return out;
}

async function fileToBodyAndExtras(
  textFile: File
): Promise<{ bodyHtml: string; inlineFiles: File[] }> {
  const ext = extOf(textFile.name);
  const raw = await textFile.text();
  let inlineFiles: File[] = [];

  if (ext === ".html" || ext === ".htm") {
    return {
      bodyHtml: plainTextToCardHtml(htmlToPlainTextForImportCard(raw)),
      inlineFiles: [],
    };
  }

  if (ext === ".md" || ext === ".markdown") {
    const stripped = stripDataUrlImages(raw);
    inlineFiles = stripped.files;
    return {
      bodyHtml: plainTextToCardHtml(stripped.text),
      inlineFiles,
    };
  }

  return {
    bodyHtml: plainTextToCardHtml(raw),
    inlineFiles: [],
  };
}

/**
 * 按「每条笔记一个文件夹」解析；附件仅来自苹果 `(Attachments)`/`（附件）` 或对应 `stem_files`，
 * 不会把同层其它二进制或嵌套子目录一律当作附件。
 * 依赖 input[type=file] 的 webkitdirectory 提供的相对路径。
 */
export async function parseAppleNotesExportDirectory(
  files: File[]
): Promise<ParsedExportNote[]> {
  const list = Array.from(files);
  const byDir = new Map<string, File[]>();
  for (const f of list) {
    const rel = relativePathOfFile(f);
    const dir = dirname(rel);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(f);
  }

  if (shouldUseFlatAppleExportLayout(byDir)) {
    return parseAppleNotesFlatExport(list);
  }

  const out: ParsedExportNote[] = [];
  for (const [dir, group] of byDir) {
    const textFiles = group.filter(
      (f) => isTextExt(extOf(f.name)) && !isIgnorableListingFile(f.name)
    );
    const hasRealBinary = group.some(
      (f) =>
        !isTextExt(extOf(f.name)) && !isIgnorableListingFile(f.name)
    );

    // 苹果「笔记本」导出：同一文件夹内多条独立 .html，无图片/音视频等 → 每条一条卡片
    if (textFiles.length > 1 && !hasRealBinary) {
      textFiles.sort((a, b) =>
        a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true })
      );
      for (const textFile of textFiles) {
        const { bodyHtml, inlineFiles } = await fileToBodyAndExtras(textFile);
        const title = titleFromAppleFlatNoteFilename(textFile.name);
        const timeFromFilename = resolveTimeFromExportPath(dir, textFile);
        const folderSegments = normalizeExportFolderSegments(
          dir.split("/").filter(Boolean)
        );
        const attachmentFiles = list.filter((f) =>
          fileIsAttachmentForHtmlNote(textFile, f)
        );
        out.push({
          title,
          bodyHtml,
          attachmentFiles: [...dedupeFilesByRel(attachmentFiles), ...inlineFiles],
          folderSegments,
          ...(timeFromFilename ? { timeFromFilename } : {}),
        });
      }
      continue;
    }

    const textFile = await pickBestTextFileForGroup(group, {
      tieBreakPreferOutsideAttachments: false,
    });
    if (!textFile) continue;
    const { bodyHtml, inlineFiles } = await fileToBodyAndExtras(textFile);
    const attachmentFiles = list.filter((f) =>
      fileIsAttachmentForHtmlNote(textFile, f)
    );
    const title = titleFromDir(dir, textFile);
    const timeFromFilename = resolveTimeFromExportPath(dir, textFile);
    const folderSegments = normalizeExportFolderSegments(
      dir.split("/").filter(Boolean)
    );
    out.push({
      title,
      bodyHtml,
      attachmentFiles: [...dedupeFilesByRel(attachmentFiles), ...inlineFiles],
      folderSegments,
      ...(timeFromFilename ? { timeFromFilename } : {}),
    });
  }
  out.sort(sortParsedNotes);
  return out;
}

/** 多选零散文本文件：每个文件单独一条笔记（无同目录附件） */
export async function parseAppleNotesExportLooseTextFiles(
  files: File[]
): Promise<ParsedExportNote[]> {
  const out: ParsedExportNote[] = [];
  for (const f of files) {
    if (!isTextExt(extOf(f.name))) continue;
    const title = f.name.replace(/\.[^.]+$/, "");
    const { bodyHtml, inlineFiles } = await fileToBodyAndExtras(f);
    const timeFromFilename = resolveTimeFromExportPath("", f);
    out.push({
      title,
      bodyHtml,
      attachmentFiles: inlineFiles,
      folderSegments: [],
      ...(timeFromFilename ? { timeFromFilename } : {}),
    });
  }
  out.sort(sortParsedNotes);
  return out;
}
