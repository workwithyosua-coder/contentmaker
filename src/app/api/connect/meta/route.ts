import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { metaAuthorizeUrl, metaConfigured } from "@/lib/platforms/meta";

// Step 1: one Facebook login grants both the Facebook Page and its linked Instagram account.
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  if (!metaConfigured()) return NextResponse.redirect(new URL("/accounts?error=meta_not_configured", origin));
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(metaAuthorizeUrl(origin, state));
  res.cookies.set("meta_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/connect/meta",
    maxAge: 600,
  });
  return res;
}
