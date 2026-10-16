const nextConfig = {
  agentRules: false,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ] }];
  },
  // Keep local production builds separate from a running dev server. Vercel's
  // Next.js adapter requires the framework-standard `.next` output directory.
  distDir: process.env.VERCEL
    ? ".next"
    : process.env.NODE_ENV === "production"
      ? ".next-build"
      : ".next",
};

export default nextConfig;
