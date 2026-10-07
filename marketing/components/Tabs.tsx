"use client";

import { useEffect, useId, useRef, useState } from "react";

export type TabItem = { id: string; label: string; icon?: React.ReactNode; panel: React.ReactNode };

/**
 * WAI-ARIA tabs: one tab stop, arrow keys / Home / End move between tabs and
 * select them. Panels are rendered by the server page and passed in, so this
 * stays a thin client island.
 *
 * When the labels do not fit (narrow screens) the bar becomes a scroll strip: the
 * scrollbar is hidden, the edge that still has tabs behind it fades out, and the
 * selected tab is brought into view. `data-fade` carries "start", "end" or both,
 * measured in reading direction so the fade is correct in Arabic too.
 */
export function Tabs({ items, label, className = "tabbar", autoplay, wrapClass }: { items: TabItem[]; label: string; className?: string; autoplay?: number; wrapClass?: string }) {
  const [active, setActive] = useState(0);
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const bar = useRef<HTMLDivElement | null>(null);
  const [fade, setFade] = useState("");
  const root = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [hold, setHold] = useState(false);
  // A keyboard user takes over: auto-advance stops for good so focus never jumps.
  const [stopped, setStopped] = useState(false);

  // Optional auto-advance: only while on screen, the page is visible and the
  // visitor is not hovering or focused inside; never under reduced motion.
  useEffect(() => {
    if (!autoplay || !root.current || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.35 });
    io.observe(root.current);
    return () => io.disconnect();
  }, [autoplay]);

  useEffect(() => {
    if (!autoplay || !visible || hold || stopped) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setTimeout(() => {
      if (document.hidden) return;
      setActive((a) => (a + 1) % items.length);
    }, autoplay);
    return () => window.clearTimeout(t);
  }, [autoplay, visible, hold, stopped, active, items.length]);

  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 1) { setFade(""); return; }
      // Chromium/Firefox report a negative scrollLeft in RTL, so use its magnitude.
      const pos = Math.abs(el.scrollLeft);
      const parts = [pos > 1 ? "start" : "", pos < max - 1 ? "end" : ""].filter(Boolean);
      setFade(parts.join(" "));
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", measure); ro.disconnect(); };
  }, []);

  const select = (i: number, focus: boolean) => {
    setActive(i);
    const tab = refs.current[i];
    if (!tab) return;
    if (focus) tab.focus({ preventScroll: true });
    tab.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const move = (i: number) => select((i + items.length) % items.length, true);

  return (
    <div
      ref={root}
      className={[autoplay ? "tabs-auto" : "", wrapClass ?? ""].filter(Boolean).join(" ") || undefined}
      data-playing={autoplay && visible && !hold && !stopped ? "" : undefined}
      style={autoplay ? { ["--tab-ms" as string]: `${autoplay}ms` } : undefined}
      onPointerEnter={autoplay ? () => setHold(true) : undefined}
      onPointerLeave={autoplay ? () => setHold(false) : undefined}
      onKeyDown={autoplay ? () => setStopped(true) : undefined}
    >
      <div ref={bar} className={className} role="tablist" aria-label={label} data-fade={fade || undefined}>
        {items.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el; }}
            role="tab"
            type="button"
            id={`${base}-tab-${t.id}`}
            aria-selected={i === active}
            aria-controls={`${base}-panel-${t.id}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => select(i, false)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") { e.preventDefault(); move(i + 1); }
              else if (e.key === "ArrowLeft") { e.preventDefault(); move(i - 1); }
              else if (e.key === "Home") { e.preventDefault(); move(0); }
              else if (e.key === "End") { e.preventDefault(); move(items.length - 1); }
            }}
          >
            {t.icon}{t.label}
            {autoplay && i === active && <span key={active} className="tab-prog" aria-hidden="true" />}
          </button>
        ))}
      </div>
      {items.map((t, i) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${base}-panel-${t.id}`}
          aria-labelledby={`${base}-tab-${t.id}`}
          hidden={i !== active}
          tabIndex={0}
        >
          {t.panel}
        </div>
      ))}
    </div>
  );
}
