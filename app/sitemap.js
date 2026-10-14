import { allowIndexing, siteUrl } from "@/lib/site-config.mjs";

export default function sitemap() {
  if (!allowIndexing()) return [];
  return [{ url: siteUrl(), changeFrequency: "weekly", priority: 1 }, { url: `${siteUrl()}/events`, changeFrequency: "daily", priority: .8 }];
}
