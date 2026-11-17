import { PLATFORMS, type Platform } from "./queries";

export function parseFilters(sp: Record<string, string | string[] | undefined>) {
  const p = typeof sp.platform === "string" ? sp.platform : undefined;
  const platform = p && (PLATFORMS as readonly string[]).includes(p) ? (p as Platform) : undefined;
  const d = Number(typeof sp.days === "string" ? sp.days : 90);
  const days = [7, 30, 90].includes(d) ? d : 90;
  return { platform, days };
}
