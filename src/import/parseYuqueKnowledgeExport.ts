import { marked } from "marked";
import type { ParsedExportNote } from "./parseAppleNotesExport";
import {
  normalizeExportFolderSegments,
  resolveTimeFromExportPath,
  stripDataUrlImages,
} from "./parseAppleNotesExport";

function relPathOf(f: File): string {
  return (
    (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
  ).replace(/\\/g, "/");
}

function dirnameOf(rel: string): string {
  const n = rel.replace(/\\/g, "/");
  const i = n.lastIndexOf("/");
  return i <= 0 ? "" : n.slice(0, i);
}

/** 归并 `.` / `..`，得到 zip/webkit 相对路径键 */
function normalizeRelKey(parts: string[]): string {
  const stack: string[] = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") stack.pop();
    else stack.push(p);
  }
  return stack.join("/");
}

/**
 * 将语雀 Markdown 里相对资源路径（如 `images/a.png`）解析为导出根下的相对路径键。
 */
function resolveYuqueAssetKey(mdDir: string, src: string): string {
  let s = src.trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep */
  }
  if (!s || /^https?:\/\//i.test(s) || s.startsWith("data:")) return "";
  s = s.replace(/^\.\//, "");
  const base = mdDir.replace(/\/+$/, "");
  const joined = base ? `${base}/${s}` : s;
  return normalizeRelKey(joined.split("/").filter(Boolean));
}

/** `![](url)` 或 `![](url "title")`：取第一段为路径 */
const MD_IMAGE_RE = /!\[[^\]]*\]\(\s*([^)]+)\s*\)/g;
const HTML_IMG_RE = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;

function titleFromYuqueMarkdown(raw: string, filename: string): string {
  const m = /^\s*#\s+(.+)$/m.exec(raw);
  if (m) return m[1]!.trim().slice(0, 300);
  return filename.replace(/\.[^.]+$/, "");
}

/**
 * 解析语雀「知识库 → Markdown」导出目录（或 ZIP 解压后的虚拟文件列表）。
 * 每条 `.md` 一篇卡片；正文内 **相对路径** 的图片从 Markdown / HTML `<img>` 中移除并作为附件上传。
 * `http(s)` / `data:` 图片保留在正文中。
 */
export async function parseYuqueKnowledgeExportDirectory(
  files: File[]
): Promise<ParsedExportNote[]> {
  const list = Array.from(files);
  const mdFiles = list.filter((f) => /\.(md|markdown)$/i.test(relPathOf(f)));
  if (mdFiles.length === 0) return [];

  const pathIndex = new Map<string, File>();
  for (const f of list) {
    const r = relPathOf(f).replace(/^\//, "");
    pathIndex.set(r, f);
  }

  const out: ParsedExportNote[] = [];

  for (const mdFile of mdFiles) {
    const mdRel = relPathOf(mdFile).replace(/^\//, "");
    const mdDir = dirnameOf(mdRel);
    let raw = await mdFile.text();
    const title = titleFromYuqueMarkdown(raw, mdFile.name);

    const attachmentFiles: File[] = [];
    const seenKeys = new Set<string>();

    const attachIfPresent = (key: string) => {
      if (!key || seenKeys.has(key)) return;
      const f = pathIndex.get(key);
      if (!f) return;
      seenKeys.add(key);
      attachmentFiles.push(f);
    };

    raw = raw.replace(MD_IMAGE_RE, (full, inner: string) => {
      const src = inner.trim().split(/\s+/)[0] ?? "";
      const key = resolveYuqueAssetKey(mdDir, src);
      if (!key) return full;
      attachIfPresent(key);
      return "";
    });

    raw = raw.replace(HTML_IMG_RE, (full, src: string) => {
      const key = resolveYuqueAssetKey(mdDir, src);
      if (!key) return full;
      attachIfPresent(key);
      return "";
    });

    const stripped = stripDataUrlImages(raw);
    for (const f of stripped.files) {
      attachmentFiles.push(f);
    }

    const mdRemain = stripped.text.trim();
    const parsed = await marked(mdRemain || "", { async: true, gfm: true });
    let bodyHtml = typeof parsed === "string" ? parsed : String(parsed);
    if (!bodyHtml.trim()) bodyHtml = "<p></p>";

    const folderSegments = normalizeExportFolderSegments(
      mdDir.split("/").filter(Boolean)
    );
    const timeFromFilename = resolveTimeFromExportPath(mdDir, mdFile);

    out.push({
      title,
      bodyHtml,
      attachmentFiles,
      folderSegments,
      ...(timeFromFilename ? { timeFromFilename } : {}),
    });
  }

  out.sort((a, b) =>
    a.title.localeCompare(b.title, "zh-Hans-CN", { numeric: true })
  );
  return out;
}
