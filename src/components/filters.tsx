import Link from "next/link";
import { PLATFORM_LABEL } from "./ui";

export function Filters({ basePath, platforms, platform, days }: {
  basePath: string;
  platforms: string[];
  platform?: string;
  days: number;
}) {
  const href = (p: string | undefined, d: number) => {
    const q = new URLSearchParams();
    if (p) q.set("platform", p);
    if (d !== 90) q.set("days", String(d));
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
      <Link href={href(undefined, days)} className="chip" aria-current={!platform}>All</Link>
      {platforms.map((p) => (
        <Link key={p} href={href(p, days)} className="chip" aria-current={platform === p}>
          {PLATFORM_LABEL[p] ?? p}
        </Link>
      ))}
      <span className="mx-1 w-px shrink-0 bg-border" />
      {[7, 30, 90].map((d) => (
        <Link key={d} href={href(platform, d)} className="chip" aria-current={days === d}>
          {d}d
        </Link>
      ))}
    </div>
  );
}
