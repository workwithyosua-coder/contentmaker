import type { PostRow } from "@/lib/queries";
import { PlatformDot, VerdictChip, fmtNum, fmtPct } from "./ui";

export function PostList({ posts }: { posts: PostRow[] }) {
  if (!posts.length) return <p className="text-sm text-muted">No posts in this period.</p>;
  return (
    <ul className="divide-y divide-border">
      {posts.map((p) => (
        <li key={p.id} className="flex items-center gap-3 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <PlatformDot platform={p.platform} />
              <span className="text-[11px] text-muted">
                {new Date(p.published_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
            </div>
            <div className="mt-0.5 truncate text-sm font-medium">{p.caption_text ?? "(no caption)"}</div>
            <div className="mt-0.5 truncate text-[11px] text-muted">
              {[p.hook_type, p.style_name, p.duration_bucket].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div className="hidden w-20 text-right sm:block">
            <div className="text-sm font-semibold tabular-nums">{fmtNum(p.views ?? 0)}</div>
            <div className="text-[11px] text-muted">views</div>
          </div>
          <div className="hidden w-20 text-right md:block">
            <div className="text-sm font-semibold tabular-nums">{fmtPct(p.completion_rate === null ? null : Number(p.completion_rate))}</div>
            <div className="text-[11px] text-muted">completion</div>
          </div>
          <div className="flex w-28 flex-col items-end gap-1">
            <VerdictChip verdict={p.verdict} />
            <span className="text-[11px] tabular-nums text-muted sm:hidden">{fmtNum(p.views ?? 0)} views</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
