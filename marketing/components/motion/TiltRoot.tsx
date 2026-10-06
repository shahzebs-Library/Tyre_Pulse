"use client";

import { useEffect } from "react";

/**
 * 3D tilt for product screens, site-wide, from one delegated listener.
 *
 * Hosts (the hero visual, tab media, the people photo, the flow cards) lean
 * toward the mouse in perspective while the cards layered on top drift the
 * other way, so the screen reads as a physical object with depth. The pointer
 * position is written to two CSS variables (--tx, --ty, each -1..1) once per
 * animation frame; CSS does the transform. Mouse only: touch and pen keep the
 * resting pose. Reduced motion never attaches the listener.
 */
const HOSTS = ".hc-visual, .tab-media, .people-art, .flow > li";

export function TiltRoot() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    let host: HTMLElement | null = null;
    let frame = 0;
    let x = 0;
    let y = 0;

    const reset = (el: HTMLElement) => {
      el.classList.remove("is-tilting");
      el.style.setProperty("--tx", "0");
      el.style.setProperty("--ty", "0");
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const next = (e.target as Element | null)?.closest<HTMLElement>(HOSTS) ?? null;
      if (next !== host) {
        if (host) reset(host);
        host = next;
        host?.classList.add("is-tilting");
      }
      if (!host) return;
      const r = host.getBoundingClientRect();
      x = ((e.clientX - r.left) / r.width) * 2 - 1;
      y = ((e.clientY - r.top) / r.height) * 2 - 1;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!host) return;
        host.style.setProperty("--tx", x.toFixed(3));
        host.style.setProperty("--ty", y.toFixed(3));
      });
    };
    const onLeave = () => { if (host) reset(host); host = null; };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(frame);
      if (host) reset(host);
    };
  }, []);

  return null;
}
