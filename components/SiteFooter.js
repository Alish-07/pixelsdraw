import Link from "next/link";
import { SITE_NAME } from "@/lib/site-config.mjs";

export default function SiteFooter() {
  return <footer className="website-footer">
    <span>{SITE_NAME} · Beta</span>
    <nav aria-label="Site information">
      <Link href="/privacy">Privacy</Link>
      <Link href="/terms">Terms & community rules</Link>
      <a href="mailto:alishpandey07@gmail.com">Contact</a>
    </nav>
  </footer>;
}
