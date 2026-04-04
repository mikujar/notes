/**
 * users.js — 用户管理，存储后端由 PostgreSQL 提供。
 * 对外签名与旧版保持兼容，但去掉了所有 filePath 参数。
 */

import bcrypt from "bcryptjs";
import { query } from "./db.js";
import {
  buildObjectPublicUrl,
  isCosConfigured,
  putCosPublicObject,
} from "./storage.js";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

const IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
]);

const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
};

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_EXT_SET = new Set(Object.values(MIME_EXT));

/** 同一路径二次上传时浏览器会强缓存旧图，每次写入后换 query 才能刷新显示 */
function withAvatarCacheBust(url) {
  const s = String(url);
  const sep = s.includes("?") ? "&" : "?";
  return `${s}${sep}v=${Date.now()}`;
}

// ─── 兼容旧版 index.js 的 usersFilePath 导出（不再实际使用，但保留避免 import 报错）───
export function usersFilePath(_root) {
  return "";
}

/** 首次启动且 users 表为空时，由 ADMIN_PASSWORD 自动创建的管理员登录名 */
export const BOOTSTRAP_ADMIN_USERNAME = "hejiac_admin";

// ─────────────────────────────────────────────────────────────────────────────
// COS 直传头像
// ─────────────────────────────────────────────────────────────────────────────

/**
 * COS 直传头像：返回对象键与参与签名的 Content-Type（须与浏览器 PUT 头一致）
 */
export function planAvatarCosDirectUpload(userId, contentType, fileSize) {
  if (!isCosConfigured()) throw new Error("未配置 COS");
  const n = Number(fileSize);
  if (!Number.isFinite(n) || n < 1 || n > AVATAR_MAX_BYTES) {
    throw new Error("头像不超过 2MB");
  }
  const mime = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (!IMAGE_MIME.has(mime)) {
    throw new Error("仅支持 JPEG / PNG / GIF / WebP / AVIF 图片");
  }
  const ext = MIME_EXT[mime] || "jpg";
  const key = `mikujar/avatars/${userId}.${ext}`;
  return { key, contentType: mime };
}

export function assertValidAvatarCosKey(userId, key) {
  const k = String(key || "").replace(/^\//, "");
  const prefix = `mikujar/avatars/${userId}.`;
  if (!k.startsWith(prefix)) throw new Error("无效的头像路径");
  const ext = k.slice(prefix.length);
  if (!AVATAR_EXT_SET.has(ext)) throw new Error("无效的头像路径");
}

export async function confirmAvatarCosUpload(_filePath, userId, key) {
  assertValidAvatarCosKey(userId, key);
  const url = withAvatarCacheBust(buildObjectPublicUrl(key));
  await setUserAvatarUrl(_filePath, userId, url);
  return url;
}

// ─────────────────────────────────────────────────────────────────────────────
// 用户读写（PostgreSQL）
// ─────────────────────────────────────────────────────────────────────────────

export function toPublicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: (u.display_name && String(u.display_name).trim()) || u.username,
    role: u.role,
    avatarUrl: u.avatar_url ? String(u.avatar_url) : "",
  };
}

/** 读取全部用户（不含 passwordHash） */
export async function readUsersList(_filePath) {
  const res = await query(
    "SELECT id, username, password_hash, display_name, role, avatar_url FROM users ORDER BY created_at"
  );
  // 字段名适配旧格式（index.js 用 passwordHash 字段验证）
  return res.rows.map((r) => ({
    id: r.id,
    username: r.username,
    passwordHash: r.password_hash,
    displayName: r.display_name,
    role: r.role,
    avatarUrl: r.avatar_url,
  }));
}

/**
 * 首次启动时若 users 表为空，用 ADMIN_PASSWORD 自动创建管理员。
 * 签名：ensureBootstrapAdmin(_filePath?, password) — filePath 参数保留但忽略。
 */
export async function ensureBootstrapAdmin(_filePath, adminPassword) {
  if (!adminPassword) return;
  const res = await query("SELECT COUNT(*) AS cnt FROM users");
  if (Number(res.rows[0].cnt) > 0) return;

  const hash = await bcrypt.hash(adminPassword, 10);
  const id = `u-${Date.now()}`;
  await query(
    `INSERT INTO users (id, username, password_hash, display_name, role, avatar_url)
     VALUES ($1, $2, $3, $4, 'admin', '')
     ON CONFLICT (username) DO NOTHING`,
    [id, BOOTSTRAP_ADMIN_USERNAME, hash, "管理员"]
  );
}

export async function verifyLogin(_filePath, username, password) {
  const res = await query(
    "SELECT id, username, password_hash, display_name, role, avatar_url FROM users WHERE username = $1",
    [String(username || "").trim()]
  );
  const u = res.rows[0];
  if (!u || !u.password_hash) return null;
  const ok = await bcrypt.compare(String(password || ""), u.password_hash);
  if (!ok) return null;
  return {
    id: u.id,
    username: u.username,
    passwordHash: u.password_hash,
    displayName: u.display_name,
    role: u.role,
    avatarUrl: u.avatar_url,
  };
}

