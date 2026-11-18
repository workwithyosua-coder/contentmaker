import "server-only";
import { decrypt } from "../crypto";
import { db } from "../db";
import { debugToken, metaConfigured } from "../platforms/meta";
import { TIKTOK_PUBLISH_SCOPE } from "../platforms/tiktok";
import type { PublishPlatform } from "./captions";

// Which connected accounts can publish, and why not when they can't.
export type PublishAccount = {
  id: string;
  platform: PublishPlatform;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  health: "ok" | "missing_permission" | "expired";
  problem: string | null;
  reconnect: string; // where the owner fixes it
};

const NEEDS = {
  youtube: ["https://www.googleapis.com/auth/youtube.upload"],
  tiktok: [TIKTOK_PUBLISH_SCOPE],
  instagram: ["instagram_content_publish"],
  facebook: ["pages_manage_posts"],
} as const;

export async function publishAccounts(userId: string): Promise<PublishAccount[]> {
  const rows = await db()<
    { id: string; platform: PublishPlatform; handle: string; display_name: string | null; avatar_url: string | null; scopes: string[] | null; access_token_enc: Buffer | null; refresh_expires_at: Date | null }[]
  >`
    SELECT id, platform, handle, display_name, avatar_url, scopes, access_token_enc, refresh_expires_at FROM social_accounts
    WHERE user_id = ${userId} AND is_active AND external_account_id NOT LIKE 'demo-%'
      AND platform IN ('youtube', 'tiktok', 'instagram', 'facebook')
    ORDER BY array_position(ARRAY['tiktok','instagram','youtube','facebook']::platform_t[], platform)`;
  return Promise.all(
    rows.map(async (r) => {
      const base = { id: r.id, platform: r.platform, handle: r.handle, display_name: r.display_name, avatar_url: r.avatar_url };
      const reconnect = r.platform === "tiktok" ? "/api/connect/tiktok?publish=1" : r.platform === "youtube" ? "/api/connect/youtube" : "/api/connect/meta";
      if (r.refresh_expires_at && r.refresh_expires_at.getTime() < Date.now()) {
        return { ...base, health: "expired" as const, problem: "Login expired. Reconnect.", reconnect };
      }
      let scopes = r.scopes ?? [];
      if ((r.platform === "instagram" || r.platform === "facebook") && r.access_token_enc && metaConfigured()) {
        const d = await debugToken(decrypt(r.access_token_enc)).catch(() => null);
        if (d && !d.valid) return { ...base, health: "expired" as const, problem: "Token expired. Reconnect.", reconnect };
        scopes = d?.scopes ?? scopes;
      }
      const missing = NEEDS[r.platform].filter((s) => !scopes.includes(s));
      return missing.length
        ? { ...base, health: "missing_permission" as const, problem: `Connected for stats only. Reconnect to allow publishing (${missing.join(", ")}).`, reconnect }
        : { ...base, health: "ok" as const, problem: null, reconnect };
    }),
  );
}
