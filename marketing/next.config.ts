import type { NextConfig } from "next";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.tyrepulse.app").replace(/\/$/, "");

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
  async redirects() {
    return [
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
