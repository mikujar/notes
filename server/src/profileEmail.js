/**
 * 登录用户在个人中心绑定/更换邮箱：发码、验码（数据表 email_change_codes）。
 */
import { randomInt } from "crypto";
import bcrypt from "bcryptjs";
import { query } from "./db.js";
import {
  isSmtpConfigured,
  sendProfileEmailChangeCodeEmail,
} from "./mail.js";
import { normalizeRegistrationEmail } from "./registration.js";

const CODE_TTL_MS = 10 * 60 * 1000;
const SEND_WINDOW_MS = 60 * 60 * 1000;

/** @type {Map<string, { count: number; since: number }>} */
const sendRate = new Map();

function allowRate(key, max) {
  const now = Date.now();
  let rec = sendRate.get(key);
  if (!rec || now - rec.since > SEND_WINDOW_MS) {
    rec = { count: 0, since: now };
    sendRate.set(key, rec);
  }
  if (rec.count >= max) return false;
  rec.count += 1;
  return true;
}

/**
 * 向新邮箱发 6 位验证码，并与 user_id 绑定（更换邮箱前校验）。
 * @param {string} userId
 * @param {string} emailRaw
 * @param {string} ip
 */
export async function sendProfileEmailChangeCode(userId, emailRaw, ip) {
  const emailNorm = normalizeRegistrationEmail(emailRaw);
  if (!emailNorm) throw new Error("请输入有效邮箱");

  const me = await query(
    "SELECT email FROM users WHERE id = $1",
    [userId]
  );
  if (me.rowCount === 0) throw new Error("用户不存在");
  const cur = String(me.rows[0].email ?? "")
    .trim()
    .toLowerCase();
  if (cur === emailNorm) throw new Error("新邮箱与当前已绑定的一致");

  const dup = await query(
    "SELECT id FROM users WHERE email IS NOT NULL AND LOWER(email) = $1 AND id <> $2",
    [emailNorm, userId]
  );
  if (dup.rowCount > 0) throw new Error("该邮箱已被其他账号使用");

  if (!allowRate(`profmail:ip:${ip}`, 12)) {
    throw new Error("发送过于频繁，请约 1 小时后再试");
  }
  if (!allowRate(`profmail:uid:${userId}`, 8)) {
    throw new Error("发送过于频繁，请约 1 小时后再试");
  }
  if (!allowRate(`profmail:em:${emailNorm}`, 5)) {
    throw new Error("该邮箱验证邮件发送过多，请约 1 小时后再试");
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const codeHash = await bcrypt.hash(code, 8);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await query(
    `INSERT INTO email_change_codes (user_id, email, code_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET
       email = EXCLUDED.email,
       code_hash = EXCLUDED.code_hash,
       expires_at = EXCLUDED.expires_at,
       created_at = now()`,
    [userId, emailNorm, codeHash, expiresAt]
  );

  if (isSmtpConfigured()) {
    await sendProfileEmailChangeCodeEmail(emailNorm, code);
  } else if (process.env.NODE_ENV !== "production") {
    console.info(
      `[profile-email] 换绑验证码（未配置 SMTP，仅开发打印） uid=${userId} ${emailNorm}: ${code}`
    );
  } else {
    throw new Error(
      "服务器未配置邮件（SMTP_HOST 等），无法发送验证码，请联系管理员"
    );
  }

  return { ok: true };
}

/**
 * 校验换绑验证码；成功则删除待验记录（随后由 updateUserRecord 写 users.email）。
 * @param {string} userId
 * @param {string} emailNorm lowercase normalized
 * @param {string} code 6 位数字
 */
export async function consumeProfileEmailChangeCode(userId, emailNorm, code) {
  if (!/^\d{6}$/.test(String(code || "").trim())) {
    throw new Error("验证码为 6 位数字");
  }

  const res = await query(
    "SELECT email, code_hash, expires_at FROM email_change_codes WHERE user_id = $1",
    [userId]
  );
  const row = res.rows[0];
  if (!row) throw new Error("请先获取邮箱验证码");

  if (String(row.email).toLowerCase() !== emailNorm) {
    throw new Error("验证码与当前填写的新邮箱不一致，请重新获取验证码");
  }

  if (new Date(row.expires_at) < new Date()) {
    await query("DELETE FROM email_change_codes WHERE user_id = $1", [userId]);
    throw new Error("验证码已过期，请重新获取");
  }

  const match = await bcrypt.compare(String(code).trim(), row.code_hash);
  if (!match) throw new Error("验证码不正确");

  await query("DELETE FROM email_change_codes WHERE user_id = $1", [userId]);
}
