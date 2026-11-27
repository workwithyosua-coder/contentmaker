import { cookies } from "next/headers";
import { AUTH_COOKIE, isAuthed } from "@/lib/auth";
import { isDbPoolError } from "@/lib/db";
import { syncMetrics } from "@/lib/insights/server";
import { renderAuthorized } from "@/lib/render";

// POST /api/insights/sync-metrics: Post Metrics Sync for every post published in the last 14 days (YouTube, Instagram,
// Facebook), then the pattern analyst. Allowed with the owner's session cookie (the "Sync metrics now" button) or
// the worker's RENDER_TOKEN (.github/workflows/metrics-sync.yml, daily). The proxy lets this path through without a
// cookie so the token can reach it; anything else gets a 401.
export const maxDuration = 300;

export async function POST(request: Request) {
  const jar = await cookies();
  if (!renderAuthorized(request) && !(await isAuthed(jar.get(AUTH_COOKIE)?.value))) {
    return Response.json({ error: "Sign in, or send the worker's RENDER_TOKEN as a Bearer token." }, { status: 401 });
  }
  try {
    const r = await syncMetrics();
    console.log(`[metrics] synced ${r.synced}, failed ${r.failed}${r.notices.length ? `; notices: ${r.notices.join(" | ")}` : ""}${r.analysis ? `; ${r.analysis}` : ""}`);
    return Response.json(r);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[metrics] sync failed:", err);
    return Response.json({ error: `Metrics sync failed: ${message}` }, { status: isDbPoolError(err) ? 503 : 500 });
  }
}
