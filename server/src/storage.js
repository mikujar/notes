import COS from "cos-nodejs-sdk-v5";
import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname, join } from "path";

/** 四项齐全时使用 COS，否则回退本地 DATA_FILE */
export function storageMode() {
  if (
    process.env.COS_SECRET_ID?.trim() &&
    process.env.COS_SECRET_KEY?.trim() &&
    process.env.COS_BUCKET?.trim() &&
    process.env.COS_REGION?.trim()
  ) {
    return "cos";
  }
  return "local";
}

let cosClient = null;

/**
 * 全球加速（默认关闭）：仅当 COS_USE_ACCELERATE=1/true 且控制台已开启全球加速时生效，见
 * https://cloud.tencent.com/document/product/436/55590
 * 迁移到地域域名（如 ap-singapore）后一般应关闭控制台「全球加速」并保持此处为关。
 */
function cosUseAccelerate() {
  const v = process.env.COS_USE_ACCELERATE?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function getCos() {
  if (cosClient) return cosClient;
  cosClient = new COS({
    SecretId: process.env.COS_SECRET_ID.trim(),
    SecretKey: process.env.COS_SECRET_KEY.trim(),
    UseAccelerate: cosUseAccelerate(),
  });
  return cosClient;
}

function cosBucket() {
  return process.env.COS_BUCKET.trim();
}

function cosRegion() {
  return process.env.COS_REGION.trim();
}

/** 附件对象键前缀，默认 media（如 media/u-xxx/文件名） */
export function cosMediaPrefix() {
  return (process.env.COS_MEDIA_PREFIX?.trim() || "media").replace(/\/$/, "");
}

/** 头像对象键前缀，默认 avatars（如 avatars/{userId}.jpg） */
export function cosAvatarPrefix() {
  return (process.env.COS_AVATAR_PREFIX?.trim() || "avatars").replace(
    /\/$/,
    ""
  );
}

function cosObjectKey() {
  return process.env.COS_KEY?.trim() || "mikujar/collections.json";
}

/** 多用户模式下每条笔记 JSON 的对象键前缀（实际文件为 {prefix}/{userId}.json） */
export function collectionsCosPrefix() {
  return (
    process.env.COS_COLLECTIONS_PREFIX?.trim() || "mikujar/collections"
  ).replace(/\/$/, "");
}

function sanitizeUserId(userId) {
  const s = String(userId ?? "").trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(s)) {
    throw new Error("无效的用户 id");
  }
  return s;
}

export function collectionsObjectKeyForUser(userId) {
  const uid = sanitizeUserId(userId);
  return `${collectionsCosPrefix()}/${uid}.json`;
}

function isCosNotFound(err) {
  if (!err) return false;
  if (err.statusCode === 404) return true;
  const c = err.code ?? err.Code;
  return c === "NoSuchKey" || c === "ResourceNotFound";
}

function bodyToUtf8(body) {
  if (Buffer.isBuffer(body)) return body.toString("utf8");
  if (typeof body === "string") return body;
  throw new Error("COS 返回的 Body 类型无法解析为文本");
}

/**
 * 读取原始 JSON 文本；对象不存在时返回 null（等价于本地 ENOENT → 空数组）
 */
