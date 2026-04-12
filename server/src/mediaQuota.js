/**
 * 附件上传配额：按 users.role（user=普通 / subscriber=订阅；admin=站长不限额），自然月（Asia/Shanghai）重置。
 * 本月已上传量只增不减，删除附件不退回。
 */
import { getClient, query } from "./db.js";
import { UPLOAD_MAX_BYTES } from "./mediaUpload.js";

const GIB = 1024 * 1024 * 1024;
const MIN_MONTHLY_BYTES = 1024 * 1024; // 至少 1MB，防误填

/** 普通用户默认每月总上传：1 GiB */
const DEFAULT_USER_MONTHLY_BYTES = GIB;
/** 订阅用户默认每月总上传：10 GiB */
const DEFAULT_SUBSCRIBER_MONTHLY_BYTES = 10 * GIB;

/**
 * @param {string} bytesKey env 名：字节（优先）
 * @param {string} gbKey env 名：GiB 倍数
 * @param {number} defaultBytes 未配置时的默认值
 */
function monthlyUploadMaxBytesFromEnv(bytesKey, gbKey, defaultBytes) {
  const rawB = process.env[bytesKey];
  if (rawB != null && String(rawB).trim() !== "") {
    const n = Number(String(rawB).trim());
    if (Number.isFinite(n) && n >= MIN_MONTHLY_BYTES) {
      return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(n));
    }
  }
  const rawGb = process.env[gbKey];
  if (rawGb != null && String(rawGb).trim() !== "") {
    const g = Number(String(rawGb).trim());
    if (Number.isFinite(g) && g > 0) {
      return Math.min(
        Number.MAX_SAFE_INTEGER,
        Math.floor(g * GIB)
      );
    }
  }
  return defaultBytes;
}

function userMonthlyUploadMaxBytesFromEnv() {
  return monthlyUploadMaxBytesFromEnv(
    "USER_MEDIA_MONTHLY_MAX_BYTES",
    "USER_MEDIA_MONTHLY_MAX_GB",
    DEFAULT_USER_MONTHLY_BYTES
  );
}

function subscriberMonthlyUploadMaxBytesFromEnv() {
  return monthlyUploadMaxBytesFromEnv(
    "SUBSCRIBER_MEDIA_MONTHLY_MAX_BYTES",
    "SUBSCRIBER_MEDIA_MONTHLY_MAX_GB",
    DEFAULT_SUBSCRIBER_MONTHLY_BYTES
  );
}

/** 自然月键，与数据库 media_usage_month 一致：YYYY-MM（上海时区） */
export function currentUsageMonthKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  return `${y}-${m}`;
}

/**
 * @param {string | null | undefined} role
 * @returns {{ singleFileMaxBytes: number; monthlyUploadMaxBytes: number }}
 */
export function limitsForAttachmentRole(role) {
  const r = String(role || "").trim();
  if (r === "subscriber") {
    return {
      singleFileMaxBytes: 100 * 1024 * 1024,
      monthlyUploadMaxBytes: subscriberMonthlyUploadMaxBytesFromEnv(),
    };
  }
  /** user 或其它非 admin 默认按普通用户 */
  return {
    singleFileMaxBytes: 10 * 1024 * 1024,
    monthlyUploadMaxBytes: userMonthlyUploadMaxBytesFromEnv(),
  };
}

/**
 * @param {{ role?: string; media_usage_month?: string | null; media_uploaded_bytes_month?: string | number | null }} row
 */
export function snapshotMediaQuota(row) {
  const role = String(row?.role || "").trim();
  if (role === "admin") {
    const monthKey = currentUsageMonthKey();
    return {
      usageMonth: monthKey,
      uploadedBytesMonth: 0,
      monthlyLimitBytes: 0,
      singleFileMaxBytes: UPLOAD_MAX_BYTES,
      quotaUnlimited: true,
    };
  }
  const monthKey = currentUsageMonthKey();
  const limits = limitsForAttachmentRole(role);
  const storedMonth = String(row?.media_usage_month || "").trim();
  let used = Number(row?.media_uploaded_bytes_month) || 0;
  if (storedMonth !== monthKey) used = 0;
  return {
    usageMonth: monthKey,
    uploadedBytesMonth: used,
    monthlyLimitBytes: limits.monthlyUploadMaxBytes,
    singleFileMaxBytes: limits.singleFileMaxBytes,
    quotaUnlimited: false,
  };
}

