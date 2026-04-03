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
  getMediaUploadMode,
  planMediaCosDirectUpload,
  saveUploadedMedia,
  UPLOAD_MAX_BYTES,
} from "./mediaUpload.js";
import {
  buildObjectPublicUrl,
  getCosPutPresignedUrl,
  isCosConfigured,
  readCollectionsForUser,
  readCollectionsRaw,
  storageLogHint,
  storageMode,
  writeCollectionsForUser,
  writeCollectionsRaw,
} from "./storage.js";
import {
  confirmAvatarCosUpload,
  createUserRecord,
  deleteUserRecord,
  BOOTSTRAP_ADMIN_USERNAME,
  ensureBootstrapAdmin,
  planAvatarCosDirectUpload,
  readUsersList,
  saveAvatarFile,
  setUserAvatarUrl,
  toPublicUser,
  updateUserRecord,
  usersFilePath,
  verifyLogin,
} from "./users.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });
const ROOT = join(__dirname, "..");
/** 未启用多用户登录时的单文件笔记（本地 / COS 旧键） */
const DATA_FILE =
  process.env.DATA_FILE || join(ROOT, "data", "collections.json");
/** 启用 JWT 多用户后，每用户一份：`{userId}.json` */
const COLLECTIONS_DIR =
  process.env.COLLECTIONS_DATA_DIR?.trim() ||
  join(ROOT, "data", "collections");
const USERS_FILE = usersFilePath(ROOT);
const PORT = Number(process.env.PORT || 3002);
const API_TOKEN = process.env.API_TOKEN?.trim() || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim() || "";
const JWT_SECRET = process.env.JWT_SECRET?.trim() || "";
/** 有 JWT_SECRET 且存在至少一名用户（可由 ADMIN_PASSWORD 首次启动时自动创建） */
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

const hasPublic = await fileExists(publicDir);

const app = express();
app.use(express.json({ limit: "15mb" }));

const corsOrigin = process.env.CORS_ORIGIN;
app.use(
  cors({
    origin: corsOrigin ? corsOrigin.split(",").map((s) => s.trim()) : true,
  })
);

/**
 * 未启用多用户时：写入笔记 / 附件 — API_TOKEN 若配置则要求匹配，否则开放。
 * 启用多用户时：仅用于未走「按用户」鉴权的老路径（本函数仍供 putAuthMiddleware 使用）。
 */
