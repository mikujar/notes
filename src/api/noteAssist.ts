import { apiBase, apiFetchInit } from "./apiBase";
import { buildHeadersPut } from "./collections";

export type NoteAssistQuickAction = "dive" | "explain" | "simplify" | "example";

export type NoteAssistTask = "suggest_questions" | "quick_action" | "chat";

/** 与当前笔记建立过「相关」链接的其它卡片（服务端权重低于主卡片） */
export type NoteAssistRelatedCard = {
  collectionName: string;
  text: string;
};

/** 传给 Gemini 的配图（inlineData） */
export type NoteAssistImagePart = {
  /** 给模型看的说明，如「当前笔记·图1」 */
  label?: string;
  mimeType: string;
  /** 不含 data: 前缀的 base64 */
  dataBase64: string;
};

export async function postNoteAssist(body: {
  task: NoteAssistTask;
  cardTitle: string;
  cardText: string;
  /** 标签，逗号分隔等 */
  cardTags?: string;
  /** 附件说明，如「image: a.jpg」 */
  cardAttachments?: string;
  /** 日历、提醒、置顶等 */
  cardExtras?: string;
  relatedCards?: NoteAssistRelatedCard[];
  /** 笔记与相关卡片中的图片，多模态分析 */
  images?: NoteAssistImagePart[];
  quickAction?: NoteAssistQuickAction;
  message?: string;
}): Promise<
  | {
      ok: true;
      questions?: string[];
      text?: string;
      /** 非 admin 时返回本月已用次数与上限 */
      aiQuota?: {
        usedThisMonth: number;
        monthlyLimit: number;
        usageMonth: string;
      };
    }
  | { ok: false; error: string; code?: string; aiQuota?: unknown }
> {
  const base = apiBase();
  const url = `${base || ""}/api/ai/note-assist`;
  try {
    const r = await fetch(
      url,
      apiFetchInit({
        method: "POST",
        headers: buildHeadersPut({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      })
    );
    const data = (await r.json()) as {
      error?: string;
      code?: string;
      questions?: string[];
      text?: string;
      aiQuota?: { usedThisMonth: number; monthlyLimit: number; usageMonth: string };
    };
    if (!r.ok) {
      return {
        ok: false,
        error: data?.error || "请求失败",
        code: data?.code,
        aiQuota: data?.aiQuota,
      };
    }
    return {
      ok: true,
      questions: data.questions,
      text: data.text,
      aiQuota: data.aiQuota,
    };
  } catch {
    return { ok: false, error: "网络错误" };
  }
}