/**
 * @returns {{ unlimited: boolean; singleFileMaxBytes: number; monthlyUploadMaxBytes?: number }}
 */
export async function getAttachmentLimitsForUser(userId) {
  const uid = String(userId || "").trim();
  if (!uid) throw new Error("缺少用户");
  const res = await query("SELECT role FROM users WHERE id = $1", [uid]);
  if (res.rowCount === 0) throw new Error("用户不存在");
  const row = res.rows[0];
  if (String(row.role || "").trim() === "admin") {
    return { unlimited: true, singleFileMaxBytes: UPLOAD_MAX_BYTES };
  }
  const lim = limitsForAttachmentRole(row.role);
  return {
    unlimited: false,
    singleFileMaxBytes: lim.singleFileMaxBytes,
    monthlyUploadMaxBytes: lim.monthlyUploadMaxBytes,
  };
}

/**
 * COS 预签名失败时退回本次扣减（同月内；极少跨月失败则尽力扣减）。
 * @param {string} userId
 * @param {number} fileSize
 */
export async function refundAttachmentUploadQuota(userId, fileSize) {
  const uid = String(userId || "").trim();
  if (!uid) return;
  const size = Math.floor(Number(fileSize));
  if (!Number.isFinite(size) || size < 1) return;

  const monthKey = currentUsageMonthKey();
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT media_usage_month, media_uploaded_bytes_month FROM users WHERE id = $1 FOR UPDATE`,
      [uid]
    );
    if (r.rowCount === 0) {
      await client.query("ROLLBACK");
      return;
    }
    const row = r.rows[0];
    let used = Number(row.media_uploaded_bytes_month) || 0;
    const m = String(row.media_usage_month || "").trim();
    if (m !== monthKey) {
      await client.query("ROLLBACK");
      return;
    }
    const next = Math.max(0, used - size);
    await client.query(
      `UPDATE users SET media_uploaded_bytes_month = $2 WHERE id = $1`,
      [uid, next]
    );
    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

export async function consumeAttachmentUploadQuota(userId, fileSize) {
  const uid = String(userId || "").trim();
  if (!uid) throw new Error("缺少用户");

  const size = Math.floor(Number(fileSize));
  if (!Number.isFinite(size) || size < 1) {
    throw new Error("无效的文件大小");
  }

  const pre = await query(
    "SELECT role, media_usage_month, media_uploaded_bytes_month FROM users WHERE id = $1",
    [uid]
  );
  if (pre.rowCount === 0) throw new Error("用户不存在");
  if (String(pre.rows[0].role || "").trim() === "admin") {
    if (size > UPLOAD_MAX_BYTES) {
      throw new Error(
        `单文件不超过 ${Math.round(UPLOAD_MAX_BYTES / (1024 * 1024))}MB`
      );
    }
    return {
      usageMonth: currentUsageMonthKey(),
      uploadedBytesMonth: 0,
      monthlyLimitBytes: 0,
      singleFileMaxBytes: UPLOAD_MAX_BYTES,
      unlimited: true,
    };
  }

  const monthKey = currentUsageMonthKey();
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT id, role, media_usage_month, media_uploaded_bytes_month
       FROM users WHERE id = $1 FOR UPDATE`,
      [uid]
    );
    if (r.rowCount === 0) throw new Error("用户不存在");
    const row = r.rows[0];
    const limits = limitsForAttachmentRole(row.role);

    const cap = Math.min(limits.singleFileMaxBytes, UPLOAD_MAX_BYTES);
    if (size > cap) {
      throw new Error(
        `单文件不超过 ${Math.round(cap / (1024 * 1024))}MB`
      );
    }

    let used = Number(row.media_uploaded_bytes_month) || 0;
    let m = String(row.media_usage_month || "").trim();
    if (m !== monthKey) {
      used = 0;
      m = monthKey;
    }
    if (used + size > limits.monthlyUploadMaxBytes) {
      throw new Error(
        "本月附件上传额度已用完，下月 1 日起重置（删除已传文件不会退回额度）"
      );
    }
    const next = used + size;
    await client.query(
      `UPDATE users SET media_usage_month = $2, media_uploaded_bytes_month = $3 WHERE id = $1`,
      [uid, monthKey, next]
    );
    await client.query("COMMIT");
    return {
      usageMonth: monthKey,
      uploadedBytesMonth: next,
      monthlyLimitBytes: limits.monthlyUploadMaxBytes,
      singleFileMaxBytes: limits.singleFileMaxBytes,
    };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}
