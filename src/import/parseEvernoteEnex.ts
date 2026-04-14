import {
  normalizeExportFolderSegments,
  type ParsedExportNote,
} from "./parseAppleNotesExport";

function relativePathOfFile(f: File): string {
  return (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
}

function dirnameOfPath(path: string): string {
  const n = path.replace(/\\/g, "/");
  const i = n.lastIndexOf("/");
  return i <= 0 ? "" : n.slice(0, i);
}

/** 去掉常见导出根目录名（如 output、zip 顶层），再套用苹果侧栏同款归一化 */
function normalizeEvernoteExportSegments(segments: string[]): string[] {
  const roots = new Set([
    "output",
    "output_dir",
    "export",
    "enex",
    "evernote export",
    "yinxiang",
  ]);
  const s = [...segments];
  while (s.length > 0) {
    const low = s[0]!.trim().toLowerCase();
    if (roots.has(low)) {
      s.shift();
      continue;
    }
    break;
  }
  return normalizeExportFolderSegments(s);
}

function folderSegmentsForEnexFile(f: File): string[] {
  const rel = relativePathOfFile(f).replace(/\\/g, "/");
  const dir = dirnameOfPath(rel);
  if (!dir) return [];
  return normalizeEvernoteExportSegments(dir.split("/").filter(Boolean));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Evernote: 20251126T154132Z */
function parseEvernoteTimestamp(
  raw: string | null | undefined
): { addedOn: string; minutesOfDay: number } | undefined {
  if (!raw) return undefined;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(raw.trim());
  if (!m) return undefined;
  const [, y, mo, d, h, mi] = m;
  return {
    addedOn: `${y}-${mo}-${d}`,
    minutesOfDay: Number(h) * 60 + Number(mi),
  };
}

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("png")) return ".png";
  if (m.includes("jpeg") || m.includes("jpg")) return ".jpg";
  if (m.includes("gif")) return ".gif";
  if (m.includes("webp")) return ".webp";
  if (m.includes("pdf")) return ".pdf";
  if (m.includes("audio")) return ".m4a";
  if (m.includes("video")) return ".mp4";
  return ".bin";
}

function firstChildText(
  parent: Element,
  local: string
): string | null {
  for (const c of parent.children) {
    if (c.localName.toLowerCase() === local.toLowerCase()) {
      return c.textContent?.trim() ?? null;
    }
  }
  return null;
}

function parseResourceFile(resEl: Element, idx: number): File | null {
  let dataEl: Element | null = null;
  for (const c of resEl.children) {
    if (c.localName.toLowerCase() === "data") {
      dataEl = c;
      break;
    }
  }
  if (!dataEl) return null;
  const enc = (dataEl.getAttribute("encoding") ?? "").toLowerCase();
  if (enc.includes("aes")) return null;
  const b64 = (dataEl.textContent ?? "").replace(/\s/g, "");
  if (!b64) return null;
  let bytes: Uint8Array;
  try {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return null;
  }
  let mime = "application/octet-stream";
  for (const c of resEl.children) {
    if (c.localName.toLowerCase() === "mime") {
      const t = c.textContent?.trim();
      if (t) mime = t;
      break;
    }
  }
  let name: string | null = null;
  for (const c of resEl.children) {
    if (c.localName.toLowerCase() !== "resource-attributes") continue;
    const fn = firstChildText(c, "file-name");
    if (fn) name = fn;
    break;
  }
  if (!name) name = `attachment-${idx + 1}${extFromMime(mime)}`;
  return new File([bytes], name, { type: mime });
}

/** 将未加密的 ENML 粗转为可放进卡片的 HTML（不保证版式完全一致） */
function enmlToSimpleHtml(enml: string): string {
  let h = enml.replace(/<\?xml[^?]*\?>/i, "");
  h = h
    .replace(/<en-note[^>]*>/i, "<div>")
    .replace(/<\/en-note>/i, "</div>");
  h = h.replace(/<en-media[^>]*\/?>/gi, "<p><em>[attachment]</em></p>");
  h = h.replace(/<en-todo[^>]*\/?>/gi, "<input type=\"checkbox\" disabled /> ");
  return h.trim() || "<p></p>";
}

