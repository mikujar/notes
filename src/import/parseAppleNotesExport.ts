import { htmlToPlainText } from "../noteEditor/plainHtml";

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

/** 估算正文长度，用于在多个 .txt/.html/.md 中选「主正文」 */
async function measureTextFileBodyLength(f: File): Promise<number> {
  const raw = await f.text();
  const ext = extOf(f.name);
  if (ext === ".html" || ext === ".htm") {
    return htmlToPlainText(raw).length;
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
      const ap = pathContainsAttachmentsFolder(relativePathOfFile(a.f))
        ? 1
        : 0;
      const bp = pathContainsAttachmentsFolder(relativePathOfFile(b.f))
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
 * 苹果备忘录：(Attachments)/「附件」夹；HTML 另存常见 `标题_files` 资源子目录（无「Attachments」字样）。
 */
function pathContainsAttachmentsFolder(rel: string): boolean {
  return rel.split("/").some((seg) => {
    const s = seg.toLowerCase();
    if (s.includes("attachments")) return true;
    if (seg.includes("(") && seg.includes("附件")) return true;
    if (/_files$/i.test(s) && s.length > 6) return true;
    return false;
  });
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

/** 根目录多个 .html，或存在附件/资源子目录，或 `_files` 资源夹时：按「日期+时间」前缀分组 */
function shouldUseFlatAppleExportLayout(
  files: File[],
  byDir: Map<string, File[]>
): boolean {
  const anyAtt = files.some((f) =>
    pathContainsAttachmentsFolder(relativePathOfFile(f))
  );
  const root = byDir.get("") ?? [];
  const rootTextCount = root.filter((f) => isTextExt(extOf(f.name))).length;
  return anyAtt || rootTextCount > 1;
}

async function parseAppleNotesFlatExport(
  files: File[]
): Promise<ParsedExportNote[]> {
  const byKey = new Map<
    string,
    { files: File[]; addedOn: string; minutesOfDay: number }
  >();

  for (const f of files) {
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
    const { files: group, addedOn, minutesOfDay } = bucket;
    const textFile = await pickBestTextFileForGroup(group, {
      tieBreakPreferOutsideAttachments: true,
    });
    if (!textFile) continue;

    const { bodyHtml, inlineFiles } = await fileToBodyAndExtras(textFile);
    // 无 (Attachments) 时，同时间戳桶内仍可能有 .heic/.png 等与正文并列；非文本一律作附件（与按文件夹解析一致）
    const attachmentFiles = group.filter((f) => {
      if (f === textFile) return false;
      if (isTextExt(extOf(f.name))) return false;
      return true;
    });

    const title = titleFromAppleFlatNoteFilename(textFile.name);
    const dirOnly = dirname(relativePathOfFile(textFile));
    const folderSegments = normalizeExportFolderSegments(
      dirOnly.split("/").filter(Boolean)
    );
    out.push({
      title,
      bodyHtml,
      attachmentFiles: [...attachmentFiles, ...inlineFiles],
      folderSegments,
      timeFromFilename: { addedOn, minutesOfDay },
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
      bodyHtml: plainTextToCardHtml(htmlToPlainText(raw)),
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
 * 按「每条笔记一个文件夹」解析（同目录下正文 + 图片等；未必有 (Attachments) 子目录）。
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

  if (shouldUseFlatAppleExportLayout(list, byDir)) {
    return parseAppleNotesFlatExport(list);
  }

  const out: ParsedExportNote[] = [];
  for (const [dir, group] of byDir) {
    const textFile = await pickBestTextFileForGroup(group, {
      tieBreakPreferOutsideAttachments: false,
    });
    if (!textFile) continue;
    const { bodyHtml, inlineFiles } = await fileToBodyAndExtras(textFile);
    const attachmentFiles = group.filter((f) => {
      if (f === textFile) return false;
      if (isTextExt(extOf(f.name))) return false;
      return true;
    });
    const title = titleFromDir(dir, textFile);
    const timeFromFilename = resolveTimeFromExportPath(dir, textFile);
    const folderSegments = normalizeExportFolderSegments(
      dir.split("/").filter(Boolean)
    );
    out.push({
      title,
      bodyHtml,
      attachmentFiles: [...attachmentFiles, ...inlineFiles],
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
