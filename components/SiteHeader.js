"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./ThemeProvider";
import BrandLogo from "./BrandLogo";

export default function SiteHeader() {
  const pathname = usePathname();
  return <header className="website-header">
    <BrandLogo />
    <nav aria-label="Main navigation">
      <Link className={`nav-link ${pathname === "/" ? "active" : ""}`} aria-current={pathname === "/" ? "page" : undefined} href="/">Studio</Link>
      <Link className={`nav-link ${pathname.startsWith("/events") ? "active" : ""}`} aria-current={pathname.startsWith("/events") ? "page" : undefined} href="/events">Competitions</Link>
      <Link className="nav-link" href="/events#public-challenges">Public Challenges</Link>
    </nav>
    <div className="website-actions"><ThemeToggle /></div>
  </header>;
}
