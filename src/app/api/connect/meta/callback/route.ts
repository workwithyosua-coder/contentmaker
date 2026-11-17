import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/auth";
import { exchangeMetaCode, listMetaPages } from "@/lib/platforms/meta";
import { getOwner } from "@/lib/queries";
import { saveMetaAccounts, syncFacebookPage, syncInstagramAccount } from "@/lib/sync/meta";

export const maxDuration = 300;

// Step 2: Facebook sends the owner back with ?code=…&state=…
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/accounts?${q}`, origin));
    res.cookies.delete({ name: "meta_oauth_state", path: "/api/connect/meta" });
    return res;
  };

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return back("error=meta_denied");
  const code = params.get("code");
  const state = params.get("state") ?? "";
  const expected = request.cookies.get("meta_oauth_state")?.value ?? "";
  if (!code || !expected || !safeEqual(state, expected)) return back("error=meta_state");

  try {
    const owner = await getOwner();
    if (!owner) return back("error=no_owner");
    const userToken = await exchangeMetaCode(code, origin);
    const pages = await listMetaPages(userToken);
    if (!pages.length) return back("error=meta_no_pages");
    const saved = await saveMetaAccounts(owner.id, pages);
    let posts = 0;
    let failed = false;
    for (const s of saved) {
      const r = s.platform === "instagram" ? await syncInstagramAccount(s.id) : await syncFacebookPage(s.id);
      if (r.ok) posts += r.videos;
      else failed = true;
    }
    const ig = saved.some((s) => s.platform === "instagram");
    return back(
      failed
        ? "error=meta_sync"
        : `connected=${ig ? "meta" : "facebook"}&videos=${posts}${ig ? "" : "&warn=no_instagram"}`,
    );
  } catch (err) {
    console.error("[connect:meta]", err instanceof Error ? err.message : err);
    return back("error=meta_connect");
  }
}
