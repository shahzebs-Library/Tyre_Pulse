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
   * Baseline security headers on every response. The Content-Security-Policy is
   * deliberately script-agnostic: Next.js inlines its bootstrap scripts, and a strict
   * script-src needs nonces, which would force every page off static prerendering.
   * The directives below restrict only what the site never does (plugins, a foreign
   * <base>, posting forms off-site, being framed) and so cannot break a page.
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
          {
            key: "Content-Security-Policy",
            value: "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        ],
      },
      /**
       * Preview and project hosts (tyre-pulse-eezl.vercel.app and every *.vercel.app deployment
       * URL) serve the same pages as www.tyrepulse.app. They must never be indexed, or search
       * engines see duplicate copies of the site. The header is sent only on those hosts, so
       * the real domain is unaffected and no Vercel dashboard change is needed.
       */
      {
        source: "/:path*",
        has: [{ type: "host", value: "(?<vercelhost>.+\\.vercel\\.app)" }],
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },

  async redirects() {
    return [
      // Preserve the legacy super-admin entry point on the marketing host.
      // This is an external redirect, not a proxy: the application serves its
      // own isolated console authentication and MFA on the app origin.
      { source: "/console", destination: `${APP_URL}/console`, permanent: false },
      { source: "/console/:path*", destination: `${APP_URL}/console/:path*`, permanent: false },
      // Legal pages live in the application. The store listings (Google Play
      // privacy policy and account deletion links) were registered on this
      // host before it moved to the marketing site, so they must keep working.
      { source: "/privacy", destination: `${APP_URL}/privacy`, permanent: false },
      { source: "/privacy-policy", destination: `${APP_URL}/privacy`, permanent: false },
      { source: "/terms", destination: `${APP_URL}/terms`, permanent: false },
      { source: "/terms-of-service", destination: `${APP_URL}/terms`, permanent: false },
      { source: "/data-deletion", destination: `${APP_URL}/data-deletion`, permanent: false },
      { source: "/delete-account", destination: `${APP_URL}/data-deletion`, permanent: false },
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
