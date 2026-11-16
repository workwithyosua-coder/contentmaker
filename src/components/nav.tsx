"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Dashboard", icon: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" },
  { href: "/insights", label: "Insights", icon: "M9 21h6v-1H9v1zm3-19a7 7 0 0 0-4 12.74V17h8v-2.26A7 7 0 0 0 12 2z" },
  { href: "/create", label: "Create", icon: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" },
  { href: "/accounts", label: "Accounts", icon: "M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4 0-9 2-9 6v2h18v-2c0-4-5-6-9-6z" },
];

export function Nav() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <>
      {/* Desktop / tablet sidebar */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-surface px-3 py-6 md:flex">
        <div className="mb-8 flex items-center gap-2 px-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent font-bold text-accent-contrast">S</span>
          <span className="text-lg font-semibold">Studio</span>
        </div>
        <nav className="flex flex-col gap-1">
          {items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive(it.href) ? "bg-surface-2 text-text" : "text-muted hover:bg-surface-2 hover:text-text"
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
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur md:hidden">
        <div className="grid grid-cols-4">
          {items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${
                isActive(it.href) ? "text-accent" : "text-muted"
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
