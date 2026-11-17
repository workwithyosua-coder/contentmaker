import { connection } from "next/server";
import { Suspense } from "react";
import { RemoveAccountButton, RemoveDemoButton, SyncNowButton } from "@/components/account-actions";
import { SetupNotice } from "@/components/setup-notice";
import { Card, PLATFORM_LABEL, PlatformDot } from "@/components/ui";
import { db } from "@/lib/db";
import { metaConfigured } from "@/lib/platforms/meta";
import { tiktokConfigured } from "@/lib/platforms/tiktok";
import { getOwner } from "@/lib/queries";

export default function AccountsPage(props: PageProps<"/accounts">) {
  return (
    <>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Accounts</h1>
        <p className="text-sm text-muted">Social accounts and creative tools connected to your studio.</p>
      </header>
      <Suspense fallback={<div className="h-48 animate-pulse rounded-2xl bg-surface-2" />}>
        <AccountsList searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

const MESSAGES: Record<string, string> = {
  tiktok_not_configured: "TikTok keys are missing: add TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in Vercel, then redeploy.",
  tiktok_denied: "TikTok connection was cancelled.",
  tiktok_state: "The TikTok login expired or didn't match. Please try again.",
  tiktok_connect: "TikTok connection failed. Check that your account is a sandbox target user and try again.",
  tiktok_sync: "TikTok connected, but importing your videos failed. See the error under the account.",
  meta_not_configured: "Meta keys are missing: add META_APP_ID, META_APP_SECRET and META_LOGIN_CONFIG_ID in Vercel, then redeploy.",
  meta_denied: "Facebook connection was cancelled.",
  meta_state: "The Facebook login expired or didn't match. Please try again.",
  meta_no_pages: "No Facebook Page was shared. Connect again and select your Page (and its Instagram account) in the Facebook dialog.",
  meta_connect: "Facebook/Instagram connection failed. Please try again; if it keeps failing, tell Claude.",
  meta_sync: "Connected, but importing posts failed. See the error under the account.",
  no_owner: "No user found in the database.",
};

const PLATFORMS = ["tiktok", "instagram", "facebook", "youtube"] as const;

type AccountRow = {
  id: string;
  platform: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  external_account_id: string;
  last_synced_at: Date | null;
  last_sync_error: string | null;
  posts: number;
};

async function AccountsList({ searchParams }: { searchParams: PageProps<"/accounts">["searchParams"] }) {
  await connection(); // request time only: never query the database during the build
  const sp = await searchParams;
  let owner;
  try {
    owner = await getOwner();
  } catch (e) {
    console.error("[db] failed to load owner:", e);
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }
  if (!owner) return <SetupNotice />;

  const accounts = await db()<AccountRow[]>`
    SELECT sa.id, sa.platform, sa.handle, sa.display_name, sa.avatar_url, sa.external_account_id,
           sa.last_synced_at, sa.last_sync_error, (SELECT count(*)::int FROM posts p WHERE p.social_account_id = sa.id) AS posts
    FROM social_accounts sa WHERE sa.user_id = ${owner.id} ORDER BY sa.platform, sa.created_at`;
  const real = accounts.filter((a) => !a.external_account_id.startsWith("demo-"));
  const demo = accounts.filter((a) => a.external_account_id.startsWith("demo-"));
  const configured: Record<string, boolean> = {
    tiktok: tiktokConfigured(),
    instagram: metaConfigured(),
    facebook: metaConfigured(),
  };
  const connectPath: Record<string, string> = { tiktok: "tiktok", instagram: "meta", facebook: "meta", youtube: "youtube" };

  const connectedMsg =
    typeof sp.connected === "string"
      ? `${sp.connected === "meta" ? "Instagram & Facebook" : (PLATFORM_LABEL[sp.connected] ?? sp.connected)} connected${typeof sp.videos === "string" ? `: imported ${sp.videos} videos` : ""}.`
      : null;
  const errorMsg =
    typeof sp.error === "string"
      ? (MESSAGES[sp.error] ?? "Something went wrong.")
      : sp.warn === "no_instagram"
        ? "Your Facebook Page is connected, but no Instagram account is linked to it. Link Instagram to the Page (Page settings → Linked accounts), then tap Reconnect."
        : null;

  return (
    <div className="space-y-4">
      {connectedMsg && <Banner ok>{connectedMsg}</Banner>}
      {errorMsg && <Banner>{errorMsg}</Banner>}

      <Card title="Your accounts" action={real.length ? <SyncNowButton /> : null}>
        <ul className="divide-y divide-border">
          {PLATFORMS.map((p) => {
            const linked = real.filter((a) => a.platform === p);
            return (
              <li key={p} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <PlatformDot platform={p} />
                  {configured[p] ? (
                    <a
                      href={`/api/connect/${connectPath[p]}`}
                      className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-contrast"
                    >
                      {linked.length ? "Reconnect" : connectPath[p] === "meta" ? "Connect via Facebook" : `Connect ${PLATFORM_LABEL[p]}`}
                    </a>
                  ) : (
                    <span className="text-xs text-muted">Waiting for setup</span>
                  )}
                </div>
                {linked.map((a) => (
                  <div key={a.id} className="mt-2 flex items-center gap-3 rounded-xl bg-surface-2 p-3">
                    {a.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.avatar_url} alt="" className="h-9 w-9 rounded-full" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="h-9 w-9 rounded-full bg-border" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{a.display_name ?? a.handle}</div>
                      <div className="text-[11px] text-muted">
                        {a.posts} posts · synced {a.last_synced_at ? new Date(a.last_synced_at).toLocaleString() : "never"}
                      </div>
                      {a.last_sync_error && (
                        <div className="mt-1 text-[11px]" style={{ color: "var(--bad)" }}>Last sync failed: {a.last_sync_error}</div>
                      )}
                    </div>
                    <RemoveAccountButton accountId={a.id} name={a.display_name ?? a.handle} />
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-muted">Stats refresh automatically once a day. Use “Sync now” for an immediate update.</p>
      </Card>

      {demo.length > 0 && (
        <Card title="Demo data">
          <p className="mb-3 text-sm text-muted">
            {demo.length} demo accounts with example posts are still in your dashboard. Remove them once your real
            accounts are connected so the numbers and the Analyst only use your real content.
          </p>
          <RemoveDemoButton />
        </Card>
      )}

      <Card title="Creative tools">
        <ul className="divide-y divide-border text-sm">
          {[
            ["Canva", "Thumbnails, carousels, covers (autofill templates)"],
            ["Figma", "Design your editing styles and caption looks"],
            ["CapCut", "Optional manual polish (handoff package)"],
          ].map(([name, desc]) => (
            <li key={name} className="flex items-center justify-between gap-3 py-3">
              <div>
                <div className="font-medium">{name}</div>
                <div className="text-xs text-muted">{desc}</div>
              </div>
              <span className="text-xs text-muted">Later phase</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Banner({ ok = false, children }: { ok?: boolean; children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl px-4 py-3 text-sm font-medium"
      style={{ color: ok ? "var(--win)" : "var(--bad)", background: ok ? "var(--win-bg)" : "var(--bad-bg)" }}
    >
      {children}
    </div>
  );
}
