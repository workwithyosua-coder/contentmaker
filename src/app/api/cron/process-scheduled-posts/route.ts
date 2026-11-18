import { createHash } from "node:crypto";
import { safeEqual } from "@/lib/auth";
import { db } from "@/lib/db";
import { tick } from "@/lib/publish/engine";

export const maxDuration = 120;

// Publish worker, called every minute by Supabase pg_cron (net.http_post) and safe to call more often:
// due rows are claimed with row locks, so two runs never work on the same post.
// Auth: `Authorization: Bearer <token>` where the token is CRON_SECRET, or matches the sha256 stored in
// app_settings('publish_worker_token_sha256') (the token the database scheduler sends).
async function authorized(request: Request) {
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!given) return false;
  if (process.env.CRON_SECRET && safeEqual(given, process.env.CRON_SECRET)) return true;
  const [row] = await db()<{ value: string }[]>`SELECT value FROM app_settings WHERE key = 'publish_worker_token_sha256'`;
  return Boolean(row) && safeEqual(createHash("sha256").update(given).digest("hex"), row.value);
}

async function run(request: Request) {
  if (!(await authorized(request))) return new Response("Not found", { status: 404 });
  const until = Date.now() + 50_000; // finish well before the next minute's call
  const done: Awaited<ReturnType<typeof tick>> = [];
  while (Date.now() < until) {
    const batch = await tick();
    if (!batch.length) break;
    done.push(...batch);
  }
  return Response.json({ ok: true, processed: done.length, results: done });
}

export const GET = run;
export const POST = run;
