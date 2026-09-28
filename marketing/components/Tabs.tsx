"use client";

import { useId, useRef, useState } from "react";

export type TabItem = { id: string; label: string; icon?: React.ReactNode; panel: React.ReactNode };

/**
 * WAI-ARIA tabs: one tab stop, arrow keys / Home / End move between tabs and
 * select them. Panels are rendered by the server page and passed in, so this
 * stays a thin client island.
 */
export function Tabs({ items, label, className = "tabbar" }: { items: TabItem[]; label: string; className?: string }) {
  const [active, setActive] = useState(0);
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (i: number) => {
    const next = (i + items.length) % items.length;
    setActive(next);
    refs.current[next]?.focus();
  };

  return (
    <div>
      <div className={className} role="tablist" aria-label={label}>
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
            onClick={() => setActive(i)}
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
