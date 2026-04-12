import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { access } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { constants as fsConstants } from "fs";
import Busboy from "busboy";
import {
  finalizeAudioCoverAfterCosUpload,
  finalizeVideoThumbnailAfterCosUpload,
  getMediaUploadMode,
  planMediaCosDirectUpload,
  UPLOAD_MAX_BYTES,
} from "./mediaUpload.js";
import {
  consumeAttachmentUploadQuota,
  getAttachmentLimitsForUser,
  refundAttachmentUploadQuota,
} from "./mediaQuota.js";
import { canSessionReadCosObjectKey } from "./cosReadAuth.js";
import {
  buildObjectPublicUrl,
  extractObjectKeyFromCosPublicUrl,
  getCosGetPresignedUrl,
  getCosPutPresignedUrl,
  isCosConfigured,
} from "./storage.js";
import {
  confirmAvatarCosUpload,
  createUserRecord,
  deleteUserRecord,
  BOOTSTRAP_ADMIN_USERNAME,
  ensureBootstrapAdmin,
  planAvatarCosDirectUpload,
  readUsersList,
  readUserById,
  saveAvatarFile,
  setUserAvatarUrl,
  toPublicUser,
  updateUserRecord,
  usersFilePath,
  verifyLogin,
} from "./users.js";
import {
  getCollectionsTree,
  replaceCollectionsTree,
  createCollection,
  updateCollection,
  deleteCollection,
  createCard,
  updateCard,
  deleteCard,
  listFavoriteCollectionIds,
  replaceFavoriteCollectionIds,
  listTrashedNotes,
  insertTrashedNote,
  deleteTrashedNote,
  clearTrashedNotes,
} from "./storage-pg.js";
import {
  broadcastCollectionsChanged,
  subscribeCollectionsSync,
} from "./syncFanout.js";
import { pingDb, closePool } from "./db.js";
import {
  completeRegistration,
  sendRegistrationCode,
} from "./registration.js";
import {
  consumeProfileEmailChangeCode,
  sendProfileEmailChangeCode,
} from "./profileEmail.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });
const ROOT = join(__dirname, "..");
const PORT = Number(process.env.PORT || 3002);
const API_TOKEN = process.env.API_TOKEN?.trim() || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim() || "";
const JWT_SECRET = process.env.JWT_SECRET?.trim() || "";
/** 有 JWT_SECRET 且存在至少一名用户时启用 */
let adminGateEnabled = false;
const publicDir = join(ROOT, "public");

async function fileExists(p) {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Vite 构建产物带 hash 的文件可长期缓存；HTML 等需每次协商，便于 304。 */
function setStaticCacheHeaders(res, absolutePath) {
  const rel = absolutePath.startsWith(publicDir)
    ? absolutePath.slice(publicDir.length).replace(/\\/g, "/")
    : absolutePath.replace(/\\/g, "/");
  const inAssets = rel.includes("/assets/");
  if (inAssets) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    res.setHeader("Cache-Control", "max-age=0, must-revalidate");
  }
}

const hasPublic = await fileExists(publicDir);

const app = express();
if (process.env.TRUST_PROXY === "1") {
  app.set("trust proxy", 1);
}
app.use(express.json({ limit: "15mb" }));

const corsOrigin = process.env.CORS_ORIGIN;
/** 浏览器缓存 CORS 预检 OPTIONS 的秒数（Access-Control-Max-Age）；部分浏览器会自行封顶（如约 2h） */
const CORS_MAX_AGE = Math.min(
  86400,
  Math.max(0, Number(process.env.CORS_MAX_AGE ?? 86400) || 86400)
);

/**
 * Tauri 在不同平台/版本下可能发 `Origin: https://tauri.localhost` 或 `http://tauri.localhost`。
 * 对 tauri.localhost / ipc.localhost 自动补全另一协议。
 */
function buildCorsAllowedOrigins(envVal) {
  if (!envVal?.trim()) return null;
  const list = envVal.split(",").map((s) => s.trim()).filter(Boolean);
  const set = new Set(list);
  const mirrorHosts = new Set(["tauri.localhost", "ipc.localhost"]);
  for (const o of [...set]) {
    try {
      const u = new URL(o);
      if (!mirrorHosts.has(u.host)) continue;
      const altProto = u.protocol === "https:" ? "http:" : "https:";
      set.add(`${altProto}//${u.host}`);
    } catch { /* 非 URL 则跳过 */ }
  }
  return [...set];
}

const corsAllowedList = buildCorsAllowedOrigins(corsOrigin);
const corsOptions =
  corsAllowedList && corsAllowedList.length > 0
    ? { origin: corsAllowedList, credentials: true, maxAge: CORS_MAX_AGE }
    : { origin: false, maxAge: CORS_MAX_AGE };
app.use(cors(corsOptions));

// ─────────────────────────────────────────────────────────────────────────────
// 鉴权中间件
// ─────────────────────────────────────────────────────────────────────────────

function verifyAdminWrite(req) {
  if (!adminGateEnabled) {
    if (API_TOKEN) return req.headers.authorization === `Bearer ${API_TOKEN}`;
    return true;
  }
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return false;
  const token = auth.slice(7);
  if (API_TOKEN && token === API_TOKEN) return true;
  try {
    const p = jwt.verify(token, JWT_SECRET);
    return p.role === "admin";
  } catch {
    return false;
  }
}

