import { randomBytes } from "crypto";
import { existsSync } from "fs";
import { createRequire } from "module";
import { spawn, spawnSync } from "child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import ffmpegStatic from "ffmpeg-static";
import { parseBuffer } from "music-metadata";
import sharp from "sharp";

const nodeRequire = createRequire(import.meta.url);
import {
  buildObjectPublicUrl,
  cosMediaPrefix,
  getCosObjectBuffer,
  isCosConfigured,
  putCosObject,
} from "./storage.js";

/** @param {string | undefined | null} userId */
function mediaPathSegment(userId) {
  if (userId == null || userId === "") return null;
  const s = String(userId).replace(/[^a-zA-Z0-9._-]/g, "_");
  return s.length > 0 ? s : null;
}

/**
 * 校验对象键是否属于当前上传策略（与 planMediaCosDirectUpload 生成规则一致）
 * @param {string | null | undefined} userId — admin 多用户时为登录用户；单站无用户时为 undefined
 */
export function assertMediaKeyAllowedForUpload(key, userId) {
  const sub = mediaPathSegment(userId);
  const cosSub = sub ? `${cosMediaPrefix()}/${sub}` : cosMediaPrefix();
  const prefix = `${cosSub}/`;
  const k = String(key ?? "").replace(/^\//, "");
  if (!k.startsWith(prefix)) {
    throw new Error("无效的对象路径");
  }
}

/** 对象键已在 media/ 下时，主文件名只做安全约束（不限定直传 token 形态，便于中文标题等） */
const MAX_MEDIA_FILENAME_STEM_LEN = 480;

/** @param {string} stem 不含扩展名的主文件名 */
function isAllowedCosMediaFilenameStem(stem) {
  const s = String(stem || "").trim();
  if (!s || s.length > MAX_MEDIA_FILENAME_STEM_LEN) return false;
  if (s.includes("..") || s.includes("/") || s.includes("\\")) return false;
  if (/[\u0000-\u001f\u007f]/.test(s)) return false;
  return true;
}

/** 写入 COS/磁盘的封面上限；再大则尝试 sharp 压图，仍过大则跳过 */
const MAX_EMBEDDED_COVER_BYTES = 512 * 1024;
/** 允许尝试压缩的原始内嵌图上限（避免异常大图占满内存） */
const MAX_EMBEDDED_COVER_SHRINK_INPUT_BYTES = 12 * 1024 * 1024;

/**
 * 按文件头识别内嵌图真实类型（优于依赖标签里的 format，避免错标为 jpg 导致浏览器裂图）
 * @param {Buffer} buf
 * @returns {{ mimeType: string; ext: string } | null}
 */
function sniffEmbeddedImageBuffer(buf) {
  if (!buf || buf.length < 12) return null;
  const b = buf;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { mimeType: "image/jpeg", ext: "jpg" };
  }
  if (
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return { mimeType: "image/png", ext: "png" };
  }
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return { mimeType: "image/gif", ext: "gif" };
  }
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return { mimeType: "image/webp", ext: "webp" };
  }
  if (b[0] === 0x42 && b[1] === 0x4d) {
    return { mimeType: "image/bmp", ext: "bmp" };
  }
  /** TIFF：常见于 iTunes/部分工具写入；标签常误标为 image/jpeg，Chrome <img> 也不支持 TIFF */
  if (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a) {
    return { mimeType: "image/tiff", ext: "tiff" };
  }
  if (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) {
    return { mimeType: "image/tiff", ext: "tiff" };
  }
  return null;
}

/**
 * @param {string | undefined} fmtRaw music-metadata picture.format
 */
function imageTypeFromPictureFormat(fmtRaw) {
  const fmt = String(fmtRaw || "").toLowerCase();
  if (!fmt) return null;
  if (fmt.includes("png")) return { mimeType: "image/png", ext: "png" };
  if (fmt.includes("gif")) return { mimeType: "image/gif", ext: "gif" };
  if (fmt.includes("webp")) return { mimeType: "image/webp", ext: "webp" };
  if (fmt.includes("bmp") || fmt.includes("bitmap")) {
    return { mimeType: "image/bmp", ext: "bmp" };
  }
  if (fmt.includes("tiff") || /(^|\/)tif\b/i.test(fmt)) {
    return { mimeType: "image/tiff", ext: "tiff" };
  }
  if (fmt.includes("jpeg") || fmt.includes("jpg")) {
    return { mimeType: "image/jpeg", ext: "jpg" };
  }
  return null;
}

/** 已知 MIME → 稳定扩展名；其余类型从原始文件名或 MIME 子类型推断 */
const MIME_TO_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  /** iPhone 默认照片；浏览器普遍不能直接解码，finalize 时转 JPEG */
  "image/heic": "heic",
  "image/heif": "heif",
  "image/tiff": "tiff",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  /** Matroska：扩展名在 EXT_TO_MIME 中需为 video/*，否则 kindFromMime 会当成 file → not_video */
  "video/x-matroska": "mkv",
  "video/ogg": "ogv",
  "application/pdf": "pdf",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/aac": "aac",
  "audio/x-aac": "aac",
  "audio/opus": "opus",
};

const MAX_MB = Math.min(
  500,
  Math.max(1, Number(process.env.UPLOAD_MAX_MB || 100))
);
export const UPLOAD_MAX_BYTES = MAX_MB * 1024 * 1024;

export function getMediaUploadMode(hasPublicStaticDir) {
  if (isCosConfigured()) return "cos";
  if (hasPublicStaticDir) return "local";
  return null;
}

