import Link from "next/link";
import { SITE_NAME } from "@/lib/site-config.mjs";

export default function PolicyPage({ title, introduction, children }) {
  return <main id="main-content" tabIndex={-1} className="policy-page">
    <Link href="/">← Back to the studio</Link>
    <header>
      <p className="eyebrow">{SITE_NAME}</p>
      <h1>{title}</h1>
      <p className="policy-date">Last updated: October 15, 2026</p>
      <p>{introduction}</p>
    </header>
    {children}
  </main>;
}