export async function readCollectionsRaw(localDataFile) {
  if (storageMode() === "cos") {
    const cos = getCos();
    const params = {
      Bucket: cosBucket(),
      Region: cosRegion(),
      Key: cosObjectKey(),
    };
    return new Promise((resolve, reject) => {
      cos.getObject(params, (err, data) => {
        if (err) {
          if (isCosNotFound(err)) {
            resolve(null);
            return;
          }
          reject(err);
          return;
        }
        try {
          resolve(bodyToUtf8(data.Body));
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  try {
    return await readFile(localDataFile, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return null;
    throw e;
  }
}

/**
 * 写入完整 JSON 文本（覆盖）
 */
export async function writeCollectionsRaw(localDataFile, jsonUtf8) {
  if (storageMode() === "cos") {
    const cos = getCos();
    const params = {
      Bucket: cosBucket(),
      Region: cosRegion(),
      Key: cosObjectKey(),
      Body: Buffer.from(jsonUtf8, "utf8"),
      ContentType: "application/json; charset=utf-8",
    };
    return new Promise((resolve, reject) => {
      cos.putObject(params, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
  }

  await mkdir(dirname(localDataFile), { recursive: true });
  await writeFile(localDataFile, jsonUtf8, "utf8");
}

/**
 * 按用户读取笔记 JSON（COS：`COS_COLLECTIONS_PREFIX`/`{userId}.json`；本地：`{dir}/{userId}.json`）
 */
export async function readCollectionsForUser(userId, localCollectionsDir) {
  const uid = sanitizeUserId(userId);
  if (storageMode() === "cos") {
    const key = collectionsObjectKeyForUser(uid);
    const cos = getCos();
    const params = {
      Bucket: cosBucket(),
      Region: cosRegion(),
      Key: key,
    };
    return new Promise((resolve, reject) => {
      cos.getObject(params, (err, data) => {
        if (err) {
          if (isCosNotFound(err)) {
            resolve(null);
            return;
          }
          reject(err);
          return;
        }
        try {
          resolve(bodyToUtf8(data.Body));
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  const path = join(localCollectionsDir, `${uid}.json`);
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return null;
    throw e;
  }
}

/**
 * 按用户写入笔记 JSON
 */
export async function writeCollectionsForUser(
  userId,
  localCollectionsDir,
  jsonUtf8
) {
  const uid = sanitizeUserId(userId);
  if (storageMode() === "cos") {
    const key = collectionsObjectKeyForUser(uid);
    const cos = getCos();
    const params = {
      Bucket: cosBucket(),
      Region: cosRegion(),
      Key: key,
      Body: Buffer.from(jsonUtf8, "utf8"),
      ContentType: "application/json; charset=utf-8",
    };
    return new Promise((resolve, reject) => {
      cos.putObject(params, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
  }

  const path = join(localCollectionsDir, `${uid}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, jsonUtf8, "utf8");
}

export function storageLogHint() {
  if (storageMode() === "cos") {
    const acc = cosUseAccelerate() ? " + accelerate" : "";
    return `cos: ${cosBucket()} / ${cosObjectKey()} legacy + ${collectionsCosPrefix()}/*.json per user (${cosRegion()}${acc})`;
  }
  return null;
}

/** 与 collections 无关：只要配了 COS 密钥与桶，即可用于附件上传 */
export function isCosConfigured() {
  return storageMode() === "cos";
}

/**
 * 逻辑上的对象访问 URL（存库、回传前端）；私有桶下浏览器须再经 GET 预签名方可加载。
 */
export function buildObjectPublicUrl(objectKey) {
  const key = String(objectKey).replace(/^\//, "");
  const encoded = key
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  const custom = process.env.COS_PUBLIC_BASE?.trim();
  if (custom) {
    return `${custom.replace(/\/$/, "")}/${encoded}`;
  }
  if (cosUseAccelerate()) {
    return `https://${cosBucket()}.cos.accelerate.myqcloud.com/${encoded}`;
  }
  return `https://${cosBucket()}.cos.${cosRegion()}.myqcloud.com/${encoded}`;
}

/** 上传媒体对象（默认私有；展示时走 GET 预签名） */
export async function putCosObject(objectKey, buffer, contentType) {
  const cos = getCos();
  const key = String(objectKey).replace(/^\//, "");
  const params = {
    Bucket: cosBucket(),
    Region: cosRegion(),
    Key: key,
    Body: buffer,
    ContentType: contentType || "application/octet-stream",
    /** 避免 COS/默认元数据为 attachment，导致 <img>/<video> 裂图而地址栏直链仍可打开 */
    ContentDisposition: "inline",
  };
  return new Promise((resolve, reject) => {
    cos.putObject(params, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

/**
 * 浏览器直传 COS 的预签名 PUT（须与前端请求头 Content-Type、Content-Disposition 一致）
 * @param {{ key: string; contentType: string; expiresSec?: number }} opts
 */
export function getCosPutPresignedUrl(opts) {
  const cos = getCos();
  const key = String(opts.key).replace(/^\//, "");
  const contentType = String(opts.contentType || "application/octet-stream")
    .split(";")[0]
    .trim();
  const expiresSec = Math.min(
    3600,
    Math.max(60, Number(opts.expiresSec) || 900)
  );
  return new Promise((resolve, reject) => {
    cos.getObjectUrl(
      {
        Bucket: cosBucket(),
        Region: cosRegion(),
        Key: key,
        Method: "PUT",
        Sign: true,
        Expires: expiresSec,
        Headers: {
          "Content-Type": contentType,
          "Content-Disposition": "inline",
        },
      },
      (err, data) => {
        if (err) reject(err);
        else resolve(data.Url);
      }
    );
  });
}

/**
 * 浏览器加载私有对象的 GET 预签名 URL
 * @param {string} objectKey
 * @param {number} [expiresSec]
 */
export function getCosGetPresignedUrl(objectKey, expiresSec = 900) {
  const cos = getCos();
  const key = String(objectKey).replace(/^\//, "");
  const expires = Math.min(3600, Math.max(60, Number(expiresSec) || 900));
  return new Promise((resolve, reject) => {
    cos.getObjectUrl(
      {
        Bucket: cosBucket(),
        Region: cosRegion(),
        Key: key,
        Method: "GET",
        Sign: true,
        Expires: expires,
      },
      (err, data) => {
        if (err) reject(err);
        else resolve(data.Url);
      }
    );
  });
}

/**
 * 从对外 URL（直链或 COS_PUBLIC_BASE 自定义域）解析对象键；非本桶则返回 null
 * @param {string} inputUrl
 * @returns {string | null}
 */
export function extractObjectKeyFromCosPublicUrl(inputUrl) {
  let u;
  try {
    u = new URL(inputUrl);
  } catch {
    return null;
  }

  const pathRaw = u.pathname.replace(/^\/+/, "");
  const segments = pathRaw
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  const pathname = segments.join("/");

  const custom = process.env.COS_PUBLIC_BASE?.trim();
  if (custom) {
    let baseUrl;
    try {
      baseUrl = new URL(custom.includes("://") ? custom : `https://${custom}`);
    } catch {
      return null;
    }
    if (u.origin !== baseUrl.origin) return null;
    const basePath = baseUrl.pathname.replace(/\/$/, "");
    let p = u.pathname;
    if (basePath && basePath !== "/") {
      if (p !== basePath && !p.startsWith(`${basePath}/`)) return null;
      p = p.slice(basePath.length).replace(/^\//, "");
    } else {
      p = p.replace(/^\//, "");
    }
    const keyFromCustom = p
      .split("/")
      .filter(Boolean)
      .map((s) => {
        try {
          return decodeURIComponent(s);
        } catch {
          return s;
        }
      })
      .join("/");
    return keyFromCustom || null;
  }

  const bucket = process.env.COS_BUCKET?.trim();
  const region = process.env.COS_REGION?.trim();
  if (!bucket || !region) return null;

  const host = u.hostname.toLowerCase();
  const okHost =
    host === `${bucket}.cos.${region}.myqcloud.com`.toLowerCase() ||
    host === `${bucket}.cos.accelerate.myqcloud.com`.toLowerCase();
  if (!okHost) return null;
  return pathname || null;
}

/** 分片上传：初始化任务（与 putObject 元数据一致） */
export async function cosMultipartInit({ key, contentType }) {
  const cos = getCos();
  const k = String(key).replace(/^\//, "");
  const ct = String(contentType || "application/octet-stream")
    .split(";")[0]
    .trim();
  return new Promise((resolve, reject) => {
    cos.multipartInit(
      {
        Bucket: cosBucket(),
        Region: cosRegion(),
        Key: k,
        Headers: {
          "Content-Type": ct,
          "Content-Disposition": "inline",
        },
      },
      (err, data) => {
        if (err) {
          reject(err);
          return;
        }
        const id = data?.UploadId;
        if (!id) {
          reject(new Error("multipartInit 未返回 UploadId"));
          return;
        }
        resolve(String(id));
      }
    );
  });
}

/**
 * 浏览器直传分片：预签名 PUT（query 含 partNumber、uploadId）
 * 签名算法与 UploadPart 一致（见 cos.getObjectUrl + Query）
 */
export function getCosUploadPartPresignedUrl(opts) {
  const cos = getCos();
  const key = String(opts.key).replace(/^\//, "");
  const uploadId = String(opts.uploadId);
  const partNumber = Number(opts.partNumber);
  if (!uploadId || !Number.isFinite(partNumber) || partNumber < 1) {
    return Promise.reject(new Error("无效的 uploadId 或 partNumber"));
  }
  const expiresSec = Math.min(
    3600,
    Math.max(60, Number(opts.expiresSec) || 900)
  );
  return new Promise((resolve, reject) => {
    cos.getObjectUrl(
      {
        Bucket: cosBucket(),
        Region: cosRegion(),
        Key: key,
        Method: "PUT",
        Sign: true,
        Expires: expiresSec,
        Query: {
          partNumber,
          uploadId,
        },
        Headers: {},
      },
      (err, data) => {
        if (err) reject(err);
        else resolve(data.Url);
      }
    );
  });
}

/** 完成分片上传 */
export async function cosMultipartComplete({ key, uploadId, parts }) {
  const cos = getCos();
  const k = String(key).replace(/^\//, "");
  const uid = String(uploadId);
  const list = [...parts].sort(
    (a, b) => Number(a.PartNumber) - Number(b.PartNumber)
  );
  return new Promise((resolve, reject) => {
    cos.multipartComplete(
      {
        Bucket: cosBucket(),
        Region: cosRegion(),
        Key: k,
        UploadId: uid,
        Parts: list.map((p) => ({
          PartNumber: Number(p.PartNumber),
          ETag: String(p.ETag || ""),
        })),
      },
      (err, data) => {
        if (err) reject(err);
        else resolve(data);
      }
    );
  });
}

/** 中止分片任务（客户端失败时清理） */
export async function cosMultipartAbort({ key, uploadId }) {
  const cos = getCos();
  const k = String(key).replace(/^\//, "");
  return new Promise((resolve, reject) => {
    cos.multipartAbort(
      {
        Bucket: cosBucket(),
        Region: cosRegion(),
        Key: k,
        UploadId: String(uploadId),
      },
      (err, data) => {
        if (err) reject(err);
        else resolve(data);
      }
    );
  });
}

/** 下载 COS 对象正文（服务端拉取，用于音频内嵌封面等） */
export async function getCosObjectBuffer(objectKey) {
  const cos = getCos();
  const key = String(objectKey).replace(/^\//, "");
  const params = {
    Bucket: cosBucket(),
    Region: cosRegion(),
    Key: key,
  };
  return new Promise((resolve, reject) => {
    cos.getObject(params, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      const b = data.Body;
      resolve(Buffer.isBuffer(b) ? b : Buffer.from(b));
    });
  });
}

/** 与 mediaUpload.js 中 mediaPathSegment 一致（避免循环依赖） */
function mediaPathSegmentForUploads(userId) {
  const s = String(userId ?? "").replace(/[^a-zA-Z0-9._-]/g, "_");
  return s.length > 0 ? s : null;
}

/**
 * 列出桶内指定前缀下全部对象键（分页）
 * @param {string} prefix
 * @returns {Promise<string[]>}
 */
export async function listAllCosKeysWithPrefix(prefix) {
  const p = String(prefix ?? "").replace(/^\//, "");
  if (!p) return [];
  const cos = getCos();
  const keys = [];
  let marker = "";
  for (;;) {
    const data = await new Promise((resolve, reject) => {
      cos.getBucket(
        {
          Bucket: cosBucket(),
          Region: cosRegion(),
          Prefix: p,
          ...(marker ? { Marker: marker } : {}),
          MaxKeys: 1000,
        },
        (err, d) => (err ? reject(err) : resolve(d))
      );
    });
    for (const obj of data.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    const truncated = data.IsTruncated === true || data.IsTruncated === "true";
    if (!truncated) break;
    marker = data.NextMarker || "";
    if (!marker && (data.Contents?.length ?? 0) > 0) {
      marker = data.Contents[data.Contents.length - 1].Key;
    }
    if (!marker) break;
  }
  return keys;
}

/**
 * 头像对象键：`{root}/{userId}.ext` 或 `{root}/{userId}-thumb.webp`，
 * 须避免 `u-123` 前缀误包含 `u-1234`（不能仅靠 list 的 Prefix）。
 */
function cosKeyBelongsToUserAvatar(key, root, userId) {
  const r = String(root ?? "").replace(/\/$/, "");
  const base = `${r}/${userId}`;
  const k = String(key);
  if (!k.startsWith(base)) return false;
  if (k.length === base.length) return true;
  const next = k.charAt(base.length);
  return next === "." || next === "-";
}

/**
 * 批量删除对象（每批最多 1000）
 * @param {string[]} keys
 */
export async function deleteCosObjectsByKeys(keys) {
  const list = [...new Set(keys.map((k) => String(k).replace(/^\//, "")).filter(Boolean))];
  if (list.length === 0) return;
  const cos = getCos();
  const CHUNK = 1000;
  for (let i = 0; i < list.length; i += CHUNK) {
    const slice = list.slice(i, i + CHUNK);
    const Objects = slice.map((Key) => ({ Key }));
    await new Promise((resolve, reject) => {
      cos.deleteMultipleObject(
        {
          Bucket: cosBucket(),
          Region: cosRegion(),
          Objects,
          Quiet: "true",
        },
        (err, data) => {
          if (err) return reject(err);
          const errors = data?.Error;
          const errArr =
            errors == null ? [] : Array.isArray(errors) ? errors : [errors];
          const real = errArr.filter((e) => e && (e.Code || e.Message));
          if (real.length > 0) {
            reject(new Error(real[0].Message || real[0].Code || "COS 批量删除失败"));
            return;
          }
          resolve(data);
        }
      );
    });
  }
}

/**
 * 删除某用户在 COS 中的数据：笔记 JSON、附件目录、头像（与 {@link cosReadAuth} 前缀规则一致）
 * @param {string} userId
 */
export async function deleteCosObjectsForUserAccount(userId) {
  if (!isCosConfigured()) return;
  const uid = sanitizeUserId(userId);
  const uniq = new Set();

  uniq.add(collectionsObjectKeyForUser(uid));

  const mediaSeg = mediaPathSegmentForUploads(uid);
  if (mediaSeg) {
    const mediaFolderPrefix = `${cosMediaPrefix()}/${mediaSeg}/`;
    const mediaKeys = await listAllCosKeysWithPrefix(mediaFolderPrefix);
    for (const k of mediaKeys) uniq.add(k);
  }

  const avatarRoots = [...new Set([cosAvatarPrefix(), "mikujar/avatars"])];
  for (const root of avatarRoots) {
    const narrowPrefix = `${root.replace(/\/$/, "")}/${uid}`;
    const candidates = await listAllCosKeysWithPrefix(narrowPrefix);
    for (const k of candidates) {
      if (cosKeyBelongsToUserAvatar(k, root, uid)) uniq.add(k);
    }
  }

  await deleteCosObjectsByKeys([...uniq]);
}