function verifyAdminWrite(req) {
  if (!adminGateEnabled) {
    if (API_TOKEN) {
      return req.headers.authorization === `Bearer ${API_TOKEN}`;
    }
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

function getJwtSession(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  if (API_TOKEN && token === API_TOKEN) {
    return { sub: null, role: "admin", apiToken: true };
  }
  if (!JWT_SECRET) return null;
  try {
    const p = jwt.verify(token, JWT_SECRET);
    return {
      sub: p.sub,
      role: p.role,
      apiToken: false,
    };
  } catch {
    return null;
  }
}

function attachJwtSession(req, res, next) {
  const s = getJwtSession(req);
  if (!s) {
    return res.status(401).json({ error: "未授权", code: "AUTH" });
  }
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
  if (!s.sub || s.apiToken) {
    return res.status(401).json({ error: "请先登录用户账号" });
  }
  req.userId = s.sub;
  next();
}

/** 多用户：读取自己的笔记 JSON；脚本令牌须带 ?userId= */
function requireCollectionsReader(req, res, next) {
  const s = getJwtSession(req);
  if (!s) {
    return res.status(401).json({ error: "请登录后查看笔记", code: "AUTH" });
  }
  if (s.apiToken) {
    const uid =
      typeof req.query.userId === "string" ? req.query.userId.trim() : "";
    if (!uid) {
      return res.status(400).json({
        error: "使用 API 令牌时请在查询参数中指定 userId",
        code: "USER_ID_REQUIRED",
      });
    }
    req.collectionsUserId = uid;
    return next();
  }
  if (!s.sub) {
    return res.status(401).json({ error: "请登录后查看笔记", code: "AUTH" });
  }
  req.collectionsUserId = s.sub;
  next();
}

/** 多用户：任意登录用户可保存自己的数据；脚本令牌须带 ?userId= */
function requireCollectionsWriter(req, res, next) {
  const s = getJwtSession(req);
  if (!s) {
    return res.status(401).json({ error: "未授权", code: "PUT_AUTH" });
  }
  if (s.apiToken) {
    const uid =
      typeof req.query.userId === "string" ? req.query.userId.trim() : "";
    if (!uid) {
      return res.status(400).json({
        error: "使用 API 令牌时请在查询参数中指定 userId",
        code: "USER_ID_REQUIRED",
      });
    }
    req.collectionsUserId = uid;
    return next();
  }
  if (!s.sub) {
    return res.status(401).json({ error: "未授权", code: "PUT_AUTH" });
  }
  req.collectionsUserId = s.sub;
  next();
}

/** 多用户：附件上传到该用户专属子目录 */
function requireUploadAuth(req, res, next) {
  const s = getJwtSession(req);
  if (!s) {
    return res.status(401).json({ error: "未授权", code: "UPLOAD_AUTH" });
  }
  if (s.apiToken) {
    const uid =
      typeof req.query.userId === "string" ? req.query.userId.trim() : "";
    if (!uid) {
      return res.status(400).json({
        error: "使用 API 令牌上传时请指定查询参数 userId",
        code: "USER_ID_REQUIRED",
      });
    }
    req.uploadUserId = uid;
    return next();
  }
  if (!s.sub) {
    return res.status(401).json({ error: "未授权", code: "UPLOAD_AUTH" });
  }
  req.uploadUserId = s.sub;
  next();
}

/**
 * multipart 文件名常为 UTF-8 字节被误读成 Latin-1，导致中文等乱码。
 * 若已含 U+0100 以上字符，视为解析器已按 Unicode 解码，不再转换。
 * 否则按 Latin-1 还原字节再以 UTF-8 解码；若解码出现 U+FFFD 则保留原串。
 */
function normalizeMultipartFilename(name) {
  if (typeof name !== "string" || !name) return name;
  if ([...name].some((ch) => (ch.codePointAt(0) ?? 0) > 0xff)) return name;
  const recovered = Buffer.from(name, "latin1").toString("utf8");
  if (recovered.includes("\uFFFD")) return name;
  return recovered;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "mikujar-api",
    storage: storageMode(),
    mediaUpload: getMediaUploadMode(hasPublic),
  });
});

app.get("/api/auth/status", (_req, res) => {
  res.json({ writeRequiresLogin: adminGateEnabled });
});

app.post("/api/auth/login", async (req, res) => {
  if (!adminGateEnabled) {
    return res.status(400).json({
      error:
        `未启用登录：请配置 JWT_SECRET，并设置 ADMIN_PASSWORD 完成首次启动（将自动创建用户名为 ${BOOTSTRAP_ADMIN_USERNAME} 的管理员）或手动维护 data/users.json`,
    });
  }
  const username =
    typeof req.body?.username === "string"
      ? req.body.username.trim()
      : "";
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";
  if (!username || !password) {
    return res.status(400).json({ error: "请输入用户名与密码" });
  }
  try {
    const user = await verifyLogin(USERS_FILE, username, password);
    if (!user) {
      return res.status(401).json({ error: "用户名或密码错误" });
    }
    const token = jwt.sign(
      { sub: user.id, role: user.role, u: user.username },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({ token, user: toPublicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "登录失败" });
  }
});

app.get("/api/auth/me", async (req, res) => {
  if (!adminGateEnabled) {
    return res.json({ ok: true, admin: true, user: null });
  }
  const s = getJwtSession(req);
  if (!s) {
    return res.json({ ok: false, admin: false, user: null });
  }
  if (s.apiToken) {
    return res.json({ ok: true, admin: true, user: null });
  }
  try {
    const users = await readUsersList(USERS_FILE);
    const user = users.find((x) => x.id === s.sub);
    if (!user) {
      return res.json({ ok: false, admin: false, user: null });
    }
    return res.json({
      ok: true,
      admin: user.role === "admin",
      user: toPublicUser(user),
    });
  } catch (e) {
    console.error(e);
    return res.json({ ok: false, admin: false, user: null });
  }
});

app.get(
  "/api/users",
  attachJwtSession,
  requireAdminSession,
  async (_req, res) => {
    try {
      const users = await readUsersList(USERS_FILE);
      res.json(users.map((u) => toPublicUser(u)));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message || "读取失败" });
    }
  }
);

