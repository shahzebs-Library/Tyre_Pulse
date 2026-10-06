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
export function Tabs({ items, label, className = "tabbar" }: { items: TabItem[]; label: string; className?: string }) {
  const [active, setActive] = useState(0);
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const bar = useRef<HTMLDivElement | null>(null);
  const [fade, setFade] = useState("");

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
    <div>
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
