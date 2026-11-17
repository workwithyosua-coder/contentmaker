import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/auth";
import { exchangeGoogleCode } from "@/lib/platforms/youtube";
import { getOwner } from "@/lib/queries";
import { saveYouTubeAccount, syncYouTubeChannel } from "@/lib/sync/youtube";

export const maxDuration = 300;

// Step 2: Google sends the owner back with ?code=…&state=…
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/accounts?${q}`, origin));
    res.cookies.delete({ name: "youtube_oauth_state", path: "/api/connect/youtube" });
    return res;
  };

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return back("error=youtube_denied");
  const code = params.get("code");
  const state = params.get("state") ?? "";
  const expected = request.cookies.get("youtube_oauth_state")?.value ?? "";
  if (!code || !expected || !safeEqual(state, expected)) return back("error=youtube_state");

  try {
    const owner = await getOwner();
    if (!owner) return back("error=no_owner");
    const token = await exchangeGoogleCode(code, origin);
    const accountId = await saveYouTubeAccount(owner.id, token);
    if (!accountId) return back("error=youtube_no_channel");
    const result = await syncYouTubeChannel(accountId);
    return back(result.ok ? `connected=youtube&videos=${result.videos}` : "error=youtube_sync");
  } catch (err) {
    console.error("[connect:youtube]", err instanceof Error ? err.message : err);
    return back("error=youtube_connect");
  }
}
