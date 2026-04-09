/**
 * users.js — 用户管理，存储后端由 PostgreSQL 提供。
 * 对外签名与旧版保持兼容，但去掉了所有 filePath 参数。
 */

import bcrypt from "bcryptjs";
import { query } from "./db.js";
import { snapshotMediaQuota } from "./mediaQuota.js";
import {
  buildObjectPublicUrl,
  isCosConfigured,
  putCosObject,
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
  /** readUsersList / verifyLogin 已转成 camelCase；少数路径仍传 PG 行（snake_case） */
  const displayNameRaw =
    (u.display_name != null && String(u.display_name).trim()) ||
    (u.displayName != null && String(u.displayName).trim()) ||
    "";
  const avatarRaw =
    (u.avatar_url != null && String(u.avatar_url).trim()) ||
    (u.avatarUrl != null && String(u.avatarUrl).trim()) ||
    "";
  const emailRaw =
    u.email != null && String(u.email).trim()
      ? String(u.email).trim()
      : "";
  const quota = snapshotMediaQuota({
    role: u.role,
    media_usage_month: u.media_usage_month,
    media_uploaded_bytes_month: u.media_uploaded_bytes_month,
  });
  return {
    id: u.id,
    username: u.username,
    displayName: displayNameRaw || u.username,
    role: u.role,
    avatarUrl: avatarRaw,
    mediaQuota: {
      usageMonth: quota.usageMonth,
      uploadedBytesMonth: quota.uploadedBytesMonth,
      monthlyLimitBytes: quota.monthlyLimitBytes,
      singleFileMaxBytes: quota.singleFileMaxBytes,
      ...(quota.quotaUnlimited ? { quotaUnlimited: true } : {}),
    },
    ...(emailRaw ? { email: emailRaw } : {}),
  };
}

/** 读取全部用户（含 passwordHash，供登录校验与管理列表） */
export async function readUsersList(_filePath) {
  const res = await query(
    `SELECT id, username, password_hash, display_name, role, avatar_url, email,
            media_usage_month, media_uploaded_bytes_month
     FROM users ORDER BY created_at`
  );
  // 字段名适配旧格式（index.js 用 passwordHash 字段验证）
  return res.rows.map((r) => ({
    id: r.id,
    username: r.username,
    passwordHash: r.password_hash,
    displayName: r.display_name,
    role: r.role,
    avatarUrl: r.avatar_url,
    email: r.email || "",
    media_usage_month: r.media_usage_month,
    media_uploaded_bytes_month: r.media_uploaded_bytes_month,
  }));
}

/**
 * 按 id 读单用户（不含 password_hash，供 /api/auth/me 等热路径）
 */
