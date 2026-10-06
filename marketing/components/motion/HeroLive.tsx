"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, CircleDot, ClipboardCheck, Gauge, PenLine, Truck, Wrench, type LucideIcon } from "lucide-react";

/**
 * Live cards for the home hero: they show work HAPPENING, one event after
 * another, instead of a still screenshot.
 *
 * Each card ticks only while its own hero slide is on screen, the tab is
 * visible and the visitor has not asked for reduced motion (reduced motion
 * shows one still frame). Every value is illustrative sample data.
 */
const ICONS: Record<string, LucideIcon> = {
  truck: Truck, wrench: Wrench, gauge: Gauge, check: CheckCircle2, tyre: CircleDot,
  camera: Camera, pen: PenLine, inspect: ClipboardCheck,
};

export type LiveEvent = { icon: keyof typeof ICONS; text: string; meta: string; tone?: "good" | "warn" | "bad" };

const TICK_MS = 1600;

/** Steps forward while the enclosing hero slide is the active one. */
function useTicker(length: number, ms: number, start = 0) {
  const ref = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(start);

  // Follows the reduced-motion setting live: turning it on stops the ticker,
  // turning it off starts it again, without a reload.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let t = 0;
    const tick = () => {
      if (document.hidden) return;
      const slide = ref.current?.closest(".hc-slide");
      const active = !slide || slide.classList.contains("is-on");
      setI((n) => (active ? (n + 1) % length : start));
    };
    const sync = () => {
      window.clearInterval(t);
      t = 0;
      if (!mq.matches) t = window.setInterval(tick, ms);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => { mq.removeEventListener("change", sync); window.clearInterval(t); };
  }, [length, ms, start]);

  return { ref, i };
}

/** A running activity feed: newest event slides in at the top, older ones fade down. */
export function LiveFeed({ title, events, rows = 4 }: { title: string; events: LiveEvent[]; rows?: number }) {
  // Starts on the fourth event so the first frame already reads as a running log.
  const { ref, i } = useTicker(events.length, TICK_MS, Math.min(3, events.length - 1));
  const shown = Array.from({ length: Math.max(1, Math.min(rows, events.length)) }, (_, k) => k).map((k) => events[(i - k + events.length * 4) % events.length]);
  return (
    <div className="live-feed" ref={ref} aria-hidden="true">
      <div className="live-head"><span className="live-dot" /><strong>{title}</strong><span className="sample-tag">Sample data</span></div>
      <ol>
        {shown.map((e, k) => {
          const Icon = ICONS[e.icon];
          return (
            <li key={`${i}-${k}`} className={`live-row tone-${e.tone ?? "good"}${k === 0 ? " is-new" : ""}`} style={{ opacity: 1 - k * 0.22 }}>
              <span className="live-ic"><Icon size={14} /></span>
              <span className="live-txt"><b>{e.text}</b><span>{e.meta}</span></span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

type AssetCard = { code: string; type: string; site: string; meter: string; status: string; tone: "good" | "warn" | "bad"; next: string; cost: string };

const ASSETS: AssetCard[] = [
  { code: "TM514", type: "Transit mixer", site: "NHC", meter: "6,240 h", status: "In service", tone: "good", next: "250 h", cost: "SAR 3,180" },
  { code: "MP093", type: "Concrete pump", site: "Diriyah", meter: "4,912 h", status: "In workshop", tone: "warn", next: "Due now", cost: "SAR 7,420" },
  { code: "WL012", type: "Wheel loader", site: "Qiddiya", meter: "9,105 h", status: "In service", tone: "good", next: "120 h", cost: "SAR 2,060" },
  { code: "GN041", type: "Generator", site: "Red Sea", meter: "12,880 h", status: "Breakdown", tone: "bad", next: "Overdue", cost: "SAR 5,890" },
];

/** One asset record at a time, rolling through the fleet. */
export function AssetCycle() {
  const { ref, i } = useTicker(ASSETS.length, 2300);
  const a = ASSETS[i];
  return (
    <div className="asset-cycle" ref={ref} aria-hidden="true">
      <div className="live-head"><span className="live-dot" /><strong>Fleet register</strong><span className="sample-tag">Sample data</span></div>
      <div className="ac-body" key={a.code}>
        <div className="ac-id"><Truck size={18} /><span><b>{a.code}</b><span>{a.type} · {a.site}</span></span><em className={`ac-pill tone-${a.tone}`}>{a.status}</em></div>
        <div className="ac-grid">
          <div><span>Meter</span><b>{a.meter}</b></div>
          <div><span>Next service</span><b>{a.next}</b></div>
          <div><span>Cost this month</span><b>{a.cost}</b></div>
        </div>
      </div>
      <div className="ac-dots">{ASSETS.map((x, k) => <i key={x.code} className={k === i ? "is-on" : ""} />)}</div>
    </div>
  );
}
