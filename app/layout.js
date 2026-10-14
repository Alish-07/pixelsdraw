import "./globals.css";
import "./editor.css";
import "./theme.css";
import "./competition.css";
import SiteHeader from "@/components/SiteHeader";
import { ThemeProvider } from "@/components/ThemeProvider";
import { siteUrl, allowIndexing } from "@/lib/site-config.mjs";
import Script from "next/script";
import { THEME_BOOTSTRAP } from "@/lib/theme-config.mjs";

export const metadata = {
  title: "Pixel Art Studio",
  description: "Create pixel art and sprites, then join timed public challenges or host a competition.",
  metadataBase: new URL(siteUrl()),
  openGraph: { title: "Pixel Art Studio", description: "Draw pixel art, create sprites and join public challenges.", type: "website" },
  robots: {
    index: allowIndexing(),
    follow: allowIndexing(),
    googleBot: { index: allowIndexing(), follow: allowIndexing() },
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body><Script id="site-appearance" strategy="beforeInteractive">{THEME_BOOTSTRAP}</Script><ThemeProvider><a className="skip-link" href="#main-content">Skip to content</a><SiteHeader />{children}</ThemeProvider></body>
    </html>
  );
}
