import "server-only";
import { db } from "../db";
import { syncFacebookPage, syncInstagramAccount } from "./meta";
import { syncTikTokAccount } from "./tiktok";
import { syncYouTubeChannel } from "./youtube";

const SYNCERS: Record<string, (id: string) => Promise<{ ok: boolean; videos?: number; error?: string }>> = {
  tiktok: syncTikTokAccount,
  instagram: syncInstagramAccount,
  facebook: syncFacebookPage,
  youtube: syncYouTubeChannel,
};

/** Syncs every connected (non-demo) account. Used by the daily cron and the "Sync now" button. */
export async function syncAllAccounts(userId?: string) {
  const sql = db();
  const accounts = await sql<{ id: string; platform: string }[]>`
    SELECT id, platform FROM social_accounts
    WHERE is_active AND access_token_enc IS NOT NULL AND external_account_id NOT LIKE 'demo-%'
      ${userId ? sql`AND user_id = ${userId}` : sql``}`;
  const results: Record<string, { ok: boolean; videos?: number; error?: string }> = {};
  for (const a of accounts) {
    const sync = SYNCERS[a.platform];
    if (sync) results[a.id] = await sync(a.id);
  }
  return results;
}
