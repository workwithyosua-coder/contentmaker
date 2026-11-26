"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Dashboard", icon: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" },
  { href: "/insights", label: "Insights", icon: "M9 21h6v-1H9v1zm3-19a7 7 0 0 0-4 12.74V17h8v-2.26A7 7 0 0 0 12 2z" },
  { href: "/create", label: "Create", icon: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" },
  { href: "/schedule", label: "Schedule", icon: "M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zM5 9h14v11H5V9zm2 2v3h3v-3H7z" },
  { href: "/accounts", label: "Accounts", icon: "M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4 0-9 2-9 6v2h18v-2c0-4-5-6-9-6z" },
];

export function Nav() {
  return <NavView pathname={usePathname()} />;
}

/** Pure navigation markup; also used (with an empty pathname) as the Suspense fallback while the URL is read. */
export function NavView({ pathname }: { pathname: string }) {
  if (pathname === "/login" || pathname === "/privacy" || pathname === "/terms" || pathname === "/data-deletion") return null;
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <>
      {/* Desktop / tablet sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-band px-3 py-6 text-band-text md:flex">
        <Link href="/" className="mb-8 flex items-center gap-2.5 rounded-control px-3 py-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" width={32} height={32} className="h-8 w-8 rounded-[8px]" />
          <span className="text-lg font-bold">Dapur Konten</span>
        </Link>
        <nav className="flex flex-col gap-1">
          {items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              aria-current={isActive(it.href) ? "page" : undefined}
              className={`relative flex min-h-11 items-center gap-3 rounded-control px-3 text-sm font-semibold transition-colors ${
                isActive(it.href)
                  ? "bg-white/10 text-band-text before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-accent"
                  : "text-band-muted hover:bg-white/5 hover:text-band-text"
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden>
                <path d={it.icon} />
              </svg>
              {it.label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Phone bottom tab bar */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 bg-band text-band-text shadow-[0_-4px_16px_rgba(8,17,42,0.18)] md:hidden">
        <div className="grid grid-cols-5">
          {items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              aria-current={isActive(it.href) ? "page" : undefined}
              className={`relative flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
                isActive(it.href)
                  ? "text-band-text before:absolute before:inset-x-6 before:top-0 before:h-1 before:rounded-b-full before:bg-accent"
                  : "text-band-muted hover:text-band-text"
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-hidden>
                <path d={it.icon} />
              </svg>
              {it.label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
