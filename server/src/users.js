import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
import bcrypt from "bcryptjs";
import {
  buildObjectPublicUrl,
  isCosConfigured,
  putCosPublicObject,
} from "./storage.js";

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

/** 首次启动且 users.json 为空时，由 ADMIN_PASSWORD 自动创建的管理员登录名 */
export const BOOTSTRAP_ADMIN_USERNAME = "hejiac_admin";

/** @param {string} root - server 根目录（含 data） */
export function usersFilePath(root) {
  const p = process.env.USERS_FILE?.trim();
  return p || join(root, "data", "users.json");
}

/** @returns {Promise<Array<{id: string, username: string, passwordHash: string, displayName: string, role: string, avatarUrl?: string}>>} */
export async function readUsersList(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j : [];
  } catch (e) {
    if (e && e.code === "ENOENT") return [];
    throw e;
  }
}

export async function writeUsersList(filePath, users) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(users, null, 2), "utf8");
}

export async function ensureBootstrapAdmin(filePath, adminPassword) {
  let users = await readUsersList(filePath);
  if (users.length > 0 || !adminPassword) return users;
  const hash = await bcrypt.hash(adminPassword, 10);
  users = [
    {
      id: `u-${Date.now()}`,
      username: BOOTSTRAP_ADMIN_USERNAME,
      passwordHash: hash,
      displayName: "管理员",
      role: "admin",
      avatarUrl: "",
    },
  ];
  await writeUsersList(filePath, users);
  return users;
}

export function toPublicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: (u.displayName && String(u.displayName).trim()) || u.username,
    role: u.role,
    avatarUrl: u.avatarUrl ? String(u.avatarUrl) : "",
  };
}

export async function verifyLogin(filePath, username, password) {
  const users = await readUsersList(filePath);
  const u = users.find(
    (x) => x.username === String(username || "").trim()
  );
  if (!u || !u.passwordHash) return null;
  const ok = await bcrypt.compare(String(password || ""), u.passwordHash);
  return ok ? u : null;
}

function validUsername(s) {
  const t = String(s || "").trim();
  return /^[a-zA-Z0-9_]{2,32}$/.test(t);
}

export async function createUserRecord(filePath, body) {
  const username = String(body?.username || "").trim();
  const password = String(body?.password || "");
  const displayName = String(body?.displayName || "").trim() || username;
  const role = body?.role === "user" ? "user" : "admin";
  if (!validUsername(username)) {
    throw new Error("用户名须为 2–32 位字母、数字或下划线");
  }
  if (password.length < 4) throw new Error("密码至少 4 位");
  const users = await readUsersList(filePath);
  if (users.some((x) => x.username === username)) {
    throw new Error("用户名已存在");
  }
  const id = `u-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const passwordHash = await bcrypt.hash(password, 10);
  users.push({
    id,
    username,
    passwordHash,
    displayName,
    role,
    avatarUrl: "",
  });
  await writeUsersList(filePath, users);
  return toPublicUser(users.find((x) => x.id === id));
}

export async function updateUserRecord(filePath, id, body) {
  const users = await readUsersList(filePath);
  const idx = users.findIndex((x) => x.id === id);
  if (idx < 0) throw new Error("用户不存在");
  const u = { ...users[idx] };
  if (typeof body.displayName === "string") {
    const d = body.displayName.trim();
    if (d) u.displayName = d.slice(0, 64);
  }
  if (body.role === "admin" || body.role === "user") {
    const admins = users.filter((x) => x.role === "admin");
    if (u.role === "admin" && body.role === "user" && admins.length <= 1) {
      throw new Error("不能取消最后一位管理员的权限");
    }
    u.role = body.role;
  }
  if (typeof body.password === "string" && body.password.length > 0) {
    if (body.password.length < 4) throw new Error("密码至少 4 位");
    u.passwordHash = await bcrypt.hash(body.password, 10);
  }
  users[idx] = u;
  await writeUsersList(filePath, users);
  return toPublicUser(u);
}

export async function deleteUserRecord(filePath, id) {
  const users = await readUsersList(filePath);
  const idx = users.findIndex((x) => x.id === id);
  if (idx < 0) throw new Error("用户不存在");
  const u = users[idx];
  const admins = users.filter((x) => x.role === "admin");
  if (u.role === "admin" && admins.length <= 1) {
    throw new Error("不能删除最后一位管理员");
  }
  users.splice(idx, 1);
  await writeUsersList(filePath, users);
}

export async function setUserAvatarUrl(filePath, userId, avatarUrl) {
  const users = await readUsersList(filePath);
  const idx = users.findIndex((x) => x.id === userId);
  if (idx < 0) throw new Error("用户不存在");
  users[idx] = { ...users[idx], avatarUrl };
  await writeUsersList(filePath, users);
}

/**
 * @param {Buffer} buffer
 * @param {string} mimetype
 * @param {{ publicDir: string }} opts
 */
export async function saveAvatarFile(userId, buffer, mimetype, opts) {
  const mime = String(mimetype || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!IMAGE_MIME.has(mime)) {
    throw new Error("仅支持 JPEG / PNG / GIF / WebP / AVIF 图片");
  }
  if (buffer.length > AVATAR_MAX_BYTES) {
    throw new Error("头像不超过 2MB");
  }
  const ext = MIME_EXT[mime] || "jpg";
  if (isCosConfigured()) {
    const key = `mikujar/avatars/${userId}.${ext}`;
    await putCosPublicObject(key, buffer, mime);
    return buildObjectPublicUrl(key);
  }
  const dir = join(opts.publicDir, "uploads", "avatars");
  await mkdir(dir, { recursive: true });
  const filename = `${userId}.${ext}`;
  const diskPath = join(dir, filename);
  await writeFile(diskPath, buffer);
  return `/uploads/avatars/${filename}`;
}
