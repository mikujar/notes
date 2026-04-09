/**
 * 注册验证码等事务邮件（nodemailer + SMTP）。
 * 未配置 SMTP 时由 registration.js 在开发环境打印到控制台。
 */
import nodemailer from "nodemailer";

/** 避免错误 SMTP 配置时握手挂死，导致 /send-code 长时间 Pending 无响应 */
const SMTP_CONNECT_MS = 12_000;
const SMTP_SOCKET_MS = 25_000;

function smtpTransportOptions() {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  return {
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
    connectionTimeout: SMTP_CONNECT_MS,
    greetingTimeout: SMTP_CONNECT_MS,
    socketTimeout: SMTP_SOCKET_MS,
  };
}

export function isSmtpConfigured() {
  return Boolean(process.env.SMTP_HOST?.trim());
}

/** 把 nodemailer 英文错因转成可操作的提示（前端会原样展示） */
function translateSmtpError(err) {
  const m = String(err?.message ?? err ?? "");
  const code = err?.code;
  if (/timeout|ETIMEDOUT/i.test(m) || code === "ETIMEDOUT") {
    return new Error(
      "发信服务器连接超时：请核对 Railway 里 SMTP 主机、端口（常用 587 或 465）和 SMTP_SECURE；部分邮箱会拦截云主机 IP，可改用 Resend 等发信服务"
    );
  }
  if (
    /ECONNREFUSED|ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(m) ||
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND"
  ) {
    return new Error(
      "无法连接发信服务器：请检查 SMTP_HOST 是否写对、本机能否解析该域名"
    );
  }
  if (/Invalid login|535|authentication failed|AUTH/i.test(m)) {
    return new Error(
      "发信认证失败：请核对 SMTP_USER / SMTP_PASS（QQ、Foxmail 等一般为「授权码」而非网页登录密码）"
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * @param {string} to 收件人
 * @param {string} code 6 位数字验证码
 */
export async function sendRegistrationCodeEmail(to, code) {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) throw new Error("SMTP 未配置");

  const user = process.env.SMTP_USER?.trim();
  const from =
    process.env.SMTP_FROM?.trim() ||
    (user ? `"未来罐" <${user}>` : `"未来罐" <noreply@localhost>`);

  const transporter = nodemailer.createTransport(smtpTransportOptions());

  try {
    await transporter.sendMail({
      from,
      to,
      subject: "未来罐 mikujar 注册验证码",
      text: `你的验证码是：${code}，10 分钟内有效。如非本人操作请忽略。`,
      html: `<p>你的验证码是：<strong style="font-size:18px;letter-spacing:0.1em">${code}</strong></p><p>10 分钟内有效。如非本人操作请忽略。</p>`,
    });
  } catch (e) {
    throw translateSmtpError(e);
  }
}

/**
 * 个人中心绑定 / 更换邮箱验证码
 * @param {string} to 收件人（新邮箱）
 * @param {string} code 6 位数字
 */
export async function sendProfileEmailChangeCodeEmail(to, code) {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) throw new Error("SMTP 未配置");

  const user = process.env.SMTP_USER?.trim();
  const from =
    process.env.SMTP_FROM?.trim() ||
    (user ? `"未来罐" <${user}>` : `"未来罐" <noreply@localhost>`);

  const transporter = nodemailer.createTransport(smtpTransportOptions());

  try {
    await transporter.sendMail({
      from,
      to,
      subject: "未来罐 mikujar 邮箱验证码",
      text: `你正在绑定或更换账号邮箱。验证码：${code}，10 分钟内有效。如非本人操作请忽略。`,
      html: `<p>你正在<strong>绑定或更换</strong>账号邮箱。</p><p>验证码：<strong style="font-size:18px;letter-spacing:0.1em">${code}</strong></p><p>10 分钟内有效。如非本人操作请忽略。</p>`,
    });
  } catch (e) {
    throw translateSmtpError(e);
  }
}
