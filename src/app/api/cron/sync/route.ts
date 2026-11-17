import { safeEqual } from "@/lib/auth";
import { syncAllAccounts } from "@/lib/sync";

export const maxDuration = 300;

// Daily metrics sync, called by Vercel Cron (see vercel.json) with `Authorization: Bearer <CRON_SECRET>`.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return new Response("Unauthorized", { status: 401 });
  const results = await syncAllAccounts();
  return Response.json({ ok: true, results });
}
