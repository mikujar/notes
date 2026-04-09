import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { Collection } from "./types";
import type { MediaQuotaInfo } from "./api/auth";
import {
  formatByteSize,
  summarizeNoteLibraryStats,
} from "./noteStats";

type AccountRole = "admin" | "user" | "subscriber";

type DataStatsModalProps = {
  open: boolean;
  onClose: () => void;
  collections: Collection[];
  mediaQuota?: MediaQuotaInfo | null;
  role?: AccountRole | null;
  /** 打开时刷新 /me，保证配额为最新 */
  onOpen?: () => void | Promise<void>;
};

export function DataStatsModal({
  open,
  onClose,
  collections,
  mediaQuota,
  role,
  onOpen,
}: DataStatsModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !onOpen) return;
    void onOpen();
  }, [open, onOpen]);

  const stats = useMemo(
    () => summarizeNoteLibraryStats(collections),
    [collections]
  );

  const quotaPct = useMemo(() => {
    if (!mediaQuota || mediaQuota.quotaUnlimited) return 0;
    if (mediaQuota.monthlyLimitBytes <= 0) return 0;
    return Math.min(
      100,
      (mediaQuota.uploadedBytesMonth / mediaQuota.monthlyLimitBytes) * 100
    );
  }, [mediaQuota]);

  if (!open) return null;

  const roleLabel =
    role === "admin"
      ? "站长"
      : role === "subscriber"
        ? "订阅用户"
        : role === "user"
          ? "普通用户"
          : null;

  const panel = (
    <div
      className="auth-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="auth-modal data-stats-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-stats-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="data-stats-title" className="auth-modal__title">
          数据统计
        </h2>
        <p className="auth-modal__hint data-stats-modal__hint">
          当前工作区内的合集、卡片与附件占用（按本机已记录或可推算的数据汇总）。
        </p>

        <dl className="data-stats-modal__list">
          <div className="data-stats-modal__row">
            <dt>合集</dt>
            <dd>{stats.collectionCount}</dd>
          </div>
          <div className="data-stats-modal__row">
            <dt>卡片</dt>
            <dd>{stats.cardCount}</dd>
          </div>
          <div className="data-stats-modal__row">
            <dt>附件</dt>
            <dd>
              {stats.attachmentCount} 个 ·{" "}
              {formatByteSize(stats.attachmentBytes)}
            </dd>
          </div>
        </dl>

        {mediaQuota && roleLabel ? (
          <div className="data-stats-modal__quota">
            <div className="data-stats-modal__quota-head">
              <span className="data-stats-modal__quota-label">
                云端附件额度
              </span>
              <span className="data-stats-modal__quota-plan">{roleLabel}</span>
            </div>
            {mediaQuota.quotaUnlimited ? (
              <p className="data-stats-modal__quota-meta data-stats-modal__quota-meta--admin">
                站长账号不按普通/订阅额度；单文件大小仅受服务器配置上限（UPLOAD_MAX_MB）。
              </p>
            ) : (
              <>
                <div
                  className="data-stats-modal__quota-bar-wrap"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(quotaPct)}
                  aria-label="本月附件上传用量"
                >
                  <div
                    className="data-stats-modal__quota-bar"
                    style={{ width: `${quotaPct}%` }}
                  />
                </div>
                <p className="data-stats-modal__quota-meta">
                  本月已上传 {formatByteSize(mediaQuota.uploadedBytesMonth)} /{" "}
                  {formatByteSize(mediaQuota.monthlyLimitBytes)}（自然月{" "}
                  {mediaQuota.usageMonth}，月初重置）
                </p>
                <p className="data-stats-modal__quota-meta data-stats-modal__quota-meta--inline">
                  <span>
                    单文件上限 {formatByteSize(mediaQuota.singleFileMaxBytes)}
                  </span>
                  <span className="data-stats-modal__quota-meta-sep" aria-hidden>
                    ·
                  </span>
                  <span className="data-stats-modal__quota-meta-sub">
                    删除已上传的附件不会恢复当月额度。
                  </span>
                </p>
              </>
            )}
          </div>
        ) : null}

        <div className="auth-modal__actions">
          <button
            type="button"
            className="auth-modal__btn auth-modal__btn--primary auth-modal__btn--primary--full"
            onClick={onClose}
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
