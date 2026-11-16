import type { BreakdownRow } from "@/lib/queries";
import { fmtNum, fmtPct } from "./ui";

/** "What's working" bars: each row's average score vs. your overall average (1.0×). */
export function Breakdown({ rows }: { rows: BreakdownRow[] }) {
  if (!rows.length) return <p className="text-sm text-muted">Not enough data yet.</p>;
  const max = Math.max(...rows.map((r) => r.lift), 1.2);
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const good = r.lift >= 1.1;
        const bad = r.lift <= 0.9;
        const color = good ? "var(--win)" : bad ? "var(--bad)" : "var(--avg)";
        const lowSample = r.posts < 5;
        return (
          <li key={r.label}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-medium">{r.label}</span>
              <span className="shrink-0 tabular-nums font-semibold" style={{ color }}>
                {r.lift.toFixed(2)}×
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-surface-2">
              <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(r.lift / max) * 100}%`, background: color, opacity: lowSample ? 0.45 : 1 }} />
              <div className="absolute inset-y-[-3px] w-px bg-muted" style={{ left: `${(1 / max) * 100}%` }} title="Your average" />
            </div>
            <div className="mt-1 text-[11px] text-muted">
              {r.posts} posts · median {fmtNum(r.median_views)} views · {fmtPct(r.avg_completion)} completion
              {lowSample && " · low sample"}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
