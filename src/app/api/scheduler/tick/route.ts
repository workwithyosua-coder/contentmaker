import { isDbPoolError } from "@/lib/db";
import { notFound, renderAuthorized } from "@/lib/render";
import { tick } from "@/lib/scheduler-server";

export const maxDuration = 300;

// POST /api/scheduler/tick { slotId?, runUrl? } (RENDER_TOKEN): the autonomous-scheduler workflow's first call. Refills
// the next 3 days of slots, adds Gemini topic seeds, and claims the slots to produce now (or just `slotId`).
export async function POST(request: Request) {
  if (!renderAuthorized(request)) return notFound();
  const b = (await request.json().catch(() => ({}))) as { slotId?: string; runUrl?: string };
  const slotId = typeof b.slotId === "string" && b.slotId.trim() ? b.slotId.trim() : null;
  if (slotId && !/^[0-9a-f-]{36}$/.test(slotId)) return Response.json({ error: "Bad slot id." }, { status: 400 });
  try {
    return Response.json(await tick({ slotId, runUrl: typeof b.runUrl === "string" ? b.runUrl : null }));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[scheduler] tick failed: ${message}`);
    // a busy database pool (EMAXCONNSESSION…) is retryable: 503, and the worker tries again
    if (isDbPoolError(e)) return Response.json({ error: `The database is busy, retry: ${message}` }, { status: 503, headers: { "Retry-After": "3" } });
    return Response.json({ error: message }, { status: 409 });
  }
}
