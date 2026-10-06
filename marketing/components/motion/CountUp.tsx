"use client";

import { useEffect, useRef } from "react";

/**
 * A number that counts up once when it scrolls into view.
 *
 * The server renders the final figure, so search engines and visitors without
 * JavaScript always see the real value. Screen readers read a hidden copy of
 * the final figure; the count only rewrites the visible text. Reduced motion
 * shows the final figure and never animates.
 */
export function CountUp({ value, suffix = "", duration = 1400 }: { value: number; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const final = `${value.toLocaleString("en-US")}${suffix}`;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!("IntersectionObserver" in window)) return;

    let frame = 0;
    const run = () => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        // Ease out quart: quick start, settles gently on the real figure.
        const eased = 1 - Math.pow(1 - t, 4);
        el.textContent = `${Math.round(value * eased).toLocaleString("en-US")}${suffix}`;
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      run();
    }, { threshold: 0.6 });
    io.observe(el);

    return () => { io.disconnect(); cancelAnimationFrame(frame); el.textContent = final; };
  }, [value, suffix, duration, final]);

  return (
    <span className="count">
      <span className="sr-only">{final}</span>
      <span ref={ref} aria-hidden="true">{final}</span>
    </span>
  );
}
