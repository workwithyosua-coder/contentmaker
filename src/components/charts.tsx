"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const PLATFORM_LABEL: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" };
const compact = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);

export function WeeklyViewsChart({ data, platforms }: { data: Record<string, number | string>[]; platforms: string[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="week"
            tickFormatter={(w: string) => w.slice(5)}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis tickFormatter={compact} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }}
            labelFormatter={(w) => `Week of ${w}`}
            formatter={(v, name) => [Number(v).toLocaleString(), PLATFORM_LABEL[String(name)] ?? String(name)]}
          />
          <Legend
            formatter={(name: string) => <span style={{ color: "var(--muted)", fontSize: 12 }}>{PLATFORM_LABEL[name] ?? name}</span>}
            iconType="circle"
            iconSize={8}
          />
          {platforms.map((p, i) => (
            <Bar
              key={p}
              dataKey={p}
              stackId="v"
              fill={`var(--c-${p})`}
              radius={i === platforms.length - 1 ? [4, 4, 0, 0] : 0}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
