import { allowIndexing, siteUrl } from "@/lib/site-config.mjs";

export default function robots() {
  if (!allowIndexing()) return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: "/", disallow: ["/account", "/drawings", "/events/", "/setup", "/lab"] }, sitemap: `${siteUrl()}/sitemap.xml` };
}
