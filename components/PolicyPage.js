import Link from "next/link";

export default function PolicyPage({ title, introduction, children }) {
  return <main id="main-content" tabIndex={-1} className="policy-page">
    <Link href="/">← Back to the studio</Link>
    <header>
      <p className="eyebrow">Pixel Art Studio</p>
      <h1>{title}</h1>
      <p className="policy-date">Last updated: October 14, 2026</p>
      <p>{introduction}</p>
    </header>
    {children}
  </main>;
}
