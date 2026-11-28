"use client";

import { useEffect } from "react";
import { classifyLink, track } from "@/lib/track";

/**
 * Privacy-respecting conversion analytics.
 *
 * Off unless NEXT_PUBLIC_VERCEL_ANALYTICS is "1" AND Web Analytics is switched on for the
 * marketing project in the Vercel dashboard (Project > Analytics > Enable). When on, it loads
 * Vercel's first-party script (/_vercel/insights/script.js): cookieless, no personal data, no
 * new dependency and no paid service beyond the plan the site already runs on.
 *
 * One delegated click listener records "Book a demo" clicks (any link to the contact page) and
 * WhatsApp clicks (any wa.me link). A link can name where it sits with data-source.
 * Form submissions are recorded by the form itself (components/ContactForm).
 */
const ENABLED = process.env.NEXT_PUBLIC_VERCEL_ANALYTICS === "1";

export function Analytics() {
  useEffect(() => {
    if (!ENABLED) return;
    const w = window as unknown as { va?: (...a: unknown[]) => void; vaq?: unknown[][] };
    // Queue events fired before the script arrives; the script drains the queue.
    w.va = w.va || ((...a: unknown[]) => { (w.vaq = w.vaq || []).push(a); });
    if (!document.querySelector('script[data-tp-analytics]')) {
      const s = document.createElement("script");
      s.src = "/_vercel/insights/script.js";
      s.defer = true;
      s.dataset.tpAnalytics = "";
      document.head.appendChild(s);
    }

    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const kind = classifyLink(a.getAttribute("href") || "");
      if (!kind) return;
      track(kind, { source: a.dataset.source || "link", page: window.location.pathname });
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);
  return null;
}
