/**
 * The two host names the site depends on, defined once.
 *
 * They lived in four places before this file existed (app/schema.tsx,
 * components/Header.tsx, components/Footer.tsx and next.config.ts), and three
 * of those copies pointed at hosts that do not exist. Header and Footer are
 * client and server components respectively, and next.config.ts is loaded
 * outside the application module graph, so this module carries no JSX and no
 * React import: every one of them can pull it in without dragging anything
 * else along.
 */

/** This marketing site's own canonical origin. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.tyrepulse.app").replace(/\/$/, "");

/**
 * Where "Login" sends a visitor.
 *
 * This default is the host that serves the application TODAY, verified against
 * the live Vercel project: tyrepulse.app and www.tyrepulse.app both resolve to
 * the operational app, and they are the only domains configured on it. There is
 * no app.tyrepulse.app and no admin.tyrepulse.app. The previous default pointed
 * at app.tyrepulse.app, so the Login button in the header and the customer
 * login link in the footer were dead on every page of the site.
 *
 * README.md describes the intended split, in which this marketing site takes
 * www and the application moves to app.tyrepulse.app. On the day that happens,
 * set NEXT_PUBLIC_APP_URL=https://app.tyrepulse.app and nothing else changes.
 */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://www.tyrepulse.app").replace(/\/$/, "");
