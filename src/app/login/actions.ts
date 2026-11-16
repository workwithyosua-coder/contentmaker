"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, AUTH_MAX_AGE, safeEqual, tokenFor } from "@/lib/auth";

export async function login(_prev: string | null, formData: FormData): Promise<string | null> {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return "APP_PASSWORD is not set yet. Add it in Vercel → Settings → Environment Variables, then redeploy.";
  const given = String(formData.get("password") ?? "");
  if (!safeEqual(await tokenFor(given), await tokenFor(expected))) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return "Wrong password.";
  }
  (await cookies()).set(AUTH_COOKIE, await tokenFor(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: AUTH_MAX_AGE,
  });
  const next = String(formData.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}
