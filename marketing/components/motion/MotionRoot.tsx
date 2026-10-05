"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * One scroll-reveal engine for the whole site, mounted once in the root layout.
 *
 * Pages stay server components: they never import motion code. This finds the
 * blocks worth revealing by class name (plus anything marked data-reveal) and
 * arms only the ones BELOW the fold at mount time. So:
 *  - with JavaScript off, or before hydration, everything is simply visible;
 *  - nothing already on screen is hidden and re-shown (no flicker);
 *  - reduced-motion visitors are never armed at all.
 *
 * Groups reveal their children in sequence (a stagger) when the group enters.
 * IntersectionObserver only: no scroll listeners.
 */

/** Blocks that rise in as one unit. */
const SINGLES = [
  ".sec-h", ".split", ".overview", ".insp-hero", ".people", ".tab-intro",
  ".cta-band-inner", ".form-card", ".page-content > .site-shell > .panel",
  ".anchor-sec", ".proof-head", ".ar-split", "[data-reveal]",
].join(",");

/** Containers whose direct children rise one after another. */
const GROUPS = [
  ".bento", ".eco-grid", ".sec-list", ".ind-list", ".flow", ".faq-list",
  ".price-grid", ".grid-3p", ".grid-4p", ".ar-steps", ".proof-stats", "[data-reveal-group]",
].join(",");

const STEP_MS = 70;
const MAX_STEPS = 7;

export function MotionRoot() {
  const pathname = usePathname();

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!("IntersectionObserver" in window)) return;

    const fold = window.innerHeight * 0.9;
    const below = (el: Element) => el.getBoundingClientRect().top > fold;
    const armed = new Set<Element>();

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );

    // Groups first, so a single inside an armed group is not armed twice.
    document.querySelectorAll(GROUPS).forEach((group) => {
      if (group.parentElement?.closest(".rv-group, .rv")) return;
      if (!below(group)) {
        group.classList.add("is-in");
        return;
      }
      group.classList.add("rv-group");
      Array.from(group.children).forEach((child, i) => {
        (child as HTMLElement).style.setProperty("--rv-delay", `${Math.min(i, MAX_STEPS) * STEP_MS}ms`);
      });
      armed.add(group);
      io.observe(group);
    });

    document.querySelectorAll(SINGLES).forEach((el) => {
      if (el.parentElement?.closest(".rv-group, .rv") || el.classList.contains("rv-group")) return;
      if (!below(el)) return;
      el.classList.add("rv");
      armed.add(el);
      io.observe(el);
    });

    return () => {
      io.disconnect();
      // Disarm: a client-side navigation (or a dev remount) re-scans from scratch,
      // and an element that is no longer armed is simply visible.
      armed.forEach((el) => el.classList.remove("rv", "rv-group"));
    };
  }, [pathname]);

  return null;
}
