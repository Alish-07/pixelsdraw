import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main-content" tabIndex={-1} className="page-shell not-found-page">
      <section className="competition">
        <p className="eyebrow">404 · Missing pixel</p>
        <h1>That page is not on the canvas.</h1>
        <p>This link may have changed or expired. Let&apos;s get you back to creating.</p>
        <div className="not-found-actions">
          <Link className="primary-button button-link" href="/">Open the drawing studio</Link>
          <Link className="text-button button-link" href="/events">Go to competitions</Link>
        </div>
      </section>
    </main>
  );
}
