"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./ThemeProvider";

export default function SiteHeader() {
  const pathname = usePathname();
  return <header className="website-header">
    <div className="website-brand"><Link className="brand" href="/" aria-label="Pixel Art Studio home">
      <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span>Pixel Art Studio</span>
    </Link></div>
    <nav aria-label="Main navigation">
      <Link className={`nav-link ${pathname === "/" ? "active" : ""}`} aria-current={pathname === "/" ? "page" : undefined} href="/">Studio</Link>
      <Link className={`nav-link ${pathname.startsWith("/events") ? "active" : ""}`} aria-current={pathname.startsWith("/events") ? "page" : undefined} href="/events">Competitions</Link>
      <Link className="nav-link" href="/events#public-challenges">Public Challenges</Link>
    </nav>
    <div className="website-actions"><ThemeToggle /></div>
  </header>;
}
