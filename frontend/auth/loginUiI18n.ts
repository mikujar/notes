export type LoginUiLang = "zh" | "en";

const STORAGE_KEY = "cardnote.loginUiLang";

export function readStoredLoginUiLang(): LoginUiLang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "en" || v === "zh") return v;
  } catch {
    /* ignore */
  }
  return "zh";
}

export function writeStoredLoginUiLang(lang: LoginUiLang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
}

export type LoginUiT = {
  langSwitchAria: string;
  loginTitle: string;
  loginHint: string;
  phUser: string;
  phPassword: string;
  registerTitle: string;
  registerHint: string;
  phEmail: string;
  sendCode: string;
  phCode: string;
  phRegPassword: string;
  phNickname: string;
  consentBefore: string;
  termsLink: string;
  consentBetween: string;
  privacyLink: string;
  footerTerms: string;
  footerPrivacy: string;
  later: string;
  loginSubmit: string;
  registerSubmit: string;
  subNoAccount: string;
  linkRegister: string;
  subHasAccount: string;
  linkLogin: string;
  errLoginDefault: string;
  errEnterEmail: string;
  errRegisterDefault: string;
  sendCodeOk: string;
};

const zh: LoginUiT = {
  langSwitchAria: "界面语言",
  loginTitle: "登录账号",
  loginHint:
    "欢迎回来～用账号和密码登录，所有的卡片、合集、附件都还在原来的位置等你。",
  phUser: "用户名或邮箱",
  phPassword: "口令 / 密码",
  registerTitle: "邮箱注册",
  registerHint:
    "填好邮箱点「发验证码」，收到信后把 6 位数字填进来，再设一个至少 6 位的密码，就注册完成啦～",
  phEmail: "邮箱",
  sendCode: "发验证码",
  phCode: "6 位验证码",
  phRegPassword: "密码（至少 6 位）",
  phNickname: "昵称（可选，默认同邮箱前缀）",
  consentBefore: "注册即表示你已阅读并同意",
  termsLink: "《用户协议》",
  consentBetween: "与",
  privacyLink: "《隐私政策》",
  footerTerms: "用户协议",
  footerPrivacy: "隐私政策",
  later: "稍后再说",
  loginSubmit: "登录",
  registerSubmit: "注册并登录",
  subNoAccount: "还没有账号？",
  linkRegister: "邮箱注册",
  subHasAccount: "已有账号？",
  linkLogin: "去登录",
  errLoginDefault: "登录失败惹，再检查一下？",
  errEnterEmail: "请先填写邮箱",
  errRegisterDefault: "注册翻车啦，再试一次？",
  sendCodeOk:
    "验证码已发出，请查收邮件（含垃圾箱），10 分钟内填入下方即可～",
};

const en: LoginUiT = {
  langSwitchAria: "Interface language",
  loginTitle: "Sign in",
  loginHint:
    "Welcome back. Sign in with your account and password — your cards, sets, and attachments are right where you left them.",
  phUser: "Username or email",
  phPassword: "Password",
  registerTitle: "Sign up with email",
  registerHint:
    "Enter your email and tap Send code. Paste the 6-digit code, then set a password (at least 6 characters).",
  phEmail: "Email",
  sendCode: "Send code",
  phCode: "6-digit code",
  phRegPassword: "Password (min. 6 characters)",
  phNickname: "Display name (optional)",
  consentBefore: "By signing up, you agree to ",
  termsLink: "Terms of Service",
  consentBetween: " and ",
  privacyLink: "Privacy Policy",
  footerTerms: "Terms",
  footerPrivacy: "Privacy",
  later: "Not now",
  loginSubmit: "Sign in",
  registerSubmit: "Sign up",
  subNoAccount: "No account yet?",
  linkRegister: "Create one",
  subHasAccount: "Already have an account?",
  linkLogin: "Sign in",
  errLoginDefault: "Sign-in failed. Please try again.",
  errEnterEmail: "Enter your email first.",
  errRegisterDefault: "Sign-up failed. Please try again.",
  sendCodeOk:
    "Code sent. Check your inbox (and spam) and enter it within 10 minutes.",
};

export function loginUiT(lang: LoginUiLang): LoginUiT {
  return lang === "en" ? en : zh;
}
