import type { NextConfig } from "next";

import { APP_URL } from "./lib/site";

const nextConfig: NextConfig = {
  // This standalone app must not inherit the operational web app's tooling.
  turbopack: { root: __dirname },
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
  },

  /**
   * PWA rescue redirect.
   *
   * The Tyre Pulse application is an installed PWA whose manifest declares a
   * host-relative start_url of "/?source=pwa" and a scope of "/". Every copy
   * already installed on a field phone is therefore bound to this host. When the
   * marketing site takes www.tyrepulse.app, those installed apps would launch
   * into this marketing homepage instead of the application, and staff would
   * have to uninstall and reinstall to recover.
   *
   * So any request carrying the PWA start_url marker is handed straight to the
   * application, path and query preserved. This runs on the server before any
   * paint and costs no client JavaScript, and it is deliberately a temporary
   * 307 rather than a permanent 308: a browser must never cache this hop, so a
   * normal visitor who arrives with that parameter for some other reason is
   * never trapped on the redirect after it is removed.
   *
   * Doing this here rather than in a page keeps every marketing route
   * statically prerendered, which reading searchParams in app/page.tsx would
   * have forfeited.
   */
  /**
   * Baseline security headers on every response. No Content-Security-Policy yet:
   * Next.js inlines its bootstrap scripts, and a strict policy needs nonces, which
   * would force every page off static prerendering. frame-ancestors-style
   * protection comes from X-Frame-Options instead.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        ],
      },
    ];
  },

  async redirects() {
    return [
      // /product was replaced by the platform section on 2026-09-28.
      { source: "/product", destination: "/platform", permanent: true },
      {
        source: "/:path*",
        has: [{ type: "query", key: "source", value: "pwa" }],
        destination: `${APP_URL}/:path*`,
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