app.post(
  "/api/users",
  attachJwtSession,
  requireAdminSession,
  async (req, res) => {
    try {
      const u = await createUserRecord(USERS_FILE, req.body);
      res.status(201).json(u);
    } catch (e) {
      res.status(400).json({ error: e.message || "创建失败" });
    }
  }
);

app.patch(
  "/api/users/:id",
  attachJwtSession,
  requireAdminSession,
  async (req, res) => {
    try {
      const u = await updateUserRecord(USERS_FILE, req.params.id, req.body);
      res.json(u);
    } catch (e) {
      res.status(400).json({ error: e.message || "更新失败" });
    }
  }
);

app.delete(
  "/api/users/:id",
  attachJwtSession,
  requireAdminSession,
  async (req, res) => {
    try {
      await deleteUserRecord(USERS_FILE, req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message || "删除失败" });
    }
  }
);

/** 浏览器直传 COS：需在桶 CORS 中允许 PUT、暴露 ETag，并允许 Content-Type、x-cos-acl 等请求头 */
app.post(
  "/api/users/me/avatar/presign",
  attachJwtSession,
  requireLoggedInUser,
  async (req, res) => {
    try {
      const mode = getMediaUploadMode(hasPublic);
      if (!mode || !isCosConfigured()) {
        return res.json({ direct: false });
      }
      const contentType =
        typeof req.body?.contentType === "string"
          ? req.body.contentType
          : "";
      const fileSize = Number(req.body?.fileSize);
      const plan = planAvatarCosDirectUpload(
        req.userId,
        contentType,
        fileSize
      );
      const putUrl = await getCosPutPresignedUrl({
        key: plan.key,
        contentType: plan.contentType,
      });
      res.json({
        direct: true,
        putUrl,
        headers: {
          "Content-Type": plan.contentType,
          "x-cos-acl": "public-read",
        },
        key: plan.key,
      });
    } catch (e) {
      res.status(400).json({ error: e.message || "预签名失败" });
    }
  }
);

app.post(
  "/api/users/me/avatar/confirm",
  attachJwtSession,
  requireLoggedInUser,
  async (req, res) => {
    try {
      const key =
        typeof req.body?.key === "string" ? req.body.key.trim() : "";
      if (!key) {
        return res.status(400).json({ error: "缺少 key" });
      }
      const url = await confirmAvatarCosUpload(USERS_FILE, req.userId, key);
      res.json({ avatarUrl: url });
    } catch (e) {
      res.status(400).json({ error: e.message || "确认失败" });
    }
  }
);

app.post(
  "/api/users/me/avatar",
  attachJwtSession,
  requireLoggedInUser,
  (req, res) => {
    const mode = getMediaUploadMode(hasPublic);
    if (!mode) {
      return res.status(503).json({
        error: "未开放上传：请配置 COS 或构建生成 server/public 目录",
      });
    }

    let bb;
    try {
      bb = Busboy({
        headers: req.headers,
        limits: { fileSize: 3 * 1024 * 1024, files: 1 },
      });
    } catch {
      return res.status(400).json({ error: "无效的请求格式" });
    }

    let limitHit = false;
    let pendingFile = null;
    let parseError = null;
    let extraFile = false;

    bb.on("file", (name, file, info) => {
      if (name !== "file") {
        file.resume();
        return;
      }
      if (pendingFile !== null) {
        extraFile = true;
        file.resume();
        return;
      }
      const mimeType =
        info.mimeType || info.mime || "application/octet-stream";
      const chunks = [];
      file.on("data", (d) => chunks.push(d));
      file.on("limit", () => {
        limitHit = true;
      });
      file.on("error", (err) => {
        parseError = err;
      });
      file.on("end", () => {
        if (!limitHit) {
          pendingFile = {
            buffer: Buffer.concat(chunks),
            mimetype: mimeType,
          };
        }
      });
    });

    bb.on("error", (err) => {
      parseError = err;
    });

    bb.on("finish", async () => {
      if (parseError) {
        console.error(parseError);
        if (!res.headersSent) {
          res.status(400).json({ error: "上传解析失败" });
        }
        return;
      }
      if (limitHit) {
        return res.status(400).json({ error: "文件过大" });
      }
      if (extraFile) {
        return res.status(400).json({ error: "仅支持单次上传一个文件" });
      }
      if (!pendingFile) {
        return res.status(400).json({ error: "请选择文件" });
      }
      try {
        const url = await saveAvatarFile(
          req.userId,
          pendingFile.buffer,
          pendingFile.mimetype,
          { publicDir }
        );
        await setUserAvatarUrl(USERS_FILE, req.userId, url);
        res.json({ avatarUrl: url });
      } catch (e) {
        console.error(e);
        res.status(400).json({ error: e.message || "上传失败" });
      }
    });

    req.pipe(bb);
  }
);

