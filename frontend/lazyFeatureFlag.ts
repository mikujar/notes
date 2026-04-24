/**
 * lazyFeatureFlag.ts — 控制"懒加载模式"是否启用
 *
 * 行为：
 *   - 环境变量 VITE_LAZY_COLLECTIONS=1 时启用（默认关闭）
 *   - localStorage 里 `cardnote.lazyCollections` 可覆盖（调试方便）：
 *       localStorage.setItem("cardnote.lazyCollections", "1")  → 开
 *       localStorage.setItem("cardnote.lazyCollections", "0")  → 关（覆盖 env）
 *   - 只读一次（启动时确定），避免中途切换导致状态不一致
 *
 * 启用后：视图从客户端全树遍历切换到调用 /api/overview/summary /api/search
 * 等新端点；合集详情走 useCardsForCollection 按需拉卡。
 */

const LS_KEY = "cardnote.lazyCollections";

function readOverride(): boolean | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === "1" || v === "true") return true;
    if (v === "0" || v === "false") return false;
    return null;
  } catch {
    return null;
  }
}

function readEnv(): boolean {
  const raw = (import.meta.env.VITE_LAZY_COLLECTIONS as string | undefined)?.trim();
  return raw === "1" || raw === "true";
}

/** 启动时快照；整个会话期间固定值，方便条件分支稳定 */
const SNAPSHOT: boolean = (() => {
  const override = readOverride();
  if (override !== null) return override;
  return readEnv();
})();

export function isLazyCollectionsEnabled(): boolean {
  return SNAPSHOT;
}
