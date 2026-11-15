"use client";

import { usePathname, useRouter } from "next/navigation";
import { startTransition, useEffect, useRef } from "react";

type VTDocument = Document & { startViewTransition?: (cb: () => Promise<void> | void) => { finished: Promise<void> } };

/**
 * Page-to-page transitions with the View Transitions API, as a progressive
 * enhancement over normal Next.js navigation.
 *
 * One click listener on the document catches plain left clicks on same-origin
 * page links. Where the browser supports document.startViewTransition, the
 * navigation runs inside it: the old page is held as a snapshot until the new
 * route has rendered, then the two cross-fade, while the header (and the page
 * title, see premium.css) keep their own transition names so they read as one
 * continuous element.
 *
 * Everything else is a normal navigation: browsers without the API, visitors who
 * asked for reduced motion, modified clicks, new-tab links, downloads, external
 * links and same-page anchors. If the new route is slow, the snapshot is
 * released after a short timeout so the page can never appear frozen.
 */
export function ViewTransitions() {
  const router = useRouter();
  const pathname = usePathname();
  const done = useRef<(() => void) | null>(null);

  // The new route has rendered: let the transition capture it.
  useEffect(() => {
    done.current?.();
    done.current = null;
  }, [pathname]);

  useEffect(() => {
    const doc = document as VTDocument;
    if (typeof doc.startViewTransition !== "function") return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || calm.matches) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download") || a.origin !== location.origin) return;
      if (a.pathname === location.pathname || a.pathname.startsWith("/api/")) return;
      e.preventDefault();
      const href = a.pathname + a.search + a.hash;
      doc.startViewTransition!(() => new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 1200);
        done.current = () => { window.clearTimeout(timer); resolve(); };
        startTransition(() => router.push(href));
      }));
    };
    // Capture phase: this must run before the Link's own click handler, which would
    // otherwise start the navigation outside the transition. Marking the event as
    // handled makes the Link stand down; its onClick props (closing a menu) still run.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);

  return null;
}
