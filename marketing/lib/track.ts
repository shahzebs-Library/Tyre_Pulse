/**
 * Conversion hooks. Calls Vercel Web Analytics custom events only when the owner has
 * enabled it (the script defines window.va). Otherwise every call is a no-op: no new
 * dependency, no cookies, no network request, and a failure can never break the page.
 */
export type TrackEvent = "demo_request" | "whatsapp_click" | "assistant_open" | "assistant_new_chat";

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
