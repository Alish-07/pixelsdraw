export const SITE_NAME = "PixelsDraw";
export const CURRENT_SITE = "https://pixel-art-studio-alpha-one.vercel.app";

// One environment value prepares metadata for the eventual custom domain.
// Sign-in still returns to the actual browser origin (production or localhost).
export function siteUrl(value = process.env.NEXT_PUBLIC_SITE_URL || CURRENT_SITE) {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("NEXT_PUBLIC_SITE_URL must use HTTPS (HTTP is allowed only for localhost).");
  }
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new Error("NEXT_PUBLIC_SITE_URL must be a site origin, without credentials, a path, query or fragment.");
  }
  return url.origin;
}

export function allowIndexing() {
  return process.env.NODE_ENV === "production" && process.env.VERCEL_ENV !== "preview" && process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true";
}
