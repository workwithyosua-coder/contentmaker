import { cookies } from "next/headers";
import { AUTH_COOKIE, isAuthed } from "@/lib/auth";
import { isDbPoolError } from "@/lib/db";
import { logConversion } from "@/lib/affiliate/server";

// POST /api/insights/affiliate-conversions: the owner logs affiliate clicks / orders / commission for one episode and
// platform (the /insights "Log affiliate orders" form). Session cookie only (the proxy also guards this path).
// Body: { episodeId, platform, clicks, orders, commissionIdr }.
export async function POST(request: Request) {
  const jar = await cookies();
  if (!(await isAuthed(jar.get(AUTH_COOKIE)?.value))) return Response.json({ error: "Sign in first." }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Send the numbers as JSON." }, { status: 400 });
  }
  try {
    const saved = await logConversion(body);
    return Response.json({ ok: true, saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isDbPoolError(err)) return Response.json({ error: `The database is busy: ${message}. Try again.` }, { status: 503 });
    // validation and "needs migration 022" messages are the owner's to fix: 400; anything else is ours
    const known = /must be|Pick the|can't be more|Enter at least|looks too large|no longer exists|migration 022/.test(message);
    if (!known) console.error("[affiliate] conversion log failed:", err);
    return Response.json({ error: message }, { status: known ? 400 : 500 });
  }
}
