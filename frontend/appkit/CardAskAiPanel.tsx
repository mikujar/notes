import { useCallback, useEffect, useState } from "react";
import type { NoteCard, NoteMediaItem } from "../types";
import { useAppChrome } from "../i18n/useAppChrome";
import { gatherNoteAssistImageParts } from "../api/noteAssistImages";
import {
  postNoteAssist,
  type NoteAssistQuickAction,
  type NoteAssistRelatedCard,
} from "../api/noteAssist";
import {
  buildAttachmentsLineForAi,
  buildCardExtrasMetaForAi,
  buildTagsLineForAi,
  cardDisplayLabel,
  plainTextFromNoteHtml,
} from "../notePlainText";

export type CardAskAiGate = "ok" | "login" | "remote";

const LOGO_STROKE = "var(--cardnote-logo-jar)";
const LOGO_FILL = "var(--cardnote-logo-jar)";

export type CardAskAiRelatedEntry = NoteAssistRelatedCard & {
  /** 仅客户端用于抓取配图，不会原样随 JSON 上传 */
  media?: NoteMediaItem[];
};

export type CardAskAiContext = {
  nodeKey: string;
  colId: string;
  card: NoteCard;
  relatedCards: CardAskAiRelatedEntry[];
};

function assistPayloadBase(ctx: CardAskAiContext) {
  const card = ctx.card;
  return {
    cardTitle: cardDisplayLabel(card),
    cardText: plainTextFromNoteHtml(card.text || ""),
    cardTags: buildTagsLineForAi(card),
    cardAttachments: buildAttachmentsLineForAi(card),
    cardExtras: buildCardExtrasMetaForAi(card),
    relatedCards: ctx.relatedCards.map(({ collectionName, text }) => ({
      collectionName,
      text,
    })),
  };
}

async function assistPayloadWithImages(ctx: CardAskAiContext) {
  const images = await gatherNoteAssistImageParts({
    mainMedia: ctx.card.media,
    related: ctx.relatedCards,
  });
  return { ...assistPayloadBase(ctx), images };
}

