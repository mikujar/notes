import { randomBytes } from "crypto";
import { spawn } from "child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { basename, join } from "path";
import ffmpegStatic from "ffmpeg-static";

/** @param {string | undefined | null} userId */
function mediaPathSegment(userId) {
  if (userId == null || userId === "") return null;
  const s = String(userId).replace(/[^a-zA-Z0-9._-]/g, "_");
  return s.length > 0 ? s : null;
}
import { parseBuffer } from "music-metadata";
import sharp from "sharp";
import {
  buildObjectPublicUrl,
  cosMediaPrefix,
  getCosObjectBuffer,
  isCosConfigured,
  putCosObject,
} from "./storage.js";

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
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
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
 * 依赖 ffmpeg-static；失败返回 null（前端仍可用整段视频作预览）。
 * @param {Buffer} buffer
 * @param {string} mimetype
 * @returns {Promise<{ buffer: Buffer; mimeType: string; ext: string } | null>}
 */
export async function tryExtractVideoThumbnail(buffer, mimetype) {
  const ffmpeg = ffmpegStatic;
  if (typeof ffmpeg !== "string" || !ffmpeg) return null;
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
    return null;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * @param {{ buffer: Buffer; mimetype: string; originalname?: string }} file
 * @param {{ publicUploadsDir: string; userId?: string | null }} opts
 */
export async function saveUploadedMedia(file, opts) {
  const mimetype = normalizeMime(file.mimetype);
  const ext = extForStoredFile(mimetype, file.originalname);
  const token = `${Date.now()}-${randomBytes(12).toString("hex")}`;
  const filename = `${token}.${ext}`;
  const kind = kindFromMime(mimetype);
  /** 对象键仍用随机名；前端用 name 展示原始文件名 */
  const name = attachmentDisplayName(file.originalname);
  const sub = mediaPathSegment(opts.userId);
  const cosSub = sub ? `${cosMediaPrefix()}/${sub}` : cosMediaPrefix();
  const localBase = sub
    ? join(opts.publicUploadsDir, sub)
    : opts.publicUploadsDir;
  const urlSub = sub ? `${sub}/` : "";

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

  if (isCosConfigured()) {
    const key = `${cosSub}/${filename}`;
    await putCosObject(key, file.buffer, mimetype);
    const url = buildObjectPublicUrl(key);
    const out = { url, kind, name };
    if (coverUrl) out.coverUrl = coverUrl;
    if (thumbnailUrl) out.thumbnailUrl = thumbnailUrl;
    return out;
  }

  await mkdir(localBase, { recursive: true });
  const diskPath = join(localBase, filename);
  await writeFile(diskPath, file.buffer);
  const url = `/uploads/${urlSub}${filename}`;
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
  const mimetype = normalizeMime(p.contentType);
  const ext = extForStoredFile(mimetype, p.originalname);
  const token = `${Date.now()}-${randomBytes(12).toString("hex")}`;
  const filename = `${token}.${ext}`;
  const kind = kindFromMime(mimetype);
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
  if (!/^\d+-[a-f0-9]{24}$/.test(tokenPart)) {
    throw new Error("无效的对象路径");
  }
  const mimetype =
    EXT_TO_MIME[ext] || `application/${ext === "bin" ? "octet-stream" : ext}`;
  if (kindFromMime(mimetype) !== "audio") {
    throw new Error("仅支持音频对象");
  }
  const buffer = await getCosObjectBuffer(k);
  const cover = await tryExtractEmbeddedAudioCover(buffer, mimetype);
  if (!cover) return {};
  const coverFilename = `${tokenPart}-cover.${cover.ext}`;
  const coverKey = `${cosSub}/${coverFilename}`;
  await putCosObject(coverKey, cover.buffer, cover.mimeType);
  return { coverUrl: buildObjectPublicUrl(coverKey) };
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
  if (!/^\d+-[a-f0-9]{24}$/.test(tokenPart)) {
    throw new Error("无效的对象路径");
  }
  const mimetype =
    EXT_TO_MIME[ext] || `application/${ext === "bin" ? "octet-stream" : ext}`;
  if (kindFromMime(mimetype) !== "video") {
    throw new Error("仅支持视频对象");
  }
  const buffer = await getCosObjectBuffer(k);
  const thumb = await tryExtractVideoThumbnail(buffer, mimetype);
  if (!thumb) return {};
  const thumbFilename = `${tokenPart}-thumb.${thumb.ext}`;
  const thumbKey = `${cosSub}/${thumbFilename}`;
  await putCosObject(thumbKey, thumb.buffer, thumb.mimeType);
  return { thumbnailUrl: buildObjectPublicUrl(thumbKey) };
}
