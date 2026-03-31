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
  getMediaUploadMode,
  saveUploadedMedia,
  UPLOAD_MAX_BYTES,
} from "./mediaUpload.js";
import {
  readCollectionsRaw,
  storageLogHint,
  storageMode,
  writeCollectionsRaw,
} from "./storage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });
const ROOT = join(__dirname, "..");
const DATA_FILE =
  process.env.DATA_FILE || join(ROOT, "data", "collections.json");
const PORT = Number(process.env.PORT || 3001);
const API_TOKEN = process.env.API_TOKEN?.trim() || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim() || "";
const JWT_SECRET = process.env.JWT_SECRET?.trim() || "";
const adminGateEnabled = Boolean(ADMIN_PASSWORD && JWT_SECRET);
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

/** 写入接口：管理员 JWT 模式 或 静态 API_TOKEN（脚本/兼容） */
function verifyPutAuth(req) {
  if (adminGateEnabled) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return false;
    const token = auth.slice(7);
    if (API_TOKEN && token === API_TOKEN) return true;
    try {
      jwt.verify(token, JWT_SECRET);
      return true;
    } catch {
      return false;
    }
  }
  if (API_TOKEN) {
    return req.headers.authorization === `Bearer ${API_TOKEN}`;
  }
  return true;
}

function putAuthMiddleware(req, res, next) {
  if (!verifyPutAuth(req)) {
    return res.status(401).json({ error: "未授权", code: "PUT_AUTH" });
  }
  next();
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

app.post("/api/auth/login", (req, res) => {
  if (!adminGateEnabled) {
    return res
      .status(400)
      .json({ error: "未配置管理员登录（需 ADMIN_PASSWORD 与 JWT_SECRET）" });
  }
  const p =
    typeof req.body?.password === "string" ? req.body.password : "";
  if (p !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "密码错误" });
  }
  const token = jwt.sign({ role: "admin" }, JWT_SECRET, {
    expiresIn: "7d",
  });
  res.json({ token });
});

app.get("/api/auth/me", (req, res) => {
  if (!adminGateEnabled) {
    return res.json({ ok: true, admin: true });
  }
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return res.json({ ok: false, admin: false });
  }
  try {
    jwt.verify(auth.slice(7), JWT_SECRET);
    return res.json({ ok: true, admin: true });
  } catch {
    return res.json({ ok: false, admin: false });
  }
});

/** 公开读取，供观众浏览 */
app.get("/api/collections", async (_req, res) => {
  try {
    const raw = await readCollectionsRaw(DATA_FILE);
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
});

app.put("/api/collections", putAuthMiddleware, async (req, res) => {
  try {
    const body = req.body;
    if (!Array.isArray(body)) {
      return res.status(400).json({ error: "Body must be a JSON array" });
    }
    await writeCollectionsRaw(
      DATA_FILE,
      JSON.stringify(body, null, 2)
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Write failed" });
  }
});

/** 管理员：本地上传任意类型文件到 COS 或 public/uploads（multipart 字段名 file） */
app.post("/api/upload", putAuthMiddleware, (req, res) => {
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
    const filename = info.filename || "";
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

app.listen(PORT, () => {
  console.log(`mikujar-api listening on :${PORT}`);
  const cosHint = storageLogHint();
  console.log(`  data: ${cosHint ?? DATA_FILE}`);
  const mu = getMediaUploadMode(hasPublic);
  console.log(`  media upload: ${mu ?? "off"}`);
  if (adminGateEnabled) {
    console.log(`  admin: JWT login enabled (PUT requires token or API_TOKEN)`);
  } else if (API_TOKEN) {
    console.log(`  auth: PUT requires Bearer API_TOKEN`);
  } else {
    console.log(`  auth: PUT open (dev — set ADMIN_PASSWORD+JWT_SECRET for prod)`);
  }
  if (hasPublic) console.log(`  static: ${publicDir}`);
});
