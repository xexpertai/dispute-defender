"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Disputes" },
  { href: "/insights", label: "Insights" },
  { href: "/outcomes", label: "Outcomes" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="mx-auto flex w-full max-w-6xl gap-1 px-2 sm:px-4">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" || path.startsWith("/disputes") : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium ${active ? "border-primary text-ink" : "border-transparent text-muted hover:text-ink"}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
