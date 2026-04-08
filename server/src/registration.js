/**
 * 邮箱 + 6 位验证码注册；验证码存 PostgreSQL，SMTP 发信（见 mail.js）。
 */
import { randomInt } from "crypto";
import bcrypt from "bcryptjs";
import { query } from "./db.js";
import { createUserWithEmail } from "./users.js";
import { isSmtpConfigured, sendRegistrationCodeEmail } from "./mail.js";

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

export function normalizeRegistrationEmail(s) {
  const t = String(s || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return "";
  return t;
}

/**
 * 生成并发送验证码（或开发环境打日志）。
 * @param {string} emailRaw
 * @param {string} ip
 */
export async function sendRegistrationCode(emailRaw, ip) {
  const emailNorm = normalizeRegistrationEmail(emailRaw);
  if (!emailNorm) throw new Error("请输入有效邮箱");

  const dup = await query(
    "SELECT id FROM users WHERE email IS NOT NULL AND LOWER(email) = $1",
    [emailNorm]
  );
  if (dup.rowCount > 0) throw new Error("该邮箱已注册，请直接登录");

  if (!allowRate(`sendcode:ip:${ip}`, 12)) {
    throw new Error("发送过于频繁，请约 1 小时后再试");
  }
  if (!allowRate(`sendcode:em:${emailNorm}`, 5)) {
    throw new Error("该邮箱验证邮件发送过多，请约 1 小时后再试");
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const codeHash = await bcrypt.hash(code, 8);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await query(
    `INSERT INTO email_registration_codes (email, code_hash, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET
       code_hash = EXCLUDED.code_hash,
       expires_at = EXCLUDED.expires_at,
       created_at = now()`,
    [emailNorm, codeHash, expiresAt]
  );

  if (isSmtpConfigured()) {
    await sendRegistrationCodeEmail(emailNorm, code);
  } else if (process.env.NODE_ENV !== "production") {
    console.info(
      `[registration] 验证码（未配置 SMTP，仅开发环境打印） ${emailNorm}: ${code}`
    );
  } else {
    throw new Error(
      "服务器未配置邮件（SMTP_HOST 等），无法发送验证码，请联系管理员"
    );
  }

  return { ok: true };
}

/** 校验验证码并创建用户（role=user），返回公开用户信息。 */
export async function completeRegistration(body) {
  const emailNorm = normalizeRegistrationEmail(body?.email);
  if (!emailNorm) throw new Error("请输入有效邮箱");

  const code = String(body?.code ?? "").trim();
  if (!/^\d{6}$/.test(code)) throw new Error("验证码为 6 位数字");

  const password = String(body?.password ?? "");
  const displayName =
    typeof body?.displayName === "string" ? body.displayName : "";

  const res = await query(
    "SELECT code_hash, expires_at FROM email_registration_codes WHERE email = $1",
    [emailNorm]
  );
  const row = res.rows[0];
  if (!row) throw new Error("请先获取验证码");

  if (new Date(row.expires_at) < new Date()) {
    await query("DELETE FROM email_registration_codes WHERE email = $1", [emailNorm]);
    throw new Error("验证码已过期，请重新获取");
  }

  const match = await bcrypt.compare(code, row.code_hash);
  if (!match) throw new Error("验证码不正确");

  await query("DELETE FROM email_registration_codes WHERE email = $1", [emailNorm]);

  return createUserWithEmail({
    email: emailNorm,
    password,
    displayName,
  });
}
