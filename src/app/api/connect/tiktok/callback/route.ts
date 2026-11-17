import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/auth";
import { exchangeTikTokCode } from "@/lib/platforms/tiktok";
import { getOwner } from "@/lib/queries";
import { saveTikTokAccount, syncTikTokAccount } from "@/lib/sync/tiktok";

export const maxDuration = 300;

// Step 2: TikTok sends the owner back here with ?code=…&state=…
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/accounts?${q}`, origin));
    res.cookies.delete({ name: "tiktok_oauth_state", path: "/api/connect/tiktok" });
    return res;
  };

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return back(`error=tiktok_denied`);
  const code = params.get("code");
  const state = params.get("state") ?? "";
  const expected = request.cookies.get("tiktok_oauth_state")?.value ?? "";
  if (!code || !expected || !safeEqual(state, expected)) return back("error=tiktok_state");

  try {
    const owner = await getOwner();
    if (!owner) return back("error=no_owner");
    const token = await exchangeTikTokCode(code, origin);
    const accountId = await saveTikTokAccount(owner.id, token);
    const result = await syncTikTokAccount(accountId);
    return back(result.ok ? `connected=tiktok&videos=${result.videos}` : "error=tiktok_sync");
  } catch (err) {
    console.error("[connect:tiktok]", err instanceof Error ? err.message : err);
    return back("error=tiktok_connect");
  }
}