function buildCardBodyHtml(
  title: string,
  contentEl: Element | null,
  encryptedBodyHtml: string,
  compressedFallbackHtml: string
): string {
  const h1 = `<h1>${escapeHtml(title)}</h1>`;
  if (!contentEl) return `${h1}<p></p>`;

  const encoding = (contentEl.getAttribute("encoding") ?? "").toLowerCase();
  const raw = contentEl.textContent?.trim() ?? "";

  if (encoding.includes("aes")) {
    return `${h1}${encryptedBodyHtml}`;
  }

  if (raw.startsWith("<?xml") || raw.includes("<en-note")) {
    return `${h1}${enmlToSimpleHtml(raw)}`;
  }

  if (
    encoding === "base64" ||
    (encoding.startsWith("base64") && !encoding.includes("aes"))
  ) {
    return `${h1}${compressedFallbackHtml}`;
  }

  if (raw.length > 0) {
    return `${h1}${enmlToSimpleHtml(raw)}`;
  }

  return `${h1}<p></p>`;
}

/**
 * 解析印象笔记 / Evernote 导出的 ENEX（主要为 .enex；目录扫描时也可包含其它 Evernote XML 导出名）。
 * 若正文为 `base64:aes`（印象加密导出），无法解密，仅保留标题、时间与未加密 resource 附件。
 */
export function parseEvernoteEnexXml(
  xml: string,
  opts: {
    encryptedBodyHtml: string;
    compressedBodyHtml: string;
  },
  folderSegments: string[] = []
): ParsedExportNote[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("evernote-xml-parse");
  }

  const notes = doc.getElementsByTagName("note");
  const out: ParsedExportNote[] = [];

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]!;
    const title =
      note.getElementsByTagName("title")[0]?.textContent?.trim() || "Untitled";

    let contentEl: Element | null = null;
    for (const c of note.children) {
      if (c.localName.toLowerCase() === "content") {
        contentEl = c;
        break;
      }
    }

    const bodyHtml = buildCardBodyHtml(
      title,
      contentEl,
      opts.encryptedBodyHtml,
      opts.compressedBodyHtml
    );

    const created =
      note.getElementsByTagName("created")[0]?.textContent ?? undefined;
    const tf = parseEvernoteTimestamp(created);

    const attachmentFiles: File[] = [];
    const resources = note.getElementsByTagName("resource");
    for (let r = 0; r < resources.length; r++) {
      const f = parseResourceFile(resources[r]!, r);
      if (f) attachmentFiles.push(f);
    }

    out.push({
      title,
      bodyHtml,
      attachmentFiles,
      folderSegments,
      ...(tf ? { timeFromFilename: tf } : {}),
    });
  }

  return out;
}

function isEvernoteExportFile(f: File): boolean {
  const n = f.name.toLowerCase();
  return n.endsWith(".enex") || n.endsWith(".notes") || n.endsWith(".xml");
}

/** 从「选文件夹 / 多文件 / zip 解压」得到的文件列表解析 ENEX */
export async function parseEvernoteEnexFromFiles(
  files: File[],
  opts: {
    encryptedBodyHtml: string;
    compressedBodyHtml: string;
  }
): Promise<ParsedExportNote[]> {
  const targets = files.filter(isEvernoteExportFile);
  if (targets.length === 0) return [];

  const merged: ParsedExportNote[] = [];
  for (const f of targets) {
    try {
      const xml = await f.text();
      const folderSegments = folderSegmentsForEnexFile(f);
      merged.push(...parseEvernoteEnexXml(xml, opts, folderSegments));
    } catch {
      /* 同目录下可能有非 ENEX 的 .xml，跳过 */
    }
  }
  return merged;
}