export function CardAskAiPanel({
  open,
  context,
  gate,
  canEdit = false,
  onSaveAnswerAsCard,
  onClose,
}: {
  open: boolean;
  context: CardAskAiContext | null;
  gate: CardAskAiGate;
  canEdit?: boolean;
  onSaveAnswerAsCard?: (
    plainText: string,
    sourceColId: string,
    sourceCardId: string
  ) => Promise<boolean>;
  onClose: () => void;
}) {
  const c = useAppChrome();
  const enabled = gate === "ok";
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [wonderErr, setWonderErr] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState<"wonder" | "action" | "chat" | null>(
    null
  );
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveHint, setSaveHint] = useState<"ok" | "fail" | null>(null);

  const cardTitle = context ? cardDisplayLabel(context.card) : "";

  const resetForCard = useCallback(() => {
    setQuestions(null);
    setWonderErr(null);
    setChatInput("");
    setAnswer(null);
    setLoading(null);
    setSaveBusy(false);
    setSaveHint(null);
  }, []);

  useEffect(() => {
    if (!open || !context || !enabled) {
      resetForCard();
      return;
    }
    resetForCard();
    let cancelled = false;
    setLoading("wonder");
    void (async () => {
      try {
        const payload = await assistPayloadWithImages(context);
        if (cancelled) return;
        const res = await postNoteAssist({
          task: "suggest_questions",
          ...payload,
        });
        if (cancelled) return;
        setLoading(null);
        if (!res.ok) {
          setWonderErr(
            res.code === "AI_QUOTA_EXCEEDED"
              ? res.error || c.cardAskAiQuotaExceeded
              : res.error
          );
          return;
        }
        setQuestions(res.questions ?? null);
      } catch {
        if (cancelled) return;
        setLoading(null);
        setWonderErr(c.cardAskAiError);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, context, enabled, resetForCard, c.cardAskAiError, c.cardAskAiQuotaExceeded]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const runQuickAction = async (quickAction: NoteAssistQuickAction) => {
    if (!context || !enabled) return;
    setLoading("action");
    setAnswer(null);
    setSaveHint(null);
    let res;
    try {
      const payload = await assistPayloadWithImages(context);
      res = await postNoteAssist({
        task: "quick_action",
        ...payload,
        quickAction,
      });
    } catch {
      res = { ok: false as const, error: c.cardAskAiError };
    }
    setLoading(null);
    if (!res.ok) {
      setAnswer(
        res.code === "AI_QUOTA_EXCEEDED"
          ? res.error || c.cardAskAiQuotaExceeded
          : res.error
      );
      return;
    }
    setAnswer(res.text ?? "");
  };

  const sendChat = async (message: string) => {
    const msg = message.trim();
    if (!context || !enabled || !msg) return;
    setLoading("chat");
    setAnswer(null);
    setSaveHint(null);
    let res;
    try {
      const payload = await assistPayloadWithImages(context);
      res = await postNoteAssist({
        task: "chat",
        ...payload,
        message: msg,
      });
    } catch {
      res = { ok: false as const, error: c.cardAskAiError };
    }
    setLoading(null);
    if (!res.ok) {
      setAnswer(
        res.code === "AI_QUOTA_EXCEEDED"
          ? res.error || c.cardAskAiQuotaExceeded
          : res.error
      );
      return;
    }
    setAnswer(res.text ?? "");
  };

  const onSubmitInput = (e: React.FormEvent) => {
    e.preventDefault();
    const v = chatInput.trim();
    if (!v) return;
    void sendChat(v);
  };

  if (!open || !context) return null;

  const disabled = !enabled;
  const busy = loading !== null;

  return (
    <>
      {/* 不铺可点全屏层：否则盖在笔记探索白板上会抢走拖移/缩放，并在松手时误触关闭 */}
      <aside
        className="card-ask-ai"
        role="dialog"
        aria-modal
        aria-labelledby="card-ask-ai-title"
      >
        <div className="card-ask-ai__head">
          <span id="card-ask-ai-title" className="card-ask-ai__head-title">
            {c.cardAskAiTitle}
          </span>
          <button
            type="button"
            className="card-ask-ai__icon-btn"
            onClick={onClose}
            aria-label={c.cardAskAiClose}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden
            >
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <p className="card-ask-ai__card-title" title={cardTitle || undefined}>
          {cardTitle || "—"}
        </p>

        {gate === "login" ? (
          <p className="card-ask-ai__hint card-ask-ai__hint--warn">
            {c.cardAskAiNeedLogin}
          </p>
        ) : null}
        {gate === "remote" ? (
          <p className="card-ask-ai__hint card-ask-ai__hint--warn">
            {c.cardAskAiNeedRemote}
          </p>
        ) : null}

        <form className="card-ask-ai__chat" onSubmit={onSubmitInput}>
          <input
            type="text"
            className="card-ask-ai__input"
            placeholder={c.cardAskAiPlaceholder}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            disabled={disabled || busy}
            autoComplete="off"
          />
          <button
            type="submit"
            className="card-ask-ai__send"
            disabled={disabled || busy || !chatInput.trim()}
            aria-label={c.cardAskAiSend}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M5 12h14M13 6l6 6-6 6"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </form>

        <div className="card-ask-ai__section-label">{c.cardAskAiQuickAction}</div>
        <ul className="card-ask-ai__quick">
          {(
            [
              ["dive", c.cardAskAiDive] as const,
              ["explain", c.cardAskAiExplain] as const,
              ["simplify", c.cardAskAiSimplify] as const,
              ["example", c.cardAskAiExample] as const,
            ] as const
          ).map(([key, label]) => (
            <li key={key}>
              <button
                type="button"
                className="card-ask-ai__quick-btn"
                disabled={disabled || busy}
                onClick={() => void runQuickAction(key)}
              >
                <QuickIcon kind={key} />
                <span>{label}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="card-ask-ai__section-row">
          <span className="card-ask-ai__section-label">{c.cardAskAiWonder}</span>
        </div>
        {loading === "wonder" ? (
          <p className="card-ask-ai__hint">{c.cardAskAiLoading}</p>
        ) : wonderErr ? (
          <p className="card-ask-ai__hint card-ask-ai__hint--warn">{wonderErr}</p>
        ) : questions ? (
          <ul className="card-ask-ai__wonder">
            {questions.map((q, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="card-ask-ai__wonder-btn"
                  disabled={disabled || busy}
                  onClick={() => {
                    setChatInput(q);
                    void sendChat(q);
                  }}
                >
                  <span className="card-ask-ai__wonder-q" aria-hidden>
                    ?
                  </span>
                  <span>{q}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {(answer || (busy && (loading === "action" || loading === "chat"))) && (
          <div className="card-ask-ai__answer-block">
            <div className="card-ask-ai__section-label">{c.cardAskAiAnswer}</div>
            {busy && (loading === "action" || loading === "chat") ? (
              <p className="card-ask-ai__hint">{c.cardAskAiLoading}</p>
            ) : answer ? (
              <>
                <div className="card-ask-ai__answer">{answer}</div>
                {canEdit &&
                enabled &&
                onSaveAnswerAsCard &&
                !busy &&
                answer.trim() ? (
                  <div className="card-ask-ai__save-row">
                    <button
                      type="button"
                      className="card-ask-ai__save-note-btn"
                      disabled={saveBusy}
                      onClick={() => {
                        if (!context || !onSaveAnswerAsCard || !answer.trim()) {
                          return;
                        }
                        void (async () => {
                          setSaveBusy(true);
                          setSaveHint(null);
                          const ok = await onSaveAnswerAsCard(
                            answer,
                            context.colId,
                            context.card.id
                          );
                          setSaveBusy(false);
                          setSaveHint(ok ? "ok" : "fail");
                        })();
                      }}
                    >
                      {saveBusy ? c.cardAskAiLoading : c.cardAskAiSaveAsNote}
                    </button>
                    {saveHint === "ok" ? (
                      <span className="card-ask-ai__save-hint card-ask-ai__save-hint--ok">
                        {c.cardAskAiSaveSuccess}
                      </span>
                    ) : saveHint === "fail" ? (
                      <span className="card-ask-ai__save-hint card-ask-ai__save-hint--fail">
                        {c.cardAskAiSaveFail}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        )}
      </aside>
    </>
  );
}

function QuickIcon({ kind }: { kind: NoteAssistQuickAction }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24" as const,
    fill: "none" as const,
    stroke: LOGO_STROKE,
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (kind === "dive") {
    return (
      <svg {...common} aria-hidden>
        <circle cx="6" cy="6" r="2.25" />
        <circle cx="18" cy="6" r="2.25" />
        <circle cx="12" cy="18" r="2.25" />
        <path d="M7.2 7.5l3.6 8.2M16.8 7.5l-3.6 8.2" />
      </svg>
    );
  }
  if (kind === "explain") {
    return (
      <svg {...common} aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.8 2.8 0 114 4L12 17" />
        <circle cx="12" cy="19" r="0.75" fill={LOGO_FILL} stroke="none" />
      </svg>
    );
  }
  if (kind === "simplify") {
    return (
      <svg {...common} aria-hidden>
        <path d="M4 8h10M4 12h14M4 16h8" />
        <path d="M17 10l3 3-3 3" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden>
      <path d="M4 6h16M4 12h10M4 18h14" />
    </svg>
  );
}
