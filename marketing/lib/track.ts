/**
 * Conversion hooks. Calls Vercel Web Analytics custom events only when the owner has
 * enabled it (components/Analytics loads the script and defines window.va). Otherwise every
 * call is a no-op: no dependency, no cookies, no network request, and a failure can never
 * break the page. Vercel Web Analytics is cookieless and collects no personal data.
 */
export type TrackEvent =
  | "demo_click"
  | "demo_request"
  | "quote_request"
  | "whatsapp_click"
  | "assistant_open"
  | "assistant_new_chat";

type Va = (kind: "event", payload: { name: string; data?: Record<string, string | number | boolean> }) => void;

export function track(name: TrackEvent, data?: Record<string, string | number | boolean>): void {
  if (typeof window === "undefined") return;
  const va = (window as unknown as { va?: Va }).va;
  if (typeof va !== "function") return;
  try {
    va("event", data ? { name, data } : { name });
  } catch {
    /* analytics must never affect the visitor */
  }
}

/**
 * What a click on a link counts as, if anything. Every "Book a demo" link points at the
 * contact page and every WhatsApp link at wa.me, so one delegated listener covers them all
 * and no link can be forgotten.
 */
export function classifyLink(href: string): TrackEvent | null {
  if (/^https:\/\/wa\.me\//.test(href)) return "whatsapp_click";
  try {
    const path = new URL(href, "https://www.tyrepulse.app").pathname.replace(/\/$/, "");
    if (path === "/contact" || path === "/ar/contact") return "demo_click";
  } catch { /* not a URL */ }
  return null;
}
