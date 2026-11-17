import "server-only";
import { db } from "../db";
import { syncTikTokAccount } from "./tiktok";

/** Syncs every connected (non-demo) account. Used by the daily cron and the "Sync now" button. */
export async function syncAllAccounts(userId?: string) {
  const sql = db();
  const accounts = await sql<{ id: string; platform: string }[]>`
    SELECT id, platform FROM social_accounts
    WHERE is_active AND access_token_enc IS NOT NULL AND external_account_id NOT LIKE 'demo-%'
      ${userId ? sql`AND user_id = ${userId}` : sql``}`;
  const results: Record<string, unknown> = {};
  for (const a of accounts) {
    if (a.platform === "tiktok") results[a.id] = await syncTikTokAccount(a.id);
  }
  return results;
}
