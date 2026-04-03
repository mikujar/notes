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

function getCos() {
  if (cosClient) return cosClient;
  cosClient = new COS({
    SecretId: process.env.COS_SECRET_ID.trim(),
    SecretKey: process.env.COS_SECRET_KEY.trim(),
  });
  return cosClient;
}

function cosBucket() {
  return process.env.COS_BUCKET.trim();
}

function cosRegion() {
  return process.env.COS_REGION.trim();
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
    return `cos: ${cosBucket()} / ${cosObjectKey()} legacy + ${collectionsCosPrefix()}/*.json per user (${cosRegion()})`;
  }
  return null;
}

/** 与 collections 无关：只要配了 COS 密钥与桶，即可用于附件上传 */
export function isCosConfigured() {
  return storageMode() === "cos";
}

/** 浏览器可直接访问的 URL（需对象 public-read 或桶策略允许读） */
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
  return `https://${cosBucket()}.cos.${cosRegion()}.myqcloud.com/${encoded}`;
}

/** 上传可公开访问的媒体对象 */
export async function putCosPublicObject(objectKey, buffer, contentType) {
  const cos = getCos();
  const key = String(objectKey).replace(/^\//, "");
  const params = {
    Bucket: cosBucket(),
    Region: cosRegion(),
    Key: key,
    Body: buffer,
    ContentType: contentType || "application/octet-stream",
    ACL: "public-read",
  };
  return new Promise((resolve, reject) => {
    cos.putObject(params, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

/**
 * 浏览器直传 COS 的预签名 PUT（须与前端请求头 Content-Type、x-cos-acl 完全一致）
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
          "x-cos-acl": "public-read",
        },
      },
      (err, data) => {
        if (err) reject(err);
        else resolve(data.Url);
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
