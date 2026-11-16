import type { ReactNode } from "react";

export function Card({ title, action, children, className = "" }: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-border bg-surface p-4 md:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

const VERDICT: Record<string, { label: string; color: string; bg: string }> = {
  winner: { label: "Winner", color: "var(--win)", bg: "var(--win-bg)" },
  above_avg: { label: "Above avg", color: "var(--good)", bg: "var(--good-bg)" },
  average: { label: "Average", color: "var(--avg)", bg: "var(--avg-bg)" },
  below_avg: { label: "Below avg", color: "var(--weak)", bg: "var(--weak-bg)" },
  underperformer: { label: "Underperformer", color: "var(--bad)", bg: "var(--bad-bg)" },
  too_early: { label: "Too early", color: "var(--early)", bg: "var(--early-bg)" },
};

export function VerdictChip({ verdict }: { verdict: string }) {
  const v = VERDICT[verdict] ?? VERDICT.average;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
      style={{ color: v.color, background: v.bg }}
    >
      {v.label}
    </span>
  );
}

export const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  x: "X",
  facebook: "Facebook",
  threads: "Threads",
};

export function PlatformDot({ platform }: { platform: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className="h-2 w-2 rounded-full" style={{ background: `var(--c-${platform}, var(--muted))` }} />
      {PLATFORM_LABEL[platform] ?? platform}
    </span>
  );
}

export const fmtNum = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`;
export const fmtPct = (n: number | null | undefined, digits = 0) => (n === null || n === undefined ? "–" : `${(n * 100).toFixed(digits)}%`);

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
      <h2 className="font-semibold">{title}</h2>
      <div className="mx-auto mt-2 max-w-md text-sm text-muted">{children}</div>
    </div>
  );
}
