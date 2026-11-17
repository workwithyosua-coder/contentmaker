import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { tiktokAuthorizeUrl, tiktokConfigured } from "@/lib/platforms/tiktok";

// Step 1: send the owner to TikTok's login/consent screen. (Behind the password lock via proxy.)
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  if (!tiktokConfigured()) {
    return NextResponse.redirect(new URL("/accounts?error=tiktok_not_configured", origin));
  }
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(tiktokAuthorizeUrl(origin, state));
  res.cookies.set("tiktok_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/connect/tiktok",
    maxAge: 600,
  });
  return res;
}
