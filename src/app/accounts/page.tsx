import { Suspense } from "react";
import { SetupNotice } from "@/components/setup-notice";
import { Card, PlatformDot } from "@/components/ui";
import { db } from "@/lib/db";
import { getOwner } from "@/lib/queries";

export default function AccountsPage() {
  return (
    <>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Accounts</h1>
        <p className="text-sm text-muted">Social accounts and creative tools connected to your studio.</p>
      </header>
      <Suspense fallback={<div className="h-48 animate-pulse rounded-2xl bg-surface-2" />}>
        <AccountsList />
      </Suspense>
    </>
  );
}

async function AccountsList() {
  let owner;
  try {
    owner = await getOwner();
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }
  if (!owner) return <SetupNotice />;
  const accounts = await db()<{ id: string; platform: string; handle: string; external_account_id: string; last_synced_at: Date | null }[]>`
    SELECT id, platform, handle, external_account_id, last_synced_at FROM social_accounts
    WHERE user_id = ${owner.id} ORDER BY platform`;

  return (
    <div className="space-y-4">
      <Card title="Social accounts">
        <ul className="divide-y divide-border">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-3">
              <div>
                <PlatformDot platform={a.platform} />
                <div className="text-sm font-medium">{a.handle}</div>
              </div>
              {a.external_account_id.startsWith("demo-") ? (
                <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: "var(--early)", background: "var(--early-bg)" }}>
                  Demo data
                </span>
              ) : (
                <span className="text-xs text-muted">
                  Synced {a.last_synced_at ? new Date(a.last_synced_at).toLocaleString() : "never"}
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">Connecting real accounts comes in the next step (via an aggregator like Ayrshare or the platform APIs).</p>
      </Card>
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
              <span className="text-xs text-muted">Not connected</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