app.get(
  "/api/collections",
  (req, res, next) => {
    if (adminGateEnabled) return requireCollectionsReader(req, res, next);
    next();
  },
  async (req, res) => {
    try {
      if (!adminGateEnabled) {
        const raw = await readCollectionsRaw(DATA_FILE);
        if (raw === null) {
          return res.json([]);
        }
        const data = JSON.parse(raw);
        if (!Array.isArray(data)) {
          return res.status(500).json({ error: "Invalid data shape" });
        }
        return res.json(data);
      }
      const raw = await readCollectionsForUser(
        req.collectionsUserId,
        COLLECTIONS_DIR
      );
      if (raw === null) {
        return res.json([]);
      }
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) {
        return res.status(500).json({ error: "Invalid data shape" });
      }
      res.json(data);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message || "Read failed" });
    }
  }
);

app.put(
  "/api/collections",
  (req, res, next) => {
    if (adminGateEnabled) return requireCollectionsWriter(req, res, next);
    return putAuthMiddleware(req, res, next);
  },
  async (req, res) => {
    try {
      const body = req.body;
      if (!Array.isArray(body)) {
        return res.status(400).json({ error: "Body must be a JSON array" });
      }
      if (adminGateEnabled) {
        await writeCollectionsForUser(
          req.collectionsUserId,
          COLLECTIONS_DIR,
          JSON.stringify(body, null, 2)
        );
      } else {
        await writeCollectionsRaw(
          DATA_FILE,
          JSON.stringify(body, null, 2)
        );
      }
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message || "Write failed" });
    }
  }
);