export async function readUserById(_filePath, userId) {
  const id = String(userId || "").trim();
  if (!id) return null;
  const res = await query(
    `SELECT id, username, display_name, role, avatar_url, email,
            media_usage_month, media_uploaded_bytes_month
     FROM users WHERE id = $1`,
    [id]
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    role: r.role,
    avatarUrl: r.avatar_url,
    email: r.email?.trim() || undefined,
    media_usage_month: r.media_usage_month,
    media_uploaded_bytes_month: r.media_uploaded_bytes_month,
  };
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

export async function verifyLogin(_filePath, usernameOrEmail, password) {
  const key = String(usernameOrEmail || "").trim();
  if (!key) return null;
  const res = await query(
    `SELECT id, username, password_hash, display_name, role, avatar_url, email,
            media_usage_month, media_uploaded_bytes_month
     FROM users
     WHERE username = $1 OR (email IS NOT NULL AND LOWER(email) = LOWER($2))`,
    [key, key]
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
    email: u.email || "",
    media_usage_month: u.media_usage_month,
    media_uploaded_bytes_month: u.media_uploaded_bytes_month,
  };
}

function validUsername(s) {
  const t = String(s || "").trim();
  return /^[a-zA-Z0-9_]{2,32}$/.test(t);
}

/** 站长 / 普通住民 / 订阅（与附件额度一致） */
function normalizeAccountRole(body) {
  const r = body?.role;
  if (r === "admin") return "admin";
  if (r === "subscriber") return "subscriber";
  return "user";
}

export async function createUserRecord(_filePath, body) {
  const username = String(body?.username || "").trim();
  const password = String(body?.password || "");
  const displayName = String(body?.displayName || "").trim() || username;
  const role = normalizeAccountRole(body);
  const emailRaw = typeof body?.email === "string" ? body.email.trim() : "";

  if (!validUsername(username)) throw new Error("用户名须为 2–32 位字母、数字或下划线");
  if (password.length < 4) throw new Error("密码至少 4 位");

  // 检查重名
  const dup = await query("SELECT id FROM users WHERE username = $1", [username]);
  if (dup.rowCount > 0) throw new Error("用户名已存在");

  let emailNorm = null;
  if (emailRaw) {
    const e = emailRaw.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error("邮箱格式不正确");
    const dupE = await query(
      "SELECT id FROM users WHERE email IS NOT NULL AND LOWER(email) = $1",
      [e]
    );
    if (dupE.rowCount > 0) throw new Error("邮箱已被使用");
    emailNorm = e;
  }

  const id = `u-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const hash = await bcrypt.hash(password, 10);

  await query(
    `INSERT INTO users (id, username, password_hash, display_name, role, avatar_url, email)
     VALUES ($1, $2, $3, $4, $5, '', $6)`,
    [id, username, hash, displayName, role, emailNorm]
  );

  return toPublicUser({
    id,
    username,
    display_name: displayName,
    role,
    avatar_url: "",
    email: emailNorm,
    media_usage_month: "",
    media_uploaded_bytes_month: 0,
  });
}

/**
 * 邮箱验证码注册成功后创建用户（role=user），username 由邮箱自动生成且唯一。
 */
export async function createUserWithEmail({ email, password, displayName }) {
  const emailNorm = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
    throw new Error("邮箱格式不正确");
  }
  if (password.length < 6) throw new Error("密码至少 6 位");
  const dup = await query("SELECT id FROM users WHERE email IS NOT NULL AND LOWER(email) = $1", [
    emailNorm,
  ]);
  if (dup.rowCount > 0) throw new Error("该邮箱已注册");

  const username = await generateUniqueUsernameFromEmail(emailNorm);
  const disp =
    String(displayName || "").trim().slice(0, 64) ||
    emailNorm.split("@")[0] ||
    username;
  const id = `u-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const hash = await bcrypt.hash(password, 10);

  await query(
    `INSERT INTO users (id, username, password_hash, display_name, role, avatar_url, email)
     VALUES ($1, $2, $3, $4, 'user', '', $5)`,
    [id, username, hash, disp, emailNorm]
  );

  return toPublicUser({
    id,
    username,
    display_name: disp,
    role: "user",
    avatar_url: "",
    email: emailNorm,
    media_usage_month: "",
    media_uploaded_bytes_month: 0,
  });
}

async function generateUniqueUsernameFromEmail(emailNorm) {
  const local = emailNorm
    .split("@")[0]
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24);
  let base =
    local.length >= 2 ? local : `u${Date.now().toString(36)}`;
  if (!/^[a-zA-Z0-9_]{2,32}$/.test(base)) {
    base = `u${Date.now().toString(36)}`.slice(0, 32);
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = (attempt === 0 ? base : `${base.slice(0, 26)}_${attempt}`).slice(0, 32);
    const dup = await query("SELECT id FROM users WHERE username = $1", [candidate]);
    if (dup.rowCount === 0) return candidate;
  }
  throw new Error("无法生成用户名，请稍后重试");
}

export async function updateUserRecord(_filePath, id, body) {
  // 先取当前记录
  const cur = await query(
    `SELECT id, username, display_name, role, avatar_url, email,
            media_usage_month, media_uploaded_bytes_month
     FROM users WHERE id = $1`,
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

  if (typeof body.username === "string") {
    const nu = body.username.trim();
    if (!validUsername(nu)) throw new Error("用户名须为 2–32 位字母、数字或下划线");
    const dup = await query("SELECT id FROM users WHERE username = $1 AND id <> $2", [nu, id]);
    if (dup.rowCount > 0) throw new Error("用户名已存在");
    fields.push(`username = $${i++}`);
    params.push(nu);
  }

  if (body.email !== undefined) {
    const raw = typeof body.email === "string" ? body.email.trim() : "";
    if (!raw) {
      fields.push(`email = $${i++}`);
      params.push(null);
    } else {
      const e = raw.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error("邮箱格式不正确");
      const dup = await query(
        "SELECT id FROM users WHERE email IS NOT NULL AND LOWER(email) = $1 AND id <> $2",
        [e, id]
      );
      if (dup.rowCount > 0) throw new Error("邮箱已被使用");
      fields.push(`email = $${i++}`);
      params.push(e);
    }
  }

  if (body.role === "admin" || body.role === "user" || body.role === "subscriber") {
    if (u.role === "admin" && body.role !== "admin") {
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
    `SELECT id, username, display_name, role, avatar_url, email,
            media_usage_month, media_uploaded_bytes_month
     FROM users WHERE id = $1`,
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
    await putCosObject(key, buffer, mime);
    return withAvatarCacheBust(buildObjectPublicUrl(key));
  }
  const dir = join(opts.publicDir, "uploads", "avatars");
  await mkdir(dir, { recursive: true });
  const filename = `${userId}.${ext}`;
  await writeFile(join(dir, filename), buffer);
  return withAvatarCacheBust(`/uploads/avatars/${filename}`);
}