function putAuthMiddleware(req, res, next) {
  if (!verifyAdminWrite(req)) {
    return res.status(401).json({ error: "未授权", code: "PUT_AUTH" });
  }
  next();
}

/** httpOnly 会话 Cookie 名（与前端 credentials: include 配合） */
const AUTH_COOKIE_NAME = "mikujar_at";

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader || typeof cookieHeader !== "string") return out;
  for (const segment of cookieHeader.split(";")) {
    const idx = segment.indexOf("=");
    if (idx <= 0) continue;
    const k = segment.slice(0, idx).trim();
    const v = segment.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function authCookieBaseOptions() {
  const opts = { path: "/" };
  const domain = process.env.AUTH_COOKIE_DOMAIN?.trim();
  if (domain) opts.domain = domain;
  const secure =
    process.env.COOKIE_SECURE === "true" ||
    (process.env.COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production");
  opts.secure = secure;
  const s = process.env.COOKIE_SAMESITE?.trim().toLowerCase();
  if (s === "none") opts.sameSite = "none";
  else if (s === "strict") opts.sameSite = "strict";
  else opts.sameSite = "lax";
  return opts;
}

function authCookieSetOptions() {
  return {
    ...authCookieBaseOptions(),
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

// ─── 登录暴力破解：按 IP 累计失败次数 ─────────────────────────────────────────
const loginFailByIp = new Map();
const LOGIN_FAIL_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAIL_MAX = 15;

function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function isLoginLockedOut(ip) {
  const rec = loginFailByIp.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.since > LOGIN_FAIL_WINDOW_MS) {
    loginFailByIp.delete(ip);
    return false;
  }
  return rec.count >= LOGIN_FAIL_MAX;
}

function registerLoginFailure(ip) {
  const now = Date.now();
  let rec = loginFailByIp.get(ip);
  if (!rec || now - rec.since > LOGIN_FAIL_WINDOW_MS) {
    rec = { count: 0, since: now };
    loginFailByIp.set(ip, rec);
  }
  rec.count += 1;
}

function clearLoginFailures(ip) {
  loginFailByIp.delete(ip);
}

function getJwtSession(req) {
  let token = null;
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    token = auth.slice(7);
  }
  if (!token) {
    const cookies = parseCookies(req.headers.cookie);
    const c = cookies[AUTH_COOKIE_NAME];
    if (typeof c === "string" && c.trim()) token = c.trim();
  }
  // EventSource 无法携带 Authorization，允许通过查询参数传 JWT（生产环境务必 HTTPS）
  if (!token && req.query && typeof req.query.access_token === "string") {
    const q = req.query.access_token.trim();
    if (q) token = q;
  }
  if (!token) return null;
  if (API_TOKEN && token === API_TOKEN) return { sub: null, role: "admin", apiToken: true };
  if (!JWT_SECRET) return null;
  try {
    const p = jwt.verify(token, JWT_SECRET);
    return { sub: p.sub, role: p.role, apiToken: false };
  } catch {
    return null;
  }
}

function attachJwtSession(req, res, next) {
  const s = getJwtSession(req);
  if (!s) return res.status(401).json({ error: "未授权", code: "AUTH" });
  req.jwtSession = s;
  next();
}

function requireAdminSession(req, res, next) {
  const s = req.jwtSession;
  if (s.apiToken || s.role === "admin") return next();
  return res.status(403).json({ error: "需要管理员权限" });
}

function requireLoggedInUser(req, res, next) {
  const s = req.jwtSession;
  if (!s.sub || s.apiToken) return res.status(401).json({ error: "请先登录用户账号" });
  req.userId = s.sub;
  next();
}

/** 多用户：读取自己的笔记；脚本令牌须带 ?userId= */
function requireCollectionsReader(req, res, next) {
  const s = getJwtSession(req);
  if (!s) return res.status(401).json({ error: "请登录后查看笔记", code: "AUTH" });
  if (s.apiToken) {
    const uid = typeof req.query.userId === "string" ? req.query.userId.trim() : "";
    if (!uid) return res.status(400).json({ error: "使用 API 令牌时请在查询参数中指定 userId", code: "USER_ID_REQUIRED" });
    req.collectionsUserId = uid;
    return next();
  }
  if (!s.sub) return res.status(401).json({ error: "请登录后查看笔记", code: "AUTH" });
  req.collectionsUserId = s.sub;
  next();
}

/** 多用户：任意登录用户可保存自己的数据；脚本令牌须带 ?userId= */
function requireCollectionsWriter(req, res, next) {
  const s = getJwtSession(req);
  if (!s) return res.status(401).json({ error: "未授权", code: "PUT_AUTH" });
  if (s.apiToken) {
    const uid = typeof req.query.userId === "string" ? req.query.userId.trim() : "";
    if (!uid) return res.status(400).json({ error: "使用 API 令牌时请在查询参数中指定 userId", code: "USER_ID_REQUIRED" });
    req.collectionsUserId = uid;
    return next();
  }
  if (!s.sub) return res.status(401).json({ error: "未授权", code: "PUT_AUTH" });
  req.collectionsUserId = s.sub;
  next();
}

/** 附件上传鉴权 */
function requireUploadAuth(req, res, next) {
  const s = getJwtSession(req);
  if (!s) return res.status(401).json({ error: "未授权", code: "UPLOAD_AUTH" });
  if (s.apiToken) {
    const uid = typeof req.query.userId === "string" ? req.query.userId.trim() : "";
    if (!uid) return res.status(400).json({ error: "使用 API 令牌上传时请指定查询参数 userId", code: "USER_ID_REQUIRED" });
    req.uploadUserId = uid;
    return next();
  }
  if (!s.sub) return res.status(401).json({ error: "未授权", code: "UPLOAD_AUTH" });
  req.uploadUserId = s.sub;
  next();
}

/**
 * multipart 文件名常为 UTF-8 字节被误读成 Latin-1，导致中文等乱码。
 */
function normalizeMultipartFilename(name) {
  if (typeof name !== "string" || !name) return name;
  if ([...name].some((ch) => (ch.codePointAt(0) ?? 0) > 0xff)) return name;
  const recovered = Buffer.from(name, "latin1").toString("utf8");
  if (recovered.includes("\uFFFD")) return name;
  return recovered;
}

// ─────────────────────────────────────────────────────────────────────────────
// 健康检查
// ─────────────────────────────────────────────────────────────────────────────

app.get("/api/health", async (_req, res) => {
  let dbOk = false;
  let dbError = null;
  try {
    await pingDb();
    dbOk = true;
  } catch (e) {
    dbError = e.message;
  }
  res.status(dbOk ? 200 : 503).json({
    ok: dbOk,
    service: "mikujar-api",
    storage: "postgres",
    mediaUpload: getMediaUploadMode(hasPublic),
    db: dbOk ? "ok" : `error: ${dbError}`,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 认证
// ─────────────────────────────────────────────────────────────────────────────

app.get("/api/auth/status", (_req, res) => {
  res.json({ writeRequiresLogin: adminGateEnabled });
});

app.post("/api/auth/login", async (req, res) => {
  if (!adminGateEnabled) {
    return res.status(400).json({
      error: `未启用登录：请配置 JWT_SECRET，并设置 ADMIN_PASSWORD 完成首次启动（将自动创建用户名为 ${BOOTSTRAP_ADMIN_USERNAME} 的管理员）或手动维护 users 表`,
    });
  }
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!username || !password) return res.status(400).json({ error: "请输入用户名与密码" });
  const ip = clientIp(req);
  if (isLoginLockedOut(ip)) {
    return res.status(429).json({ error: "登录尝试过多，请约 15 分钟后再试", code: "RATE_LIMIT" });
  }
  try {
    const user = await verifyLogin(null, username, password);
    if (!user) {
      registerLoginFailure(ip);
      return res.status(401).json({ error: "用户名或密码错误" });
    }
    clearLoginFailures(ip);
    const token = jwt.sign({ sub: user.id, role: user.role, u: user.username }, JWT_SECRET, { expiresIn: "7d" });
    if (process.env.AUTH_HTTPONLY_COOKIE !== "false") {
      res.cookie(AUTH_COOKIE_NAME, token, authCookieSetOptions());
    }
    res.json({ token, user: toPublicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "登录失败" });
  }
});

function respondMethodPostOnly(res, bodyHint) {
  res.set("Allow", "POST");
  res.status(405).json({
    error: "此接口仅支持 POST，浏览器地址栏访问会失败",
    hint: bodyHint,
  });
}

app.get("/api/auth/register/send-code", (_req, res) => {
  respondMethodPostOnly(
    res,
    'POST /api/auth/register/send-code，Content-Type: application/json，body: { "email": "you@example.com" }'
  );
});

app.post("/api/auth/register/send-code", async (req, res) => {
  if (!adminGateEnabled) {
    return res.status(400).json({
      error: `未启用登录：请配置 JWT_SECRET，并设置 ADMIN_PASSWORD 完成首次启动（将自动创建用户名为 ${BOOTSTRAP_ADMIN_USERNAME} 的管理员）或手动维护 users 表`,
    });
  }
  const email =
    typeof req.body?.email === "string" ? req.body.email.trim() : "";
  const ip = clientIp(req);
  try {
    await sendRegistrationCode(email, ip);
    res.json({ ok: true });
  } catch (e) {
    const msg = e?.message || "发送失败";
    const status =
      msg.includes("频繁") || msg.includes("过多") ? 429 : 400;
    res.status(status).json({ error: msg });
  }
});

app.get("/api/auth/register", (_req, res) => {
  respondMethodPostOnly(
    res,
    'POST /api/auth/register，body: { email, code, password, displayName? }'
  );
});

app.post("/api/auth/register", async (req, res) => {
  if (!adminGateEnabled) {
    return res.status(400).json({
      error: `未启用登录：请配置 JWT_SECRET，并设置 ADMIN_PASSWORD 完成首次启动（将自动创建用户名为 ${BOOTSTRAP_ADMIN_USERNAME} 的管理员）或手动维护 users 表`,
    });
  }
  try {
    const user = await completeRegistration(req.body);
    const token = jwt.sign(
      { sub: user.id, role: user.role, u: user.username },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    if (process.env.AUTH_HTTPONLY_COOKIE !== "false") {
      res.cookie(AUTH_COOKIE_NAME, token, authCookieSetOptions());
    }
    res.json({ token, user });
  } catch (e) {
    res.status(400).json({ error: e.message || "注册失败" });
  }
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME, authCookieBaseOptions());
  res.json({ ok: true });
});

app.get("/api/auth/me", async (req, res) => {
  if (!adminGateEnabled) return res.json({ ok: true, admin: true, user: null });
  const s = getJwtSession(req);
  if (!s) return res.json({ ok: false, admin: false, user: null });
  if (s.apiToken) return res.json({ ok: true, admin: true, user: null });
  try {
    const user = await readUserById(null, s.sub);
    if (!user) return res.json({ ok: false, admin: false, user: null });
    return res.json({ ok: true, admin: user.role === "admin", user: toPublicUser(user) });
  } catch (e) {
    console.error(e);
    return res.json({ ok: false, admin: false, user: null });
  }
});

app.post("/api/users/me/email/send-code", attachJwtSession, requireLoggedInUser, async (req, res) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email : "";
    const ip = clientIp(req);
    await sendProfileEmailChangeCode(req.userId, email, ip);
    res.json({ ok: true });
  } catch (e) {
    const msg = e?.message || "发送失败";
    const status =
      msg.includes("频繁") || msg.includes("过多") ? 429 : 400;
    res.status(status).json({ error: msg });
  }
});

app.get("/api/users/me/email/send-code", (_req, res) => {
  respondMethodPostOnly(
    res,
    "需登录后 POST /api/users/me/email/send-code，body: { \"email\": \"new@example.com\" }"
  );
});

/** 登录用户自助修改昵称、邮箱、密码（不可改角色）；换绑非空新邮箱须先 POST send-code 并传 emailCode */
app.patch("/api/users/me", attachJwtSession, requireLoggedInUser, async (req, res) => {
  try {
    const user = await readUserById(null, req.userId);
    if (!user) return res.status(404).json({ error: "用户不存在" });

    const body = {};
    if (typeof req.body?.displayName === "string") {
      body.displayName = req.body.displayName;
    }
    if (typeof req.body?.password === "string" && req.body.password.length > 0) {
      body.password = req.body.password;
    }
    if (req.body != null && Object.prototype.hasOwnProperty.call(req.body, "email")) {
      const ev = req.body.email;
      if (ev === null || ev === undefined) {
        body.email = null;
      } else if (typeof ev === "string") {
        const trimmed = ev.trim();
        const cur = (user.email ?? "").trim().toLowerCase();
        if (!trimmed) {
          body.email = null;
        } else {
          const nextNorm = trimmed.toLowerCase();
          if (nextNorm !== cur) {
            const code = String(req.body?.emailCode ?? "").trim();
            if (!/^\d{6}$/.test(code)) {
              return res.status(400).json({
                error: "更换邮箱需填写发往新邮箱的 6 位验证码",
                code: "EMAIL_CODE_REQUIRED",
              });
            }
            await consumeProfileEmailChangeCode(req.userId, nextNorm, code);
            body.email = trimmed;
          }
        }
      }
    }
    if (Object.keys(body).length === 0) {
      return res.json(toPublicUser(user));
    }
    const u = await updateUserRecord(null, req.userId, body);
    res.json(u);
  } catch (e) {
    res.status(400).json({ error: e.message || "更新失败" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 用户管理
// ─────────────────────────────────────────────────────────────────────────────

app.get("/api/users", attachJwtSession, requireAdminSession, async (_req, res) => {
  try {
    const users = await readUsersList(null);
    res.json(users.map((u) => toPublicUser(u)));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "读取失败" });
  }
});

app.post("/api/users", attachJwtSession, requireAdminSession, async (req, res) => {
  try {
    const u = await createUserRecord(null, req.body);
    res.status(201).json(u);
  } catch (e) {
    res.status(400).json({ error: e.message || "创建失败" });
  }
});

app.patch("/api/users/:id", attachJwtSession, requireAdminSession, async (req, res) => {
  try {
    const u = await updateUserRecord(null, req.params.id, req.body);
    res.json(u);
  } catch (e) {
    res.status(400).json({ error: e.message || "更新失败" });
  }
});

app.delete("/api/users/:id", attachJwtSession, requireAdminSession, async (req, res) => {
  try {
    await deleteUserRecord(null, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message || "删除失败" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 头像上传
// ─────────────────────────────────────────────────────────────────────────────

app.post("/api/users/me/avatar/presign", attachJwtSession, requireLoggedInUser, async (req, res) => {
  try {
    const mode = getMediaUploadMode(hasPublic);
    if (!mode || !isCosConfigured()) return res.json({ direct: false });
    const contentType = typeof req.body?.contentType === "string" ? req.body.contentType : "";
    const fileSize = Number(req.body?.fileSize);
    const plan = planAvatarCosDirectUpload(req.userId, contentType, fileSize);
    const putUrl = await getCosPutPresignedUrl({ key: plan.key, contentType: plan.contentType });
    res.json({
      direct: true,
      putUrl,
      headers: {
        "Content-Type": plan.contentType,
        "Content-Disposition": "inline",
      },
      key: plan.key,
    });
  } catch (e) {
    res.status(400).json({ error: e.message || "预签名失败" });
  }
});

app.post("/api/users/me/avatar/confirm", attachJwtSession, requireLoggedInUser, async (req, res) => {
  try {
    const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
    if (!key) return res.status(400).json({ error: "缺少 key" });
    const url = await confirmAvatarCosUpload(null, req.userId, key);
    res.json({ avatarUrl: url });
  } catch (e) {
    res.status(400).json({ error: e.message || "确认失败" });
  }
});

app.post("/api/users/me/avatar", attachJwtSession, requireLoggedInUser, (req, res) => {
  const mode = getMediaUploadMode(hasPublic);
  if (!mode) {
    return res.status(503).json({ error: "未开放上传：请配置 COS 或构建生成 server/public 目录" });
  }

  let bb;
  try {
    bb = Busboy({ headers: req.headers, limits: { fileSize: 3 * 1024 * 1024, files: 1 } });
  } catch {
    return res.status(400).json({ error: "无效的请求格式" });
  }

  let limitHit = false;
  let pendingFile = null;
  let parseError = null;
  let extraFile = false;

  bb.on("file", (name, file, info) => {
    if (name !== "file") { file.resume(); return; }
    if (pendingFile !== null) { extraFile = true; file.resume(); return; }
    const mimeType = info.mimeType || info.mime || "application/octet-stream";
    const chunks = [];
    file.on("data", (d) => chunks.push(d));
    file.on("limit", () => { limitHit = true; });
    file.on("error", (err) => { parseError = err; });
    file.on("end", () => {
      if (!limitHit) pendingFile = { buffer: Buffer.concat(chunks), mimetype: mimeType };
    });
  });
  bb.on("error", (err) => { parseError = err; });
  bb.on("finish", async () => {
    if (parseError) { console.error(parseError); if (!res.headersSent) res.status(400).json({ error: "上传解析失败" }); return; }
    if (limitHit) return res.status(400).json({ error: "文件过大" });
    if (extraFile) return res.status(400).json({ error: "仅支持单次上传一个文件" });
    if (!pendingFile) return res.status(400).json({ error: "请选择文件" });
    try {
      const url = await saveAvatarFile(req.userId, pendingFile.buffer, pendingFile.mimetype, { publicDir });
      await setUserAvatarUrl(null, req.userId, url);
      res.json({ avatarUrl: url });
    } catch (e) {
      console.error(e);
      res.status(400).json({ error: e.message || "上传失败" });
    }
  });
  req.pipe(bb);
});

// ─────────────────────────────────────────────────────────────────────────────
// 合集 API（读取 + 批量导入）
// ─────────────────────────────────────────────────────────────────────────────

app.get(
  "/api/collections",
  (req, res, next) => {
    if (adminGateEnabled) return requireCollectionsReader(req, res, next);
    next();
  },
  async (req, res) => {
    try {
      const userId = adminGateEnabled ? (req.collectionsUserId ?? null) : null;
      const data = await getCollectionsTree(userId);
      res.json(data);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message || "Read failed" });
    }
  }
);

/**
 * GET /api/me/sync/events — SSE：笔记数据变更时推送，客户端防抖后拉取 GET /api/collections。
 * 浏览器 EventSource 无法带 Authorization，可配合查询参数 access_token=JWT（须 HTTPS）。
 */
app.get(
  "/api/me/sync/events",
  (req, res, next) => {
    if (adminGateEnabled) return requireCollectionsReader(req, res, next);
    next();
  },
  (req, res) => {
    const key = preferencesOwnerKey(req);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") res.flushHeaders();
    subscribeCollectionsSync(key, res);
    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
    const ping = setInterval(() => {
      try {
        if (!res.writableEnded) res.write(": ping\n\n");
      } catch {
        clearInterval(ping);
      }
    }, 25_000);
    const cleanup = () => clearInterval(ping);
    res.on("close", cleanup);
  }
);

/** PUT /api/collections：仅用于数据迁移 / 批量导入（生产日常写操作请用粒度化接口） */
app.put(
  "/api/collections",
  (req, res, next) => {
    if (adminGateEnabled) return requireCollectionsWriter(req, res, next);
    return putAuthMiddleware(req, res, next);
  },
  async (req, res) => {
    try {
      const body = req.body;
      if (!Array.isArray(body)) return res.status(400).json({ error: "Body must be a JSON array" });
      const userId = adminGateEnabled ? (req.collectionsUserId ?? null) : null;
      await replaceCollectionsTree(userId, body);
      notifyCollectionsSync(req);
      res.setHeader("X-Deprecated", "use granular card APIs");
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message || "Write failed" });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 粒度化合集操作
// ─────────────────────────────────────────────────────────────────────────────

function collectionsWriterMw(req, res, next) {
  if (adminGateEnabled) return requireCollectionsWriter(req, res, next);
  return putAuthMiddleware(req, res, next);
}

function getUserId(req) {
  return adminGateEnabled ? (req.collectionsUserId ?? null) : null;
}

/** 星标 / 垃圾桶 行级隔离键：多用户为 JWT sub；单用户库固定 __single__ */
function preferencesOwnerKey(req) {
  return adminGateEnabled ? String(req.collectionsUserId ?? "") : "__single__";
}

function notifyCollectionsSync(req) {
  broadcastCollectionsChanged(preferencesOwnerKey(req));
}

function preferencesReaderMw(req, res, next) {
  if (adminGateEnabled) return requireCollectionsReader(req, res, next);
  next();
}

function preferencesWriterMw(req, res, next) {
  if (adminGateEnabled) return requireCollectionsWriter(req, res, next);
  return putAuthMiddleware(req, res, next);
}

/** POST /api/collections — 创建合集 */
app.post("/api/collections", collectionsWriterMw, async (req, res) => {
  try {
    const { id, name, dotColor, hint, parentId, sortOrder } = req.body ?? {};
    if (!id || !name) return res.status(400).json({ error: "id 和 name 为必填项" });
    const col = await createCollection(getUserId(req), {
      id,
      name,
      dotColor,
      hint,
      parentId,
      sortOrder,
    });
    notifyCollectionsSync(req);
    res.status(201).json(col);
  } catch (e) {
    console.error(e);
    const status = e.message?.includes("already exists") ? 409 : 400;
    res.status(status).json({ error: e.message || "创建失败" });
  }
});

/** PATCH /api/collections/:id — 更新合集元数据 */
app.patch("/api/collections/:id", collectionsWriterMw, async (req, res) => {
  try {
    const col = await updateCollection(getUserId(req), req.params.id, req.body ?? {});
    notifyCollectionsSync(req);
    res.json(col);
  } catch (e) {
    console.error(e);
    const status = e.message?.includes("不存在") ? 404 : 400;
    res.status(status).json({ error: e.message || "更新失败" });
  }
});

/** DELETE /api/collections/:id — 删除合集（级联删子集和卡片） */
app.delete("/api/collections/:id", collectionsWriterMw, async (req, res) => {
  try {
    await deleteCollection(getUserId(req), req.params.id);
    notifyCollectionsSync(req);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    const status = e.message?.includes("不存在") ? 404 : 400;
    res.status(status).json({ error: e.message || "删除失败" });
  }
});

/** POST /api/collections/:collectionId/cards — 在合集末尾创建卡片 */
app.post("/api/collections/:collectionId/cards", collectionsWriterMw, async (req, res) => {
  try {
    const card = await createCard(getUserId(req), req.params.collectionId, req.body ?? {});
    notifyCollectionsSync(req);
    res.status(201).json(card);
  } catch (e) {
    console.error(e);
    const status = e.message?.includes("不存在") ? 404 : 400;
    res.status(status).json({ error: e.message || "创建失败" });
  }
});

/** PATCH /api/cards/:id — 更新单卡片任意字段 */
app.patch("/api/cards/:id", collectionsWriterMw, async (req, res) => {
  try {
    await updateCard(getUserId(req), req.params.id, req.body ?? {});
    notifyCollectionsSync(req);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    const status = e.message?.includes("不存在") ? 404 : 400;
    res.status(status).json({ error: e.message || "更新失败" });
  }
});

/** DELETE /api/cards/:id — 删除卡片 */
app.delete("/api/cards/:id", collectionsWriterMw, async (req, res) => {
  try {
    await deleteCard(getUserId(req), req.params.id);
    notifyCollectionsSync(req);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    const status = e.message?.includes("不存在") ? 404 : 400;
    res.status(status).json({ error: e.message || "删除失败" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 星标合集 + 垃圾桶（与合集树同一套鉴权）
// ─────────────────────────────────────────────────────────────────────────────

app.get("/api/me/favorites", preferencesReaderMw, async (req, res) => {
  try {
    const key = preferencesOwnerKey(req);
    if (adminGateEnabled && !key) {
      return res.status(401).json({ error: "未授权", code: "AUTH" });
    }
    const collectionIds = await listFavoriteCollectionIds(key);
    res.json({ collectionIds });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "读取失败" });
  }
});

app.put("/api/me/favorites", preferencesWriterMw, async (req, res) => {
  try {
    const raw = req.body?.collectionIds;
    if (!Array.isArray(raw)) {
      return res.status(400).json({ error: "collectionIds 须为字符串数组" });
    }
    const key = preferencesOwnerKey(req);
    if (adminGateEnabled && !key) {
      return res.status(401).json({ error: "未授权", code: "PUT_AUTH" });
    }
    const collectionIds = raw.filter((x) => typeof x === "string");
    await replaceFavoriteCollectionIds(key, collectionIds, getUserId(req));
    notifyCollectionsSync(req);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "保存失败" });
  }
});

app.get("/api/me/trash", preferencesReaderMw, async (req, res) => {
  try {
    const key = preferencesOwnerKey(req);
    if (adminGateEnabled && !key) {
      return res.status(401).json({ error: "未授权", code: "AUTH" });
    }
    const entries = await listTrashedNotes(key);
    res.json({ entries });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "读取失败" });
  }
});

app.post("/api/me/trash", preferencesWriterMw, async (req, res) => {
  try {
    const b = req.body ?? {};
    const trashId = typeof b.trashId === "string" ? b.trashId.trim() : "";
    const colId = typeof b.colId === "string" ? b.colId.trim() : "";
    const colPathLabel = typeof b.colPathLabel === "string" ? b.colPathLabel : "";
    const card = b.card;
    const deletedAt = typeof b.deletedAt === "string" ? b.deletedAt : undefined;
    if (!trashId || !colId || !card || typeof card !== "object") {
      return res.status(400).json({ error: "无效的回收站条目" });
    }
    const key = preferencesOwnerKey(req);
    if (adminGateEnabled && !key) {
      return res.status(401).json({ error: "未授权", code: "PUT_AUTH" });
    }
    await insertTrashedNote(key, {
      trashId,
      colId,
      colPathLabel,
      card,
      deletedAt,
    });
    notifyCollectionsSync(req);
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error(e);
    const dup = e.code === "23505";
    const status = dup ? 409 : 400;
    res.status(status).json({ error: e.message || "写入失败" });
  }
});

app.delete("/api/me/trash", preferencesWriterMw, async (req, res) => {
  try {
    const key = preferencesOwnerKey(req);
    if (adminGateEnabled && !key) {
      return res.status(401).json({ error: "未授权", code: "PUT_AUTH" });
    }
    await clearTrashedNotes(key);
    notifyCollectionsSync(req);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "清空失败" });
  }
});

app.delete("/api/me/trash/:trashId", preferencesWriterMw, async (req, res) => {
  try {
    const trashId = typeof req.params.trashId === "string" ? req.params.trashId.trim() : "";
    if (!trashId) return res.status(400).json({ error: "缺少 trashId" });
    const key = preferencesOwnerKey(req);
    if (adminGateEnabled && !key) {
      return res.status(401).json({ error: "未授权", code: "PUT_AUTH" });
    }
    await deleteTrashedNote(key, trashId);
    notifyCollectionsSync(req);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    const status = e.message?.includes("不存在") ? 404 : 400;
    res.status(status).json({ error: e.message || "删除失败" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 媒体上传（COS 预签名直传）
// ─────────────────────────────────────────────────────────────────────────────

const COS_READ_SIGN_EXPIRES_SEC = Math.min(
  3600,
  Math.max(
    60,
    Number(process.env.COS_READ_SIGN_EXPIRES_SEC || 900) || 900
  )
);

/**
 * GET /api/upload/cos-read?url= — 将本桶对外 URL 换为短时 GET 预签名（私有桶展示媒体）
 */
app.get("/api/upload/cos-read", (req, res, next) => {
  const s = getJwtSession(req);
  if (!s) return res.status(401).json({ error: "未授权", code: "AUTH" });
  req.jwtSession = s;
  next();
}, async (req, res) => {
  try {
    if (!isCosConfigured()) {
      return res.status(503).json({
        error: "未配置 COS",
        code: "COS_NOT_CONFIGURED",
      });
    }
    const raw = typeof req.query.url === "string" ? req.query.url.trim() : "";
    if (!raw || !/^https?:\/\//i.test(raw)) {
      return res.status(400).json({ error: "缺少有效 url" });
    }
    const key = extractObjectKeyFromCosPublicUrl(raw);
    if (!key) {
      return res.status(400).json({ error: "URL 不属于当前存储桶" });
    }
    if (!canSessionReadCosObjectKey(key, req.jwtSession)) {
      return res.status(403).json({ error: "无权访问该对象" });
    }
    const signedUrl = await getCosGetPresignedUrl(key, COS_READ_SIGN_EXPIRES_SEC);
    res.json({ url: signedUrl, expiresIn: COS_READ_SIGN_EXPIRES_SEC });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "预签名失败" });
  }
});

/** POST /api/upload/presign — 获取 COS 直传预签名 URL */
app.post(
  "/api/upload/presign",
  (req, res, next) => {
    if (adminGateEnabled) return requireUploadAuth(req, res, next);
    return putAuthMiddleware(req, res, next);
  },
  async (req, res) => {
    try {
      if (!isCosConfigured()) {
        return res.status(503).json({
          error: "未配置 COS，无法上传媒体文件；请配置 COS_SECRET_ID 等环境变量",
          code: "COS_NOT_CONFIGURED",
        });
      }
      const filename = typeof req.body?.filename === "string" ? req.body.filename : "";
      const contentType = typeof req.body?.contentType === "string" ? req.body.contentType : "application/octet-stream";
      const fileSize = Number(req.body?.fileSize);
      let maxFileBytes;
      /** 站长：不扣月额度、不按 free/subscriber 限制 */
      let skipQuotaConsume = false;
      if (adminGateEnabled && req.uploadUserId) {
        const lim = await getAttachmentLimitsForUser(req.uploadUserId);
        maxFileBytes = lim.singleFileMaxBytes;
        skipQuotaConsume = Boolean(lim.unlimited);
      }
      const plan = planMediaCosDirectUpload({
        originalname: filename,
        contentType,
        fileSize,
        userId: adminGateEnabled ? req.uploadUserId : undefined,
        maxFileBytes,
      });
      let consumed = false;
      if (adminGateEnabled && req.uploadUserId && !skipQuotaConsume) {
        await consumeAttachmentUploadQuota(req.uploadUserId, fileSize);
        consumed = true;
      }
      let putUrl;
      try {
        putUrl = await getCosPutPresignedUrl({ key: plan.key, contentType: plan.contentType });
      } catch (presignErr) {
        if (consumed && req.uploadUserId) {
          try {
            await refundAttachmentUploadQuota(req.uploadUserId, fileSize);
          } catch (re) {
            console.error("[upload/presign] refund quota failed", re);
          }
        }
        throw presignErr;
      }
      res.json({
        direct: true,
        putUrl,
        headers: {
          "Content-Type": plan.contentType,
          "Content-Disposition": "inline",
        },
        key: plan.key,
        url: buildObjectPublicUrl(plan.key),
        kind: plan.kind,
        name: plan.name,
      });
    } catch (e) {
      res.status(400).json({ error: e.message || "预签名失败" });
    }
  }
);

/** POST /api/upload/finalize-audio — 提取音频内嵌封面 */
app.post(
  "/api/upload/finalize-audio",
  (req, res, next) => {
    if (adminGateEnabled) return requireUploadAuth(req, res, next);
    return putAuthMiddleware(req, res, next);
  },
  async (req, res) => {
    try {
      if (!isCosConfigured()) return res.status(400).json({ error: "未配置 COS" });
      const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
      if (!key) return res.status(400).json({ error: "缺少 key" });
      const out = await finalizeAudioCoverAfterCosUpload(
        key,
        adminGateEnabled ? req.uploadUserId : undefined
      );
      res.json(out);
    } catch (e) {
      res.status(400).json({ error: e.message || "处理失败" });
    }
  }
);

/** POST /api/upload/finalize-video — 截取视频首屏缩略图并写入 COS */
app.post(
  "/api/upload/finalize-video",
  (req, res, next) => {
    if (adminGateEnabled) return requireUploadAuth(req, res, next);
    return putAuthMiddleware(req, res, next);
  },
  async (req, res) => {
    try {
      if (!isCosConfigured()) return res.status(400).json({ error: "未配置 COS" });
      const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
      if (!key) return res.status(400).json({ error: "缺少 key" });
      const out = await finalizeVideoThumbnailAfterCosUpload(
        key,
        adminGateEnabled ? req.uploadUserId : undefined
      );
      res.json(out);
    } catch (e) {
      res.status(400).json({ error: e.message || "处理失败" });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 静态文件服务
// ─────────────────────────────────────────────────────────────────────────────

if (hasPublic) {
  app.use(
    express.static(publicDir, {
      setHeaders(res, filePath) {
        setStaticCacheHeaders(res, filePath);
      },
    })
  );
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.setHeader("Cache-Control", "max-age=0, must-revalidate");
    res.sendFile(join(publicDir, "index.html"));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 启动
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  // 校验 DATABASE_URL（getPool() 内部会抛，提前给出友好错误）
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("❌ 缺少环境变量 DATABASE_URL，请配置 PostgreSQL 连接串后重启（本地测试见 server/.env.example 与 docker-compose.yml）");
    process.exit(1);
  }

  // 健康检查：确保数据库可达
  try {
    await pingDb();
    console.log("  db: postgres OK");
  } catch (e) {
    console.error("❌ 无法连接 PostgreSQL：", e.message);
    process.exit(1);
  }

  await ensureBootstrapAdmin(null, ADMIN_PASSWORD);
  const n = (await readUsersList(null)).length;
  adminGateEnabled = Boolean(JWT_SECRET) && n > 0;

  const server = app.listen(PORT, () => {
    console.log(`mikujar-api listening on :${PORT}`);
    console.log(`  storage: postgres`);
    console.log(`  users: ${n} user(s)`);
    const mu = getMediaUploadMode(hasPublic);
    console.log(`  media upload: ${mu ?? "off (presign only)"}`);
    if (adminGateEnabled) {
      console.log(`  auth: per-user notes (JWT); admin manages users`);
    } else if (JWT_SECRET && n === 0) {
      console.log(`  auth: JWT_SECRET set but no users — set ADMIN_PASSWORD to bootstrap`);
    } else if (API_TOKEN) {
      console.log(`  auth: PUT requires Bearer API_TOKEN`);
    } else {
      console.log(`  auth: PUT open (dev — set JWT_SECRET + ADMIN_PASSWORD for prod)`);
    }
    if (hasPublic) console.log(`  static: ${publicDir}`);
  });

  // TCP keep-alive：防止反代（nginx/CLB）60s idle 断连
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  // 优雅退出
  async function shutdown(signal) {
    console.log(`[${signal}] 开始优雅退出…`);
    server.close(async () => {
      console.log("  HTTP server closed");
      await closePool();
      console.log("  PG pool closed");
      process.exit(0);
    });
    // 超时强制退出，防止 server.close 卡死
    setTimeout(() => {
      console.error("  强制退出（超时）");
      process.exit(1);
    }, 10_000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
