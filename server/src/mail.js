/**
 * 注册验证码等事务邮件（nodemailer + SMTP）。
 * 未配置 SMTP 时由 registration.js 在开发环境打印到控制台。
 */
import nodemailer from "nodemailer";

export function isSmtpConfigured() {
  return Boolean(process.env.SMTP_HOST?.trim());
}

/**
 * @param {string} to 收件人
 * @param {string} code 6 位数字验证码
 */
export async function sendRegistrationCodeEmail(to, code) {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) throw new Error("SMTP 未配置");

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from =
    process.env.SMTP_FROM?.trim() ||
    (user ? `"未来罐" <${user}>` : `"未来罐" <noreply@localhost>`);

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });

  await transporter.sendMail({
    from,
    to,
    subject: "未来罐 mikujar 注册验证码",
    text: `你的验证码是：${code}，10 分钟内有效。如非本人操作请忽略。`,
    html: `<p>你的验证码是：<strong style="font-size:18px;letter-spacing:0.1em">${code}</strong></p><p>10 分钟内有效。如非本人操作请忽略。</p>`,
  });
}

/**
 * 个人中心绑定 / 更换邮箱验证码
 * @param {string} to 收件人（新邮箱）
 * @param {string} code 6 位数字
 */
export async function sendProfileEmailChangeCodeEmail(to, code) {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) throw new Error("SMTP 未配置");

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from =
    process.env.SMTP_FROM?.trim() ||
    (user ? `"未来罐" <${user}>` : `"未来罐" <noreply@localhost>`);

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });

  await transporter.sendMail({
    from,
    to,
    subject: "未来罐 mikujar 邮箱验证码",
    text: `你正在绑定或更换账号邮箱。验证码：${code}，10 分钟内有效。如非本人操作请忽略。`,
    html: `<p>你正在<strong>绑定或更换</strong>账号邮箱。</p><p>验证码：<strong style="font-size:18px;letter-spacing:0.1em">${code}</strong></p><p>10 分钟内有效。如非本人操作请忽略。</p>`,
  });
}