function normalizeMime(m) {
  const s = String(m ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  return s || "application/octet-stream";
}

function kindFromMime(mimetype) {
  const m = normalizeMime(mimetype);
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "file";
}

/** 仅取文件名中最后一个「安全」扩展名 */
function safeExtFromOriginalName(originalname) {
  const base =
    typeof originalname === "string" && originalname.trim()
      ? basename(originalname.trim())
      : "";
  const m = /^.+\.([a-zA-Z0-9]{1,16})$/.exec(base);
  return m ? m[1].toLowerCase() : null;
}

function extForStoredFile(mimetype, originalname) {
  const m = normalizeMime(mimetype);
  if (MIME_TO_EXT[m]) return MIME_TO_EXT[m];
  const fromName = safeExtFromOriginalName(originalname);
  if (fromName) return fromName;
  if (m === "application/octet-stream") return "bin";
  const sub = m.split("/")[1]?.replace(/[^a-z0-9+.-]/gi, "") ?? "";
  if (sub.length >= 1 && sub.length <= 16) return sub.slice(0, 16);
  return "bin";
}

/**
 * 浏览器普遍不支持在 <img> 中直接显示 TIFF；转为 JPEG 再上传。
 * @param {Buffer} buf
 * @returns {Promise<{ buffer: Buffer; mimeType: string; ext: string } | null>}
 */
async function tiffCoverToJpeg(buf) {
  try {
    const out = await sharp(buf).rotate().jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    if (!out.length || out.length > MAX_EMBEDDED_COVER_BYTES) return null;
    return { buffer: out, mimeType: "image/jpeg", ext: "jpg" };
  } catch {
    return null;
  }
}

/**
 * 专辑内嵌图常见 600KB～2MB，超过 MAX_EMBEDDED_COVER_BYTES 时压成 JPEG 再入库。
 * @param {Buffer} buf
 * @returns {Promise<{ buffer: Buffer; mimeType: string; ext: string } | null>}
 */
async function shrinkOversizedEmbeddedCoverToJpeg(buf) {
  if (buf.length <= MAX_EMBEDDED_COVER_BYTES) return null;
  if (buf.length > MAX_EMBEDDED_COVER_SHRINK_INPUT_BYTES) return null;
  try {
    let out = await sharp(buf)
      .rotate()
      .resize(1400, 1400, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    if (out.length > MAX_EMBEDDED_COVER_BYTES) {
      out = await sharp(buf)
        .rotate()
        .resize(800, 800, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 76, mozjpeg: true })
        .toBuffer();
    }
    if (!out.length || out.length > MAX_EMBEDDED_COVER_BYTES) return null;
    return { buffer: out, mimeType: "image/jpeg", ext: "jpg" };
  } catch {
    return null;
  }
}

function attachmentDisplayName(originalname) {
  const raw =
    typeof originalname === "string" && originalname.trim()
      ? basename(originalname)
      : "";
  return raw.slice(0, 160) || "附件";
}

/**
 * B 站合并成片：把投稿标题收成安全的展示用 originalname（仅 mp4）。
 * @param {string} raw
 * @param {string} [fallback]
 */
export function sanitizeClipOriginalFilenameForMerge(
  raw,
  fallback = "bilibili-clip.mp4"
) {
  const fb =
    typeof fallback === "string" && fallback.trim()
      ? basename(fallback.trim())
      : "bilibili-clip.mp4";
  let s = String(raw ?? "")
    .trim()
    .replace(/\r|\n|\t/g, " ")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim();
  if (!s) return fb;
  s = basename(s.replace(/^\.+/, ""));
  if (!s || s === "." || s === "..") return fb;
  s = s.replace(/\.(mp4|m4v|mov|webm|mkv)$/gi, "").trim() || fb.replace(/\.mp4$/i, "");
  if (!s) return fb;
  const out = `${s}.mp4`;
  return out.slice(0, 160);
}

/**
 * 从 MP3/FLAC/M4A 等标签中取出第一张内嵌图，供封面展示。
 * @returns {{ buffer: Buffer; mimeType: string; ext: string } | null}
 */
async function tryExtractEmbeddedAudioCover(buffer, mimeType) {
  try {
    const md = await parseBuffer(
      new Uint8Array(buffer),
      { mimeType },
      { duration: false }
    );
    const pictures = md.common.picture;
    if (!Array.isArray(pictures) || pictures.length === 0) return null;

    for (const pic of pictures) {
      if (!pic?.data?.length) continue;
      let buf = Buffer.from(pic.data);
      if (buf.length > MAX_EMBEDDED_COVER_BYTES) {
        const shrunk = await shrinkOversizedEmbeddedCoverToJpeg(buf);
        if (shrunk) return shrunk;
        continue;
      }
      const sniffed = sniffEmbeddedImageBuffer(buf);
      const fromTag = imageTypeFromPictureFormat(pic.format);
      /** 魔数优先；无法识别则不用默认 jpg，避免错类型裂图 */
      const chosen = sniffed || fromTag;
      if (chosen) {
        if (chosen.mimeType === "image/tiff") {
          const jpeg = await tiffCoverToJpeg(buf);
          if (!jpeg) continue;
          return jpeg;
        }
        return {
          buffer: buf,
          mimeType: chosen.mimeType,
          ext: chosen.ext,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** 临时文件扩展名，供 ffmpeg 识别容器 */
function videoTempExt(mimetype) {
  const m = normalizeMime(mimetype);
  if (m === "video/webm") return "webm";
  if (m === "video/quicktime") return "mov";
  if (m === "video/ogg") return "ogv";
  if (m === "video/x-matroska") return "mkv";
  return "mp4";
}

/**
 * @param {string} ffmpeg
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {number} ss
 */
function runFfmpegScreenshot(ffmpeg, inputPath, outputPath, ss) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        String(ss),
        "-i",
        inputPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=960:-2:flags=lanczos",
        "-q:v",
        "3",
        outputPath,
      ],
      { stdio: "ignore" }
    );
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg ${code}`));
    });
  });
}

/**
 * 从视频缓冲截取一帧为 JPEG（上传时或 finalize 时各调用一次）。
 * 使用 resolveFfmpegBinaryPath（MIKUJAR_FFMPEG / PATH / ffmpeg-static）；失败返回 null。
 * @param {Buffer} buffer
 * @param {string} mimetype
 * @returns {Promise<{ buffer: Buffer; mimeType: string; ext: string } | null>}
 */
export async function tryExtractVideoThumbnail(buffer, mimetype) {
  const ffmpeg = resolveFfmpegBinaryPath();
  if (typeof ffmpeg !== "string" || !ffmpeg) {
    console.warn(
      "[media] video thumbnail: no ffmpeg (set MIKUJAR_FFMPEG or install ffmpeg in PATH)"
    );
    return null;
  }
  if (!buffer || buffer.length < 64) return null;
  if (kindFromMime(mimetype) !== "video") return null;

  const ext = videoTempExt(mimetype);
  const dir = await mkdtemp(join(tmpdir(), "mj-vthumb-"));
  const inputPath = join(dir, `in.${ext}`);
  const rawOut = join(dir, "frame.jpg");
  try {
    await writeFile(inputPath, buffer);
    for (const ss of [1, 0]) {
      try {
        await runFfmpegScreenshot(ffmpeg, inputPath, rawOut, ss);
        const raw = await readFile(rawOut);
        if (!raw.length) continue;
        let jpeg = await sharp(raw)
          .rotate()
          .resize(960, 540, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 84, mozjpeg: true })
          .toBuffer();
        if (jpeg.length > MAX_EMBEDDED_COVER_BYTES) {
          jpeg = await sharp(raw)
            .rotate()
            .resize(640, 400, { fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 78, mozjpeg: true })
            .toBuffer();
        }
        if (!jpeg.length || jpeg.length > MAX_EMBEDDED_COVER_BYTES) continue;
        return { buffer: jpeg, mimeType: "image/jpeg", ext: "jpg" };
      } catch {
        /* 换下一时间点 */
      }
    }
    console.warn(
      "[media] video thumbnail: ffmpeg produced no frame (codec/container?)"
    );
    return null;
  } catch (e) {
    console.warn("[media] video thumbnail:", e?.message || e);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** PDF 首页渲染上限（防异常大文件占满内存） */
const MAX_PDF_THUMB_INPUT_BYTES = 80 * 1024 * 1024;

/**
 * 若 libvips 编译了 PDF 支持则走 sharp（快）；否则返回 null。
 * @param {Buffer} buffer
 * @returns {Promise<{ buffer: Buffer; mimeType: string; ext: string } | null>}
 */
async function tryExtractPdfThumbnailSharp(buffer) {
  if (!buffer || buffer.length < 8) return null;
  try {
    let jpeg = await sharp(buffer, {
      density: 144,
      page: 0,
      limitInputPixels: 268_402_689,
    })
      .rotate()
      .resize(960, 960, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    if (jpeg.length > MAX_EMBEDDED_COVER_BYTES) {
      jpeg = await sharp(buffer, { density: 120, page: 0 })
        .resize(640, 640, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 76, mozjpeg: true })
        .toBuffer();
    }
    if (!jpeg.length || jpeg.length > MAX_EMBEDDED_COVER_BYTES) return null;
    return { buffer: jpeg, mimeType: "image/jpeg", ext: "jpg" };
  } catch {
    return null;
  }
}

let pdfjsWorkerConfigured = false;

/**
 * pdfjs-dist + @napi-rs/canvas（预编译，无需 Python/node-gyp），与 sharp 互补。
 * @param {Buffer} buffer
 * @returns {Promise<{ buffer: Buffer; mimeType: string; ext: string } | null>}
 */
async function tryExtractPdfThumbnailPdfjs(buffer) {
  if (!buffer || buffer.length < 8) return null;
  if (buffer.length > MAX_PDF_THUMB_INPUT_BYTES) return null;
  if (String.fromCharCode(buffer[0], buffer[1], buffer[2], buffer[3]) !== "%PDF") {
    return null;
  }
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { createCanvas } = await import("@napi-rs/canvas");
    if (!pdfjsWorkerConfigured) {
      pdfjs.GlobalWorkerOptions.workerSrc = nodeRequire.resolve(
        "pdfjs-dist/legacy/build/pdf.worker.mjs"
      );
      pdfjsWorkerConfigured = true;
    }
    const data = new Uint8Array(buffer);
    const pdf = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
    const page = await pdf.getPage(1);
    const baseVp = page.getViewport({ scale: 1 });
    const maxEdge = 960;
    const fitScale = Math.min(
      maxEdge / Math.max(baseVp.width, 1),
      maxEdge / Math.max(baseVp.height, 1),
      2
    );
    const viewport = page.getViewport({ scale: fitScale });
    const w = Math.ceil(viewport.width);
    const h = Math.ceil(viewport.height);
    if (w < 1 || h < 1 || w > 8000 || h > 8000) return null;
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;
    const pngBuf = canvas.toBuffer("image/png");
    let jpeg = await sharp(pngBuf)
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    if (jpeg.length > MAX_EMBEDDED_COVER_BYTES) {
      jpeg = await sharp(pngBuf)
        .resize(640, 640, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 76, mozjpeg: true })
        .toBuffer();
    }
    if (!jpeg.length || jpeg.length > MAX_EMBEDDED_COVER_BYTES) return null;
    return { buffer: jpeg, mimeType: "image/jpeg", ext: "jpg" };
  } catch {
    return null;
  }
}

/**
 * PDF 第一页 → JPEG 列表预览（thumbnailUrl）；sharp 优先，否则 pdf.js。
 * @param {Buffer} buffer
 * @returns {Promise<{ buffer: Buffer; mimeType: string; ext: string } | null>}
 */
export async function tryExtractPdfThumbnail(buffer) {
  const fromSharp = await tryExtractPdfThumbnailSharp(buffer);
  if (fromSharp) return fromSharp;
  return tryExtractPdfThumbnailPdfjs(buffer);
}

/** 列表预览：限边长 WebP，与视频共用字段名 thumbnailUrl */
const MAX_IMAGE_PREVIEW_EDGE = 1280;
const MAX_IMAGE_PREVIEW_BYTES = 600 * 1024;

/**
 * 自原图生成 WebP 预览（列表用）；SVG/失败返回 null。
 * @param {Buffer} buffer
 * @param {string} mimetype
 * @returns {Promise<{ buffer: Buffer; mimeType: string; ext: string } | null>}
 */
export async function tryGenerateImagePreviewThumb(buffer, mimetype) {
  const m = normalizeMime(mimetype);
  if (m === "image/svg+xml") return null;
  if (!m.startsWith("image/")) return null;
  if (!buffer || buffer.length < 16) return null;
  try {
    let out = await sharp(buffer, { animated: false, limitInputPixels: 268_402_689 })
      .rotate()
      .resize(MAX_IMAGE_PREVIEW_EDGE, MAX_IMAGE_PREVIEW_EDGE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
    if (out.length > MAX_IMAGE_PREVIEW_BYTES) {
      out = await sharp(buffer, { animated: false, limitInputPixels: 268_402_689 })
        .rotate()
        .resize(960, 960, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 76, effort: 4 })
        .toBuffer();
    }
    if (out.length > MAX_IMAGE_PREVIEW_BYTES) {
      out = await sharp(buffer, { animated: false, limitInputPixels: 268_402_689 })
        .rotate()
        .resize(800, 800, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 70, effort: 4 })
        .toBuffer();
    }
    if (!out.length || out.length > MAX_IMAGE_PREVIEW_BYTES * 2) return null;
    return { buffer: out, mimeType: "image/webp", ext: "webp" };
  } catch {
    return null;
  }
}

/** 侧栏头像等小圆角展示用，较附件预览更小 */
const AVATAR_THUMB_MAX_EDGE = 320;

/**
 * 用户头像 WebP 压缩图；SVG 不支持则返回 null。
 * @param {Buffer} buffer
 * @param {string} mimetype
 * @returns {Promise<{ buffer: Buffer; mimeType: string; ext: string } | null>}
 */
export async function tryGenerateAvatarThumb(buffer, mimetype) {
  const m = normalizeMime(mimetype);
  if (m === "image/svg+xml") return null;
  if (!m.startsWith("image/")) return null;
  if (!buffer || buffer.length < 16) return null;
  try {
    const out = await sharp(buffer, { animated: false, limitInputPixels: 33_177_600 })
      .rotate()
      .resize(AVATAR_THUMB_MAX_EDGE, AVATAR_THUMB_MAX_EDGE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();
    if (!out.length) return null;
    return { buffer: out, mimeType: "image/webp", ext: "webp" };
  } catch {
    return null;
  }
}

/**
 * ISO BMFF：扩展名常为 .jpg/.jpeg，内容却是 HEIC（备忘录 / iOS 导出）
 * @param {Buffer} buffer
 */
function isLikelyHeifOrAvifContainer(buffer) {
  if (!buffer || buffer.length < 16) return false;
  if (buffer.slice(4, 8).toString("ascii") !== "ftyp") return false;
  const brand = buffer.slice(8, 12).toString("ascii");
  return /^(heic|heix|hevc|hevx|mif1|msf1|avif)/i.test(brand);
}

/**
 * 优先用系统/PATH 上的新版 ffmpeg（6.1+ 才较完整支持 HEIF 瓦片网格）；否则退回 ffmpeg-static。
 * @returns {string | null}
 */
function resolveFfmpegBinaryPath() {
  const env = process.env.MIKUJAR_FFMPEG || process.env.FFMPEG_PATH;
  if (typeof env === "string" && env && existsSync(env)) return env;
  try {
    const r = spawnSync("ffmpeg", ["-hide_banner", "-version"], {
      encoding: "utf8",
      timeout: 8000,
    });
    if (r.status === 0) return "ffmpeg";
  } catch {
    /* PATH 上无 ffmpeg */
  }
  const s = ffmpegStatic;
  return typeof s === "string" && s ? s : null;
}

/**
 * B 站 DASH：画面 / 音轨常为独立 fMP4，用 ffmpeg 无损封装为单个 MP4（-c copy）。
 * 勿用 `-shortest`：音轨往往比画面短或 duration 元数据不准，会误把成片截成十几秒。
 * @param {Buffer} videoBuffer
 * @param {Buffer} audioBuffer
 * @returns {Promise<Buffer>}
 */
export async function mergeBiliDashVideoAudioToMp4(videoBuffer, audioBuffer) {
  if (!videoBuffer?.length || !audioBuffer?.length) {
    throw new Error("缺少画面或音轨数据");
  }
  const ffmpeg = resolveFfmpegBinaryPath();
  if (typeof ffmpeg !== "string" || !ffmpeg) {
    throw new Error("未找到 ffmpeg，无法合并 DASH 音画");
  }
  const tmpRoot = await mkdtemp(join(tmpdir(), "bili-dash-merge-"));
  const vPath = join(tmpRoot, "dash-video.mp4");
  const aPath = join(tmpRoot, "dash-audio.m4a");
  const outPath = join(tmpRoot, "merged.mp4");
  try {
    await writeFile(vPath, videoBuffer);
    await writeFile(aPath, audioBuffer);
    await new Promise((resolve, reject) => {
      const child = spawn(
        ffmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          vPath,
          "-i",
          aPath,
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
          "-c",
          "copy",
          "-movflags",
          "+faststart",
          outPath,
        ],
        { stdio: ["ignore", "ignore", "pipe"] }
      );
      let err = "";
      child.stderr?.on("data", (d) => {
        err += d.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(err.trim() || `ffmpeg 退出码 ${code}`));
      });
    });
    const out = await readFile(outPath);
    if (!out?.length) throw new Error("合并输出为空");
    return out;
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 解析 Tile Grid 需 ffprobe 的 `-show_stream_groups`（约 6.1+）。仅用 PATH / 环境变量（勿依赖过旧的静态包）。
 * @returns {string | null}
 */
function resolveFfprobeBinaryPath() {
  const env = process.env.MIKUJAR_FFPROBE || process.env.FFPROBE_PATH;
  if (typeof env === "string" && env && existsSync(env)) return env;
  try {
    const r = spawnSync("ffprobe", ["-version"], {
      encoding: "utf8",
      timeout: 8000,
    });
    if (r.status === 0) return "ffprobe";
  } catch {
    /* PATH 上无 ffprobe */
  }
  return null;
}

/**
 * 音/视频时长（秒，非负整数）：优先 music-metadata，失败则 ffprobe 临时文件。
 * @param {Buffer} buffer
 * @param {string} mimetype
 * @param {string} fileExt 不含点，用于临时文件名
 * @returns {Promise<number|null>}
 */
async function probeDurationSecondsFromAvBuffer(buffer, mimetype, fileExt) {
  if (!buffer?.length) return null;
  const tryMeta = async (mime) => {
    try {
      const md = await parseBuffer(buffer, { mimeType: mime });
      const d = md?.format?.duration;
      if (typeof d === "number" && Number.isFinite(d) && d >= 0) {
        return Math.min(8640000, Math.round(d));
      }
    } catch {
      /* 下一猜 */
    }
    return null;
  };
  let fromMeta = await tryMeta(mimetype);
  if (fromMeta != null) return fromMeta;
  const ext = String(fileExt || "").toLowerCase();
  if (mimetype !== "video/mp4" && ext === "mp4") {
    fromMeta = await tryMeta("video/mp4");
    if (fromMeta != null) return fromMeta;
  }
  if (mimetype !== "video/quicktime" && ext === "mov") {
    fromMeta = await tryMeta("video/quicktime");
    if (fromMeta != null) return fromMeta;
  }
  if (mimetype !== "audio/mpeg" && (ext === "mp3" || ext === "mpeg")) {
    fromMeta = await tryMeta("audio/mpeg");
    if (fromMeta != null) return fromMeta;
  }
  if (mimetype !== "video/webm" && ext === "webm") {
    fromMeta = await tryMeta("video/webm");
    if (fromMeta != null) return fromMeta;
  }
  const ffprobe = resolveFfprobeBinaryPath();
  if (!ffprobe) return null;
  const safeExt = /^[a-z0-9]{1,8}$/i.test(String(fileExt || ""))
    ? String(fileExt).toLowerCase()
    : "bin";
  const tmpPath = join(
    tmpdir(),
    `mj-duration-${randomBytes(12).toString("hex")}.${safeExt}`
  );
  try {
    await writeFile(tmpPath, buffer);
    const r = spawnSync(
      ffprobe,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        tmpPath,
      ],
      { encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024 }
    );
    if (r.status !== 0) return null;
    const parsed = parseFloat(String(r.stdout || "").trim());
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return Math.min(8640000, Math.round(parsed));
  } catch {
    return null;
  } finally {
    await rm(tmpPath, { force: true }).catch(() => {});
  }
}

/**
 * 视频像素宽高（首条视频流）：需 ffprobe。
 * @param {Buffer} buffer
 * @param {string} mimetype
 * @param {string} fileExt
 * @returns {Promise<{ widthPx: number; heightPx: number } | null>}
 */
async function probeVideoPixelDimensionsFromAvBuffer(buffer, mimetype, fileExt) {
  if (!buffer?.length) return null;
  const ffprobe = resolveFfprobeBinaryPath();
  if (!ffprobe) return null;
  const safeExt = /^[a-z0-9]{1,8}$/i.test(String(fileExt || ""))
    ? String(fileExt).toLowerCase()
    : "bin";
  const tmpPath = join(
    tmpdir(),
    `mj-vdim-${randomBytes(12).toString("hex")}.${safeExt}`
  );
  try {
    await writeFile(tmpPath, buffer);
    const r = spawnSync(
      ffprobe,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        tmpPath,
      ],
      { encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024 }
    );
    if (r.status !== 0) return null;
    let j;
    try {
      j = JSON.parse(String(r.stdout || "{}"));
    } catch {
      return null;
    }
    const st = Array.isArray(j.streams) ? j.streams[0] : null;
    if (!st || typeof st !== "object") return null;
    const w = Number(st.width);
    const h = Number(st.height);
    if (
      !Number.isFinite(w) ||
      !Number.isFinite(h) ||
      w <= 0 ||
      h <= 0 ||
      w > 32767 ||
      h > 32767
    ) {
      return null;
    }
    return { widthPx: Math.round(w), heightPx: Math.round(h) };
  } catch {
    return null;
  } finally {
    await rm(tmpPath, { force: true }).catch(() => {});
  }
}

/**
 * @param {string} ffprobePath
 * @param {string} inputPath
 * @returns {{ layout: string; cropW: number; cropH: number; streams: number[] } | null}
 */
function probeHeifTileGridLayout(ffprobePath, inputPath) {
  const r = spawnSync(
    ffprobePath,
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_stream_groups",
      "-i",
      inputPath,
    ],
    { encoding: "utf8", maxBuffer: 12 * 1024 * 1024 }
  );
  if (r.status !== 0) return null;
  let json;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    return null;
  }
  const groups = json.stream_groups;
  if (!Array.isArray(groups)) return null;
  const tileGroup = groups.find((g) =>
    /tile\s*grid/i.test(String(g?.type ?? ""))
  );
  const comp = tileGroup?.components?.[0];
  const subs = comp?.subcomponents;
  if (!Array.isArray(subs) || subs.length < 2) return null;
  const sorted = [...subs].sort(
    (a, b) => (a.stream_index ?? 0) - (b.stream_index ?? 0)
  );
  const cw = Number(comp.width);
  const ch = Number(comp.height);
  if (!Number.isFinite(cw) || !Number.isFinite(ch) || cw < 1 || ch < 1) {
    return null;
  }
  const layout = sorted
    .map((s) => `${s.tile_horizontal_offset}_${s.tile_vertical_offset}`)
    .join("|");
  const streams = sorted.map((s) => s.stream_index);
  return { layout, cropW: cw, cropH: ch, streams };
}

/**
 * @param {string} ffmpeg
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {{ layout: string; cropW: number; cropH: number; streams: number[] }} grid
 * @returns {Promise<boolean>}
 */
function runFfmpegHeifTileGrid(ffmpeg, inputPath, outputPath, grid) {
  const n = grid.streams.length;
  const inputLabels = grid.streams.map((si) => `[0:v:${si}]`).join("");
  const filter = `${inputLabels}xstack=inputs=${n}:layout=${grid.layout}[xg];[xg]crop=${grid.cropW}:${grid.cropH}:0:0[out]`;
  return new Promise((resolve) => {
    const child = spawn(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-filter_complex",
        filter,
        "-map",
        "[out]",
        "-frames:v",
        "1",
        "-q:v",
        "3",
        outputPath,
      ],
      { stdio: "ignore" }
    );
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

/**
 * HEIF/HEIC 常含多路「视频」轨：封面/缩略图 + 全尺寸主图。不指定 map 时 ffmpeg 可能只解到第一路小图。
 * @param {string} ffmpeg
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {number} streamIndex
 * @returns {Promise<boolean>}
 */
function runFfmpegHeifSingleStream(ffmpeg, inputPath, outputPath, streamIndex) {
  return new Promise((resolve) => {
    const child = spawn(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-map",
        `0:v:${streamIndex}`,
        "-frames:v",
        "1",
        "-q:v",
        "3",
        outputPath,
      ],
      { stdio: "ignore" }
    );
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

/**
 * sharp/libvips 未带 libheif 时（常见 Linux 服务端）HEIC 会解码失败；
 * ffmpeg-static 多数构建带 heif demuxer，逐轨解一帧后取像素面积最大的一路，再统一为 JPEG。
 * @param {Buffer} buffer
 * @returns {Promise<{ buffer: Buffer; mimeType: string } | null>}
 */
export async function tryHeifLikeToJpegViaFfmpeg(buffer) {
  const ffmpeg = resolveFfmpegBinaryPath();
  const ffprobe = resolveFfprobeBinaryPath();
  if (typeof ffmpeg !== "string" || !ffmpeg || !buffer?.length) return null;
  const dir = await mkdtemp(join(tmpdir(), "mj-heif-"));
  const inputPath = join(dir, "in.heic");
  try {
    await writeFile(inputPath, buffer);
    if (ffprobe) {
      const grid = probeHeifTileGridLayout(ffprobe, inputPath);
      if (grid) {
        const tileOut = join(dir, "tile.jpg");
        const okGrid = await runFfmpegHeifTileGrid(
          ffmpeg,
          inputPath,
          tileOut,
          grid
        );
        if (okGrid) {
          try {
            const raw = await readFile(tileOut);
            if (raw.length) {
              const jpeg = await sharp(raw)
                .rotate()
                .jpeg({ quality: 88, mozjpeg: true })
                .toBuffer();
              if (jpeg.length) {
                return { buffer: jpeg, mimeType: "image/jpeg" };
              }
            }
          } catch {
            /* 继续走逐轨逻辑 */
          }
        }
      }
    }
    let bestRaw = /** @type {Buffer | null} */ (null);
    let bestArea = 0;
    let hadFfmpegSuccess = false;
    const maxStreams = 16;
    for (let vi = 0; vi < maxStreams; vi++) {
      const outputPath = join(dir, `out-${vi}.jpg`);
      const ok = await runFfmpegHeifSingleStream(
        ffmpeg,
        inputPath,
        outputPath,
        vi
      );
      if (!ok) {
        if (hadFfmpegSuccess) break;
        continue;
      }
      hadFfmpegSuccess = true;
      let raw;
      try {
        raw = await readFile(outputPath);
      } catch {
        continue;
      }
      if (!raw.length) continue;
      let meta;
      try {
        meta = await sharp(raw).rotate().metadata();
      } catch {
        continue;
      }
      const w = meta.width ?? 0;
      const h = meta.height ?? 0;
      const area = w * h;
      if (area > bestArea) {
        bestArea = area;
        bestRaw = raw;
      }
    }
    if (!bestRaw?.length) return null;
    const jpeg = await sharp(bestRaw)
      .rotate()
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
    if (!jpeg.length) return null;
    return { buffer: jpeg, mimeType: "image/jpeg" };
  } catch (e) {
    console.warn("[media] tryHeifLikeToJpegViaFfmpeg", e?.message || e);
    return null;
  } finally {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/** 从扩展名推断 MIME（文件夹选入时浏览器常给空 File.type） */
function inferMimeFromFilename(originalname) {
  const ext = safeExtFromOriginalName(
    typeof originalname === "string" ? originalname : ""
  );
  if (!ext) return null;
  const map = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    bmp: "image/bmp",
    heic: "image/heic",
    heif: "image/heif",
    tif: "image/tiff",
    tiff: "image/tiff",
    svg: "image/svg+xml",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    mkv: "video/x-matroska",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    pdf: "application/pdf",
  };
  return map[ext] || null;
}

/**
 * HEIC/HEIF/TIFF 等常见「上传成功但 <img> 裂图」：统一转 JPEG；错标/损坏栅格也可修复。
 * @returns {Promise<{ buffer: Buffer; mimeType: string } | null>} null 表示保留原文件
 */
async function normalizeImageBufferForWeb(buffer, extRaw, mimetypeRaw) {
  const ext = String(extRaw || "").toLowerCase();
  const m = normalizeMime(mimetypeRaw);
  if (m === "image/svg+xml") return null;
  if (!buffer || buffer.length < 16) return null;

  const mustByContainer = isLikelyHeifOrAvifContainer(buffer);
  const mustByExt =
    ["heic", "heif", "tif", "tiff"].includes(ext) || mustByContainer;
  const mustByMime =
    m === "image/tiff" || m.includes("heic") || m.includes("heif");

  const sniff = sniffEmbeddedImageBuffer(buffer);
  const sniffOk =
    sniff &&
    ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(
      sniff.mimeType
    );

  if (!mustByExt && !mustByMime) {
    if (sniffOk) {
      try {
        await sharp(buffer, {
          failOn: "warning",
          limitInputPixels: 268_402_689,
        }).metadata();
        return null;
      } catch {
        /* 魔数像常见图但无法解码：尝试转 JPEG */
      }
    }
  }

  const needsHeifWorkaround =
    mustByContainer ||
    mustByMime ||
    ["heic", "heif"].includes(ext);

  /** HEIF 多页 / 主图非第 0 页时（如部分 AVIF）用 pagePrimary */
  let heifPageOpt = {};
  if (needsHeifWorkaround) {
    try {
      const hm = await sharp(buffer, {
        failOn: "none",
        limitInputPixels: 268_402_689,
      }).metadata();
      if (
        (hm.pages != null && hm.pages > 1) ||
        (hm.pagePrimary != null && hm.pagePrimary > 0)
      ) {
        heifPageOpt = { page: hm.pagePrimary ?? 0 };
      }
    } catch {
      /* ignore */
    }
  }

  try {
    const out = await sharp(buffer, {
      failOn: needsHeifWorkaround ? "none" : "warning",
      limitInputPixels: 268_402_689,
      ...heifPageOpt,
    })
      .rotate()
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
    if (!out?.length) return null;
    return { buffer: out, mimeType: "image/jpeg" };
  } catch (e) {
    console.warn("[media] normalizeImageBufferForWeb sharp", e?.message || e);
    if (needsHeifWorkaround) {
      const ff = await tryHeifLikeToJpegViaFfmpeg(buffer);
      if (ff) return ff;
    }
    return null;
  }
}

/**
 * @param {{ buffer: Buffer; mimetype: string; originalname?: string }} file
 * @param {{ publicUploadsDir: string; userId?: string | null }} opts
 */
export async function saveUploadedMedia(file, opts) {
  let mimetype = normalizeMime(file.mimetype);
  if (mimetype === "application/octet-stream" || mimetype === "") {
    const inf = inferMimeFromFilename(file.originalname);
    if (inf) mimetype = normalizeMime(inf);
  }
  const token = `${Date.now()}-${randomBytes(12).toString("hex")}`;
  let ext = extForStoredFile(mimetype, file.originalname);
  let filename = `${token}.${ext}`;
  let kind = kindFromMime(mimetype);
  if (kind === "file") {
    const inf2 = inferMimeFromFilename(file.originalname);
    if (inf2) {
      mimetype = normalizeMime(inf2);
      ext = extForStoredFile(mimetype, file.originalname);
      filename = `${token}.${ext}`;
      kind = kindFromMime(mimetype);
    }
  }
  /** 对象键仍用随机名；前端用 name 展示原始文件名 */
  const name = attachmentDisplayName(file.originalname);
  const sub = mediaPathSegment(opts.userId);
  const cosSub = sub ? `${cosMediaPrefix()}/${sub}` : cosMediaPrefix();
  const localBase = sub
    ? join(opts.publicUploadsDir, sub)
    : opts.publicUploadsDir;
  const urlSub = sub ? `${sub}/` : "";

  let bodyBuf = file.buffer;
  let bodyMime = mimetype;
  let outFilename = filename;

  let coverUrl;
  if (kind === "audio") {
    const cover = await tryExtractEmbeddedAudioCover(file.buffer, mimetype);
    if (cover) {
      const coverFilename = `${token}-cover.${cover.ext}`;
      if (isCosConfigured()) {
        const coverKey = `${cosSub}/${coverFilename}`;
        await putCosObject(coverKey, cover.buffer, cover.mimeType);
        coverUrl = buildObjectPublicUrl(coverKey);
      } else {
        await mkdir(localBase, { recursive: true });
        const coverPath = join(localBase, coverFilename);
        await writeFile(coverPath, cover.buffer);
        coverUrl = `/uploads/${urlSub}${coverFilename}`;
      }
    }
  }

  let thumbnailUrl;
  if (kind === "video") {
    const thumb = await tryExtractVideoThumbnail(file.buffer, mimetype);
    if (thumb) {
      const thumbFilename = `${token}-thumb.${thumb.ext}`;
      if (isCosConfigured()) {
        const thumbKey = `${cosSub}/${thumbFilename}`;
        await putCosObject(thumbKey, thumb.buffer, thumb.mimeType);
        thumbnailUrl = buildObjectPublicUrl(thumbKey);
      } else {
        await mkdir(localBase, { recursive: true });
        await writeFile(join(localBase, thumbFilename), thumb.buffer);
        thumbnailUrl = `/uploads/${urlSub}${thumbFilename}`;
      }
    }
  }

  if (kind === "image") {
    const norm = await normalizeImageBufferForWeb(bodyBuf, ext, bodyMime);
    if (norm) {
      bodyBuf = norm.buffer;
      bodyMime = norm.mimeType;
      outFilename = `${token}.jpg`;
    }
    const prev = await tryGenerateImagePreviewThumb(bodyBuf, bodyMime);
    if (prev) {
      const thumbFilename = `${token}-thumb.${prev.ext}`;
      if (isCosConfigured()) {
        const thumbKey = `${cosSub}/${thumbFilename}`;
        await putCosObject(thumbKey, prev.buffer, prev.mimeType);
        thumbnailUrl = buildObjectPublicUrl(thumbKey);
      } else {
        await mkdir(localBase, { recursive: true });
        await writeFile(join(localBase, thumbFilename), prev.buffer);
        thumbnailUrl = `/uploads/${urlSub}${thumbFilename}`;
      }
    }
  }

  if (kind === "file" && normalizeMime(mimetype) === "application/pdf") {
    const thumb = await tryExtractPdfThumbnail(file.buffer);
    if (thumb) {
      const thumbFilename = `${token}-thumb.${thumb.ext}`;
      if (isCosConfigured()) {
        const thumbKey = `${cosSub}/${thumbFilename}`;
        await putCosObject(thumbKey, thumb.buffer, thumb.mimeType);
        thumbnailUrl = buildObjectPublicUrl(thumbKey);
      } else {
        await mkdir(localBase, { recursive: true });
        await writeFile(join(localBase, thumbFilename), thumb.buffer);
        thumbnailUrl = `/uploads/${urlSub}${thumbFilename}`;
      }
    }
  }

  if (isCosConfigured()) {
    const key = `${cosSub}/${outFilename}`;
    await putCosObject(key, bodyBuf, bodyMime);
    const url = buildObjectPublicUrl(key);
    const out = { url, kind, name };
    if (coverUrl) out.coverUrl = coverUrl;
    if (thumbnailUrl) out.thumbnailUrl = thumbnailUrl;
    return out;
  }

  await mkdir(localBase, { recursive: true });
  const diskPath = join(localBase, outFilename);
  await writeFile(diskPath, bodyBuf);
  const url = `/uploads/${urlSub}${outFilename}`;
  const out = { url, kind, name };
  if (coverUrl) out.coverUrl = coverUrl;
  if (thumbnailUrl) out.thumbnailUrl = thumbnailUrl;
  return out;
}

const EXT_TO_MIME = Object.fromEntries(
  Object.entries(MIME_TO_EXT).map(([mime, ext]) => [ext, mime])
);

/**
 * 规划 COS 直传：与 saveUploadedMedia 使用相同对象键规则（仅校验，实际上传由浏览器完成）
 * @param {{ originalname?: string; contentType: string; fileSize: number; userId?: string | null; maxFileBytes?: number }} p
 */
export function planMediaCosDirectUpload(p) {
  const fileSize = Number(p.fileSize);
  if (!Number.isFinite(fileSize) || fileSize < 1) {
    throw new Error("无效的文件大小");
  }
  const effectiveMax =
    p.maxFileBytes != null &&
    Number.isFinite(p.maxFileBytes) &&
    p.maxFileBytes > 0
      ? Math.min(UPLOAD_MAX_BYTES, p.maxFileBytes)
      : UPLOAD_MAX_BYTES;
  const maxMbLabel = Math.max(1, Math.round(effectiveMax / (1024 * 1024)));
  if (fileSize > effectiveMax) {
    throw new Error(`文件过大（上限 ${maxMbLabel}MB）`);
  }
  const orig =
    typeof p.originalname === "string" ? p.originalname.trim() : "";
  let mimetype = normalizeMime(p.contentType);
  if (mimetype === "application/octet-stream" || mimetype === "") {
    const inf = inferMimeFromFilename(orig);
    if (inf) mimetype = normalizeMime(inf);
  }
  const token = `${Date.now()}-${randomBytes(12).toString("hex")}`;
  let ext = extForStoredFile(mimetype, p.originalname);
  let filename = `${token}.${ext}`;
  let kind = kindFromMime(mimetype);
  if (kind === "file") {
    const inf2 = inferMimeFromFilename(orig);
    if (inf2) {
      mimetype = normalizeMime(inf2);
      ext = extForStoredFile(mimetype, p.originalname);
      filename = `${token}.${ext}`;
      kind = kindFromMime(mimetype);
    }
  }
  const name = attachmentDisplayName(p.originalname);
  const sub = mediaPathSegment(p.userId);
  const cosSub = sub ? `${cosMediaPrefix()}/${sub}` : cosMediaPrefix();
  const key = `${cosSub}/${filename}`;
  return { key, kind, name, contentType: mimetype };
}

/**
 * 音频已直传 COS 后，由服务端拉取并提取内嵌封面再写入 COS（与同进程 putObject 一致）
 */
export async function finalizeAudioCoverAfterCosUpload(objectKey, userId) {
  if (!isCosConfigured()) {
    throw new Error("未配置 COS");
  }
  const sub = mediaPathSegment(userId);
  const cosSub = sub ? `${cosMediaPrefix()}/${sub}` : cosMediaPrefix();
  const prefix = `${cosSub}/`;
  const k = String(objectKey || "").replace(/^\//, "");
  if (!k.startsWith(prefix)) {
    throw new Error("无效的对象路径");
  }
  const base = basename(k);
  const dot = base.lastIndexOf(".");
  if (dot < 1) throw new Error("无效的对象路径");
  const tokenPart = base.slice(0, dot);
  const ext = base.slice(dot + 1).toLowerCase();
  if (!isAllowedCosMediaFilenameStem(tokenPart)) {
    throw new Error("无效的对象路径");
  }
  const mimetype =
    EXT_TO_MIME[ext] || `application/${ext === "bin" ? "octet-stream" : ext}`;
  if (kindFromMime(mimetype) !== "audio") {
    throw new Error("仅支持音频对象");
  }
  const buffer = await getCosObjectBuffer(k);
  const [cover, durationSec] = await Promise.all([
    tryExtractEmbeddedAudioCover(buffer, mimetype),
    probeDurationSecondsFromAvBuffer(buffer, mimetype, ext),
  ]);
  const out = {};
  if (cover) {
    const coverFilename = `${tokenPart}-cover.${cover.ext}`;
    const coverKey = `${cosSub}/${coverFilename}`;
    await putCosObject(coverKey, cover.buffer, cover.mimeType);
    out.coverUrl = buildObjectPublicUrl(coverKey);
  }
  if (durationSec != null) out.durationSec = durationSec;
  return out;
}

/**
 * 视频已直传 COS 后，由服务端拉取、截帧并写入 COS（与 finalize-audio 对称）
 */
export async function finalizeVideoThumbnailAfterCosUpload(objectKey, userId) {
  if (!isCosConfigured()) {
    throw new Error("未配置 COS");
  }
  const sub = mediaPathSegment(userId);
  const cosSub = sub ? `${cosMediaPrefix()}/${sub}` : cosMediaPrefix();
  const prefix = `${cosSub}/`;
  const k = String(objectKey || "").replace(/^\//, "");
  if (!k.startsWith(prefix)) {
    throw new Error("无效的对象路径");
  }
  const base = basename(k);
  const dot = base.lastIndexOf(".");
  if (dot < 1) throw new Error("无效的对象路径");
  const tokenPart = base.slice(0, dot);
  const ext = base.slice(dot + 1).toLowerCase();
  if (!isAllowedCosMediaFilenameStem(tokenPart)) {
    throw new Error("无效的对象路径");
  }
  const mimetype =
    EXT_TO_MIME[ext] || `application/${ext === "bin" ? "octet-stream" : ext}`;
  if (kindFromMime(mimetype) !== "video") {
    throw new Error("仅支持视频对象");
  }
  const buffer = await getCosObjectBuffer(k);
  const [thumb, durationSec, dims] = await Promise.all([
    tryExtractVideoThumbnail(buffer, mimetype),
    probeDurationSecondsFromAvBuffer(buffer, mimetype, ext),
    probeVideoPixelDimensionsFromAvBuffer(buffer, mimetype, ext),
  ]);
  const out = {};
  const thumbDir = dirname(k).replace(/\\/g, "/");
  if (thumb) {
    const thumbFilename = `${tokenPart}-thumb.${thumb.ext}`;
    const thumbKey = `${thumbDir}/${thumbFilename}`;
    await putCosObject(thumbKey, thumb.buffer, thumb.mimeType);
    out.thumbnailUrl = buildObjectPublicUrl(thumbKey);
  } else {
    console.warn(
      "[media] finalize-video: no thumbnail",
      k,
      `buffer=${buffer?.length ?? 0}b`
    );
  }
  if (durationSec != null) out.durationSec = durationSec;
  else {
    console.warn(
      "[media] finalize-video: no duration (需 ffprobe 在 PATH 或 MIKUJAR_FFPROBE；music-metadata 未解析)",
      basename(k)
    );
  }
  if (dims) {
    out.widthPx = dims.widthPx;
    out.heightPx = dims.heightPx;
  }
  return out;
}

/**
 * PDF 已直传 COS 后：首页渲染为 JPEG 写入 COS（列表用 thumbnailUrl）
 */
export async function finalizePdfThumbnailAfterCosUpload(objectKey, userId) {
  if (!isCosConfigured()) {
    throw new Error("未配置 COS");
  }
  const sub = mediaPathSegment(userId);
  const cosSub = sub ? `${cosMediaPrefix()}/${sub}` : cosMediaPrefix();
  const prefix = `${cosSub}/`;
  const k = String(objectKey || "").replace(/^\//, "");
  if (!k.startsWith(prefix)) {
    throw new Error("无效的对象路径");
  }
  const base = basename(k);
  const dot = base.lastIndexOf(".");
  if (dot < 1) throw new Error("无效的对象路径");
  const tokenPart = base.slice(0, dot);
  const ext = base.slice(dot + 1).toLowerCase();
  if (!isAllowedCosMediaFilenameStem(tokenPart)) {
    throw new Error("无效的对象路径");
  }
  if (ext !== "pdf") {
    throw new Error("仅支持 PDF 对象");
  }
  const mimetype = EXT_TO_MIME[ext] || "application/pdf";
  if (normalizeMime(mimetype) !== "application/pdf") {
    throw new Error("仅支持 PDF 对象");
  }
  const buffer = await getCosObjectBuffer(k);
  const thumb = await tryExtractPdfThumbnail(buffer);
  if (!thumb) return {};
  const thumbFilename = `${tokenPart}-thumb.${thumb.ext}`;
  const thumbKey = `${cosSub}/${thumbFilename}`;
  await putCosObject(thumbKey, thumb.buffer, thumb.mimeType);
  return { thumbnailUrl: buildObjectPublicUrl(thumbKey) };
}

/**
 * 图片已直传 COS 后生成 WebP 预览（列表用 thumbnailUrl）
 */
export async function finalizeImagePreviewAfterCosUpload(objectKey, userId) {
  if (!isCosConfigured()) {
    throw new Error("未配置 COS");
  }
  const sub = mediaPathSegment(userId);
  const cosSub = sub ? `${cosMediaPrefix()}/${sub}` : cosMediaPrefix();
  const prefix = `${cosSub}/`;
  const k = String(objectKey || "").replace(/^\//, "");
  if (!k.startsWith(prefix)) {
    throw new Error("无效的对象路径");
  }
  const base = basename(k);
  const dot = base.lastIndexOf(".");
  if (dot < 1) throw new Error("无效的对象路径");
  const tokenPart = base.slice(0, dot);
  const ext = base.slice(dot + 1).toLowerCase();
  if (!isAllowedCosMediaFilenameStem(tokenPart)) {
    throw new Error("无效的对象路径");
  }
  const mimetype =
    EXT_TO_MIME[ext] || `application/${ext === "bin" ? "octet-stream" : ext}`;
  if (kindFromMime(mimetype) !== "image") {
    throw new Error("仅支持图片对象");
  }
  if (normalizeMime(mimetype) === "image/svg+xml") {
    return {};
  }
  let buffer = await getCosObjectBuffer(k);
  let mt = mimetype;
  const norm = await normalizeImageBufferForWeb(buffer, ext, mt);
  if (norm) {
    buffer = norm.buffer;
    mt = norm.mimeType;
    await putCosObject(k, buffer, mt);
  }
  /** @type {{ widthPx: number; heightPx: number } | null} */
  let dimPack = null;
  try {
    const meta = await sharp(buffer, {
      animated: false,
      limitInputPixels: 268_402_689,
    }).metadata();
    const w = meta.width;
    const h = meta.height;
    if (
      typeof w === "number" &&
      typeof h === "number" &&
      Number.isFinite(w) &&
      Number.isFinite(h) &&
      w > 0 &&
      h > 0 &&
      w <= 32767 &&
      h <= 32767
    ) {
      dimPack = { widthPx: w, heightPx: h };
    }
  } catch {
    /* 无法解析尺寸则仅省略 */
  }
  const prev = await tryGenerateImagePreviewThumb(buffer, mt);
  const out = {};
  if (dimPack) {
    out.widthPx = dimPack.widthPx;
    out.heightPx = dimPack.heightPx;
  }
  if (!prev) return Object.keys(out).length ? out : {};
  const thumbFilename = `${tokenPart}-thumb.${prev.ext}`;
  const thumbKey = `${cosSub}/${thumbFilename}`;
  await putCosObject(thumbKey, prev.buffer, prev.mimeType);
  out.thumbnailUrl = buildObjectPublicUrl(thumbKey);
  return out;
}

/**
 * 为已存在于 COS 的视频对象补缩略图（历史数据批处理）。
 * 不依赖 userId：按对象键目录写入 `{token}-thumb.{ext}`，与上传时 finalize 一致。
 * @param {string} objectKey 如 media/u-xx/1739-….mp4
 * @returns {Promise<{ thumbnailUrl?: string; skipped?: string }>}
 */
export async function generateVideoThumbnailForExistingCosKey(objectKey) {
  if (!isCosConfigured()) {
    return { skipped: "no_cos" };
  }
  const k = String(objectKey || "").replace(/^\/+/, "");
  if (!k) return { skipped: "empty_key" };
  const prefix = cosMediaPrefix();
  if (!k.startsWith(prefix + "/")) {
    return { skipped: "not_media_prefix" };
  }
  const file = basename(k);
  const dot = file.lastIndexOf(".");
  if (dot < 1) return { skipped: "bad_name" };
  const tokenPart = file.slice(0, dot);
  const ext = file.slice(dot + 1).toLowerCase();
  if (!isAllowedCosMediaFilenameStem(tokenPart)) {
    return { skipped: "bad_token" };
  }
  const mimetype =
    EXT_TO_MIME[ext] || `application/${ext === "bin" ? "octet-stream" : ext}`;
  if (kindFromMime(mimetype) !== "video") {
    return { skipped: "not_video" };
  }
  const cosSub = dirname(k).replace(/\\/g, "/");
  let buffer;
  try {
    buffer = await getCosObjectBuffer(k);
  } catch {
    return { skipped: "get_object" };
  }
  const [thumb, durationSec] = await Promise.all([
    tryExtractVideoThumbnail(buffer, mimetype),
    probeDurationSecondsFromAvBuffer(buffer, mimetype, ext),
  ]);
  const out = {};
  if (thumb) {
    const thumbKey = `${cosSub}/${tokenPart}-thumb.${thumb.ext}`;
    await putCosObject(thumbKey, thumb.buffer, thumb.mimeType);
    out.thumbnailUrl = buildObjectPublicUrl(thumbKey);
  }
  if (durationSec != null && Number.isFinite(durationSec) && durationSec >= 0) {
    out.durationSec = Math.round(durationSec);
  }
  if (!out.thumbnailUrl && out.durationSec == null) {
    return { skipped: "ffmpeg" };
  }
  return out;
}

/**
 * 已存在于 COS 的音/视频：仅探测时长（批处理；与 generateVideoThumbnail 共用 ffprobe / music-metadata）
 * @param {string} objectKey
 * @returns {Promise<{ durationSec?: number; skipped?: string }>}
 */
export async function probeVideoOrAudioDurationFromCosKey(objectKey) {
  if (!isCosConfigured()) {
    return { skipped: "no_cos" };
  }
  const k = String(objectKey || "").replace(/^\/+/, "");
  if (!k) return { skipped: "empty_key" };
  const prefix = cosMediaPrefix();
  if (!k.startsWith(prefix + "/")) {
    return { skipped: "not_media_prefix" };
  }
  const file = basename(k);
  const dot = file.lastIndexOf(".");
  if (dot < 1) return { skipped: "bad_name" };
  const tokenPart = file.slice(0, dot);
  const ext = file.slice(dot + 1).toLowerCase();
  if (!isAllowedCosMediaFilenameStem(tokenPart)) {
    return { skipped: "bad_token" };
  }
  const mimetype =
    EXT_TO_MIME[ext] || `application/${ext === "bin" ? "octet-stream" : ext}`;
  const kind = kindFromMime(mimetype);
  if (kind !== "video" && kind !== "audio") {
    return { skipped: "not_av" };
  }
  let buffer;
  try {
    buffer = await getCosObjectBuffer(k);
  } catch {
    return { skipped: "get_object" };
  }
  const durationSec = await probeDurationSecondsFromAvBuffer(
    buffer,
    mimetype,
    ext
  );
  if (durationSec == null || !Number.isFinite(durationSec) || durationSec < 0) {
    return { skipped: "no_duration" };
  }
  return { durationSec: Math.round(durationSec) };
}

/**
 * 为已存在于 COS 的图片对象补 WebP 预览（历史批处理）
 * @param {string} objectKey
 * @returns {Promise<{ thumbnailUrl?: string; skipped?: string }>}
 */
export async function generateImagePreviewForExistingCosKey(objectKey) {
  if (!isCosConfigured()) {
    return { skipped: "no_cos" };
  }
  const k = String(objectKey || "").replace(/^\/+/, "");
  if (!k) return { skipped: "empty_key" };
  const prefix = cosMediaPrefix();
  if (!k.startsWith(prefix + "/")) {
    return { skipped: "not_media_prefix" };
  }
  const file = basename(k);
  const dot = file.lastIndexOf(".");
  if (dot < 1) return { skipped: "bad_name" };
  const tokenPart = file.slice(0, dot);
  const ext = file.slice(dot + 1).toLowerCase();
  if (!isAllowedCosMediaFilenameStem(tokenPart)) {
    return { skipped: "bad_token" };
  }
  const mimetype =
    EXT_TO_MIME[ext] || `application/${ext === "bin" ? "octet-stream" : ext}`;
  if (kindFromMime(mimetype) !== "image") {
    return { skipped: "not_image" };
  }
  if (normalizeMime(mimetype) === "image/svg+xml") {
    return { skipped: "svg" };
  }
  const cosSub = dirname(k).replace(/\\/g, "/");
  let buffer;
  try {
    buffer = await getCosObjectBuffer(k);
  } catch {
    return { skipped: "get_object" };
  }
  const prev = await tryGenerateImagePreviewThumb(buffer, mimetype);
  if (!prev) return { skipped: "sharp" };
  const thumbKey = `${cosSub}/${tokenPart}-thumb.${prev.ext}`;
  await putCosObject(thumbKey, prev.buffer, prev.mimeType);
  return { thumbnailUrl: buildObjectPublicUrl(thumbKey) };
}
