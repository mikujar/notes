/**
 * 「问 AI」/note-assist：按 users.role 限制每月调用次数（自然月 Asia/Shanghai，与附件额度一致）。
 * admin 不计次；user / subscriber 分档，额度由环境变量配置。
 */
import { getClient } from "./db.js";
import { currentUsageMonthKey } from "./mediaQuota.js";

function parsePositiveInt(raw, defaultVal) {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(n) || n < 0) return defaultVal;
  return n;
}

/** 普通用户：每月最多多少次 note-assist 请求（每次延伸/快捷/对话各计 1 次） */
function userMonthlyMaxFromEnv() {
  return parsePositiveInt(process.env.AI_USER_NOTE_ASSIST_MONTHLY, 50);
}

/** 订阅用户：每月最多次数 */
function subscriberMonthlyMaxFromEnv() {
  return parsePositiveInt(process.env.AI_SUBSCRIBER_NOTE_ASSIST_MONTHLY, 800);
}

function monthlyLimitForRole(role) {
  const r = String(role || "").trim();
  if (r === "subscriber") return subscriberMonthlyMaxFromEnv();
  if (r === "user" || r === "") return userMonthlyMaxFromEnv();
  return userMonthlyMaxFromEnv();
}

/**
 * 在调用 Gemini 之前扣减一次额度；失败则抛错（调用方返回 429）。
 * @returns {{ unlimited: boolean; usageMonth: string; usedThisMonth: number; monthlyLimit: number }}
 */
export async function consumeAiNoteAssistQuota(userId) {
  const uid = String(userId || "").trim();
  if (!uid) {
    const e = new Error("缺少用户");
    e.code = "AI_QUOTA";
    throw e;
  }

  const monthKey = currentUsageMonthKey();
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT id, role, ai_usage_month, ai_note_assist_calls_month
       FROM users WHERE id = $1 FOR UPDATE`,
      [uid]
    );
    if (r.rowCount === 0) {
      await client.query("ROLLBACK");
      const e = new Error("用户不存在");
      e.code = "AI_QUOTA";
      throw e;
    }
    const row = r.rows[0];
    const role = String(row.role || "").trim();

    if (role === "admin") {
      await client.query("COMMIT");
      return {
        unlimited: true,
        usageMonth: monthKey,
        usedThisMonth: 0,
        monthlyLimit: 0,
      };
    }

    const limit = monthlyLimitForRole(role);
    let used = Number(row.ai_note_assist_calls_month) || 0;
    let m = String(row.ai_usage_month || "").trim();
    if (m !== monthKey) {
      used = 0;
      m = monthKey;
    }

    if (limit <= 0) {
      await client.query("ROLLBACK");
      const e = new Error("当前账号未开放「问 AI」次数，请联系管理员。");
      e.code = "AI_QUOTA_EXCEEDED";
      e.aiQuota = {
        usageMonth: monthKey,
        usedThisMonth: used,
        monthlyLimit: 0,
        role,
      };
      throw e;
    }

    if (used >= limit) {
      await client.query("ROLLBACK");
      const e = new Error(
        role === "subscriber"
          ? "本月「问 AI」次数已达订阅额度，下月 1 日起重置。"
          : "本月「问 AI」次数已用完，升级订阅可获得更高额度；下月 1 日起重置。"
      );
      e.code = "AI_QUOTA_EXCEEDED";
      e.aiQuota = {
        usageMonth: monthKey,
        usedThisMonth: used,
        monthlyLimit: limit,
        role,
      };
      throw e;
    }

    const next = used + 1;
    await client.query(
      `UPDATE users SET ai_usage_month = $2, ai_note_assist_calls_month = $3 WHERE id = $1`,
      [uid, monthKey, next]
    );
    await client.query("COMMIT");
    return {
      unlimited: false,
      usageMonth: monthKey,
      usedThisMonth: next,
      monthlyLimit: limit,
    };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    if (e?.code === "AI_QUOTA_EXCEEDED") throw e;
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Gemini 调用失败时退回本次预扣（同月内减 1，不低于 0）。
 */
export async function refundAiNoteAssistQuota(userId) {
  const uid = String(userId || "").trim();
  if (!uid) return;

  const monthKey = currentUsageMonthKey();
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT role, ai_usage_month, ai_note_assist_calls_month
       FROM users WHERE id = $1 FOR UPDATE`,
      [uid]
    );
    if (r.rowCount === 0) {
      await client.query("ROLLBACK");
      return;
    }
    const row = r.rows[0];
    if (String(row.role || "").trim() === "admin") {
      await client.query("ROLLBACK");
      return;
    }
    let used = Number(row.ai_note_assist_calls_month) || 0;
    const m = String(row.ai_usage_month || "").trim();
    if (m !== monthKey) {
      await client.query("ROLLBACK");
      return;
    }
    const next = Math.max(0, used - 1);
    await client.query(
      `UPDATE users SET ai_note_assist_calls_month = $2 WHERE id = $1`,
      [uid, next]
    );
    await client.query("COMMIT");
  } catch {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
  } finally {
    client.release();
  }
}