function validUsername(s) {
  const t = String(s || "").trim();
  return /^[a-zA-Z0-9_]{2,32}$/.test(t);
}

export async function createUserRecord(_filePath, body) {
  const username = String(body?.username || "").trim();
  const password = String(body?.password || "");
  const displayName = String(body?.displayName || "").trim() || username;
  const role = body?.role === "user" ? "user" : "admin";

  if (!validUsername(username)) throw new Error("用户名须为 2–32 位字母、数字或下划线");
  if (password.length < 4) throw new Error("密码至少 4 位");

  // 检查重名
  const dup = await query("SELECT id FROM users WHERE username = $1", [username]);
  if (dup.rowCount > 0) throw new Error("用户名已存在");

  const id = `u-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const hash = await bcrypt.hash(password, 10);

  await query(
    `INSERT INTO users (id, username, password_hash, display_name, role, avatar_url)
     VALUES ($1, $2, $3, $4, $5, '')`,
    [id, username, hash, displayName, role]
  );

  return toPublicUser({ id, username, display_name: displayName, role, avatar_url: "" });
}

export async function updateUserRecord(_filePath, id, body) {
  // 先取当前记录
  const cur = await query(
    "SELECT id, username, display_name, role, avatar_url FROM users WHERE id = $1",
    [id]
  );
  if (cur.rowCount === 0) throw new Error("用户不存在");
  const u = cur.rows[0];

  const fields = [];
  const params = [];
  let i = 1;

  if (typeof body.displayName === "string") {
    const d = body.displayName.trim();
    if (d) { fields.push(`display_name = $${i++}`); params.push(d.slice(0, 64)); }
  }

  if (body.role === "admin" || body.role === "user") {
    if (u.role === "admin" && body.role === "user") {
      // 不能取消最后一位管理员
      const admins = await query("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'");
      if (Number(admins.rows[0].cnt) <= 1) throw new Error("不能取消最后一位管理员的权限");
    }
    fields.push(`role = $${i++}`);
    params.push(body.role);
  }

  if (typeof body.password === "string" && body.password.length > 0) {
    if (body.password.length < 4) throw new Error("密码至少 4 位");
    const hash = await bcrypt.hash(body.password, 10);
    fields.push(`password_hash = $${i++}`);
    params.push(hash);
  }

  if (fields.length > 0) {
    params.push(id);
    await query(`UPDATE users SET ${fields.join(", ")} WHERE id = $${i}`, params);
  }

  // 返回最新记录
  const updated = await query(
    "SELECT id, username, display_name, role, avatar_url FROM users WHERE id = $1",
    [id]
  );
  return toPublicUser(updated.rows[0]);
}

export async function deleteUserRecord(_filePath, id) {
  const cur = await query("SELECT role FROM users WHERE id = $1", [id]);
  if (cur.rowCount === 0) throw new Error("用户不存在");
  if (cur.rows[0].role === "admin") {
    const admins = await query("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'");
    if (Number(admins.rows[0].cnt) <= 1) throw new Error("不能删除最后一位管理员");
  }
  await query("DELETE FROM users WHERE id = $1", [id]);
}

export async function setUserAvatarUrl(_filePath, userId, avatarUrl) {
  const res = await query(
    "UPDATE users SET avatar_url = $1 WHERE id = $2 RETURNING id",
    [avatarUrl, userId]
  );
  if (res.rowCount === 0) throw new Error("用户不存在");
}

// ─────────────────────────────────────────────────────────────────────────────
// 头像文件保存（COS 或本地磁盘）
// ─────────────────────────────────────────────────────────────────────────────

export async function saveAvatarFile(userId, buffer, mimetype, opts) {
  const mime = String(mimetype || "").split(";")[0].trim().toLowerCase();
  if (!IMAGE_MIME.has(mime)) throw new Error("仅支持 JPEG / PNG / GIF / WebP / AVIF 图片");
  if (buffer.length > AVATAR_MAX_BYTES) throw new Error("头像不超过 2MB");

  const ext = MIME_EXT[mime] || "jpg";
  if (isCosConfigured()) {
    const key = `mikujar/avatars/${userId}.${ext}`;
    await putCosPublicObject(key, buffer, mime);
    return withAvatarCacheBust(buildObjectPublicUrl(key));
  }
  const dir = join(opts.publicDir, "uploads", "avatars");
  await mkdir(dir, { recursive: true });
  const filename = `${userId}.${ext}`;
  await writeFile(join(dir, filename), buffer);
  return withAvatarCacheBust(`/uploads/avatars/${filename}`);
}