app.post(
  "/api/upload/presign",
  (req, res, next) => {
    if (adminGateEnabled) return requireUploadAuth(req, res, next);
    return putAuthMiddleware(req, res, next);
  },
  async (req, res) => {
    try {
      const mode = getMediaUploadMode(hasPublic);
      if (!mode || !isCosConfigured()) {
        return res.json({ direct: false });
      }
      const filename =
        typeof req.body?.filename === "string" ? req.body.filename : "";
      const contentType =
        typeof req.body?.contentType === "string"
          ? req.body.contentType
          : "application/octet-stream";
      const fileSize = Number(req.body?.fileSize);
      const plan = planMediaCosDirectUpload({
        originalname: filename,
        contentType,
        fileSize,
        userId: adminGateEnabled ? req.uploadUserId : undefined,
      });
      const putUrl = await getCosPutPresignedUrl({
        key: plan.key,
        contentType: plan.contentType,
      });
      res.json({
        direct: true,
        putUrl,
        headers: {
          "Content-Type": plan.contentType,
          "x-cos-acl": "public-read",
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

app.post(
  "/api/upload/finalize-audio",
  (req, res, next) => {
    if (adminGateEnabled) return requireUploadAuth(req, res, next);
    return putAuthMiddleware(req, res, next);
  },
  async (req, res) => {
    try {
      if (!isCosConfigured()) {
        return res.status(400).json({ error: "未配置 COS" });
      }
      const key =
        typeof req.body?.key === "string" ? req.body.key.trim() : "";
      if (!key) {
        return res.status(400).json({ error: "缺少 key" });
      }
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

/** 本地上传任意类型文件到 COS 或 public/uploads/{userId}/（多用户下按登录用户分目录） */
app.post(
  "/api/upload",
  (req, res, next) => {
    if (adminGateEnabled) return requireUploadAuth(req, res, next);
    return putAuthMiddleware(req, res, next);
  },
  (req, res) => {
  const mode = getMediaUploadMode(hasPublic);
  if (!mode) {
    return res.status(503).json({
      error:
        "未开放本地上传：请配置腾讯云 COS，或先执行构建使存在 server/public 目录",
    });
  }

  let bb;
  try {
    bb = Busboy({
      headers: req.headers,
      limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 },
    });
  } catch {
    return res.status(400).json({ error: "无效的请求格式" });
  }

  let limitHit = false;
  let pendingFile = null;
  let parseError = null;
  let extraFile = false;

  bb.on("file", (name, file, info) => {
    if (name !== "file") {
      file.resume();
      return;
    }
    if (pendingFile !== null) {
      extraFile = true;
      file.resume();
      return;
    }
    const mimeType =
      info.mimeType ||
      info.mime ||
      "application/octet-stream";
    const filename = normalizeMultipartFilename(info.filename || "");
    const chunks = [];
    file.on("data", (d) => chunks.push(d));
    file.on("limit", () => {
      limitHit = true;
    });
    file.on("error", (err) => {
      parseError = err;
    });
    file.on("end", () => {
      if (!limitHit) {
        pendingFile = {
          buffer: Buffer.concat(chunks),
          mimetype: mimeType,
          originalname: filename,
        };
      }
    });
  });

  bb.on("error", (err) => {
    parseError = err;
  });

  bb.on("finish", async () => {
    if (parseError) {
      console.error(parseError);
      if (!res.headersSent) {
        res.status(400).json({ error: "上传解析失败" });
      }
      return;
    }
    if (limitHit) {
      return res.status(400).json({ error: "文件过大" });
    }
    if (extraFile) {
      return res.status(400).json({ error: "仅支持单次上传一个文件" });
    }
    if (!pendingFile) {
      return res.status(400).json({ error: "请选择文件" });
    }
    try {
      const out = await saveUploadedMedia(pendingFile, {
        publicUploadsDir: join(publicDir, "uploads"),
        userId: adminGateEnabled ? req.uploadUserId : undefined,
      });
      res.json(out);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message || "上传失败" });
    }
  });

  req.pipe(bb);
});

if (hasPublic) {
  app.use(express.static(publicDir));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.sendFile(join(publicDir, "index.html"));
  });
}

async function main() {
  await ensureBootstrapAdmin(USERS_FILE, ADMIN_PASSWORD);
  const n = (await readUsersList(USERS_FILE)).length;
  adminGateEnabled = Boolean(JWT_SECRET) && n > 0;

  app.listen(PORT, () => {
    console.log(`mikujar-api listening on :${PORT}`);
    const cosHint = storageLogHint();
    console.log(`  data: ${cosHint ?? DATA_FILE}`);
    console.log(`  users: ${USERS_FILE} (${n} user(s))`);
    const mu = getMediaUploadMode(hasPublic);
    console.log(`  media upload: ${mu ?? "off"}`);
    if (adminGateEnabled) {
      console.log(
        `  auth: per-user notes under ${COLLECTIONS_DIR} (+ COS prefix from COS_COLLECTIONS_PREFIX); admin manages users; API_TOKEN needs ?userId= for scripts`
      );
    } else if (JWT_SECRET && n === 0) {
      console.log(
        `  auth: JWT_SECRET set but no users — set ADMIN_PASSWORD once to bootstrap (${BOOTSTRAP_ADMIN_USERNAME}), or add users.json`
      );
    } else if (API_TOKEN) {
      console.log(`  auth: PUT requires Bearer API_TOKEN`);
    } else {
      console.log(`  auth: PUT open (dev — set JWT_SECRET + ADMIN_PASSWORD for prod)`);
    }
    if (hasPublic) console.log(`  static: ${publicDir}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
