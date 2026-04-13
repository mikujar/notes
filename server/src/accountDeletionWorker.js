/**
 * 异步注销队列：后台轮询 deletion_pending 用户，先清 COS 再删库。
 * 环境变量：ACCOUNT_DELETION_POLL_MS（默认 60000）、ACCOUNT_DELETION_WORKER=0 可禁用。
 */
import { query } from "./db.js";
import { deleteCosObjectsForUserAccount, isCosConfigured } from "./storage.js";
import { finalizeUserDeletionInDb } from "./users.js";

export async function runAccountDeletionWorkerOnce() {
  const sel = await query(
    `SELECT id FROM users WHERE COALESCE(deletion_pending, false) = true
     ORDER BY deletion_requested_at ASC NULLS LAST LIMIT 1`
  );
  const id = sel.rows[0]?.id;
  if (!id) return;
  if (isCosConfigured()) {
    await deleteCosObjectsForUserAccount(id);
  }
  await finalizeUserDeletionInDb(id);
}

export function startAccountDeletionWorker() {
  const off = process.env.ACCOUNT_DELETION_WORKER?.trim().toLowerCase();
  if (off === "0" || off === "false" || off === "no") {
    console.log("  account-deletion-worker: disabled (ACCOUNT_DELETION_WORKER)");
    return;
  }
  const ms = Math.max(5_000, Number(process.env.ACCOUNT_DELETION_POLL_MS ?? 60_000) || 60_000);
  const tick = () => {
    runAccountDeletionWorkerOnce().catch((e) => {
      console.error("[account-deletion-worker]", e?.message || e);
    });
  };
  setInterval(tick, ms);
  setTimeout(tick, 3_000);
  console.log(`  account-deletion-worker: poll every ${ms}ms`);
}
