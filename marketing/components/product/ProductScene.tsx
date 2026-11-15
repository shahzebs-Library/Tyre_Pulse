"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CircleDot, Gauge, Pause, Play, Truck, Wrench, type LucideIcon } from "lucide-react";
import { AXLES, ASSET, WHEELS } from "./data";
import "./product.css";

/* Sample figures. The trend arrays are the last twelve weeks, oldest first. */
type Kpi = { id: string; icon: LucideIcon; label: string; value: string; sub: string; trend: number[]; unit: string; delta: string; goodDown?: boolean };
const KPIS: Kpi[] = [
  { id: "avail", icon: Truck, label: "Machines available", value: "142", sub: "of 168", trend: [131, 133, 130, 134, 136, 135, 138, 137, 139, 140, 141, 142], unit: "machines", delta: "+11 in 12 weeks" },
  { id: "wo", icon: Wrench, label: "Open work orders", value: "28", sub: "12 high priority", trend: [41, 39, 40, 36, 37, 34, 33, 35, 31, 30, 29, 28], unit: "jobs", delta: "13 fewer in 12 weeks", goodDown: true },
  { id: "tyres", icon: CircleDot, label: "Tyres due in 30 days", value: "46", sub: "9 past expected life", trend: [38, 40, 43, 41, 44, 47, 45, 48, 50, 49, 47, 46], unit: "tyres", delta: "+8 in 12 weeks" },
  { id: "cpk", icon: Gauge, label: "Tyre cost per km", value: "0.041", sub: "SAR, last 12 months", trend: [46, 46, 45, 45, 44, 44, 43, 43, 42, 42, 41, 41], unit: "SAR x 0.001", delta: "11% lower in 12 weeks", goodDown: true },
];

const FEED = [
  ["07:42", "MX-214 inspected in Riyadh", "A. Khan"],
  ["07:44", "LHR1-O sidewall cut flagged, photo attached", "High"],
  ["08:05", "WO-2026-0418 raised and approved", "Supervisor"],
  ["08:12", "Assigned to the tyre bay", "R. Ali"],
  ["09:31", "New tyre fitted on LHR1-O", "RM-2611-044"],
  ["09:40", "MX-214 back in service", "Down 1 h 58"],
] as const;

const DUE = [
  ["MX-214", "RHR1-O", "DX-4471-205", "84%"], ["PT-118", "LHF1", "KT-3310-552", "91%"],
  ["WL-207", "RHF1", "OT-7702-014", "88%"], ["MX-231", "LHR2-I", "DX-4902-118", "86%"],
] as const;

const JOBS = [
  ["WO-2026-0418", "MX-214", "Tyre replacement", "In progress"], ["WO-2026-0417", "GN-305", "Fuel filter service", "Waiting for parts"],
  ["WO-2026-0415", "PT-118", "Boom hose leak", "Assigned"], ["WO-2026-0411", "WL-207", "Bucket teeth", "Quality check"],
] as const;

const TABS = [["activity", "Activity"], ["tyres", "Tyres due"], ["jobs", "Work orders"]] as const;

function sparkPath(v: number[], w = 260, h = 56) {
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  return v.map((y, i) => `${i ? "L" : "M"}${((i / (v.length - 1)) * w).toFixed(1)} ${(h - 4 - ((y - min) / span) * (h - 8)).toFixed(1)}`).join(" ");
}

/**
 * The home hero scene: the web Command Center with the field app in front of it.
 * It is a working recreation, not a picture. The tiles open their trend, the tabs
 * switch, and the activity feed ticks. The feed stops off screen, in a hidden
 * tab, under reduced motion and when the visitor presses pause.
 */
export function ProductScene() {
  const uid = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [kpi, setKpi] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("activity");
  const [tick, setTick] = useState(2);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Feed ticker: only while on screen, visible, allowed and not paused.
  useEffect(() => {
    if (paused || reduced || tab !== "activity") return;
    let onScreen = true;
    const io = "IntersectionObserver" in window ? new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; }) : null;
    if (ref.current) io?.observe(ref.current);
    const t = window.setInterval(() => { if (!document.hidden && onScreen) setTick((n) => (n + 1) % FEED.length); }, 2400);
    return () => { window.clearInterval(t); io?.disconnect(); };
  }, [paused, reduced, tab]);

  // Gentle depth on a real mouse: two layers shift a few pixels against each other.
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--px", (((e.clientX - r.left) / r.width - 0.5) * 2).toFixed(3));
        el.style.setProperty("--py", (((e.clientY - r.top) / r.height - 0.5) * 2).toFixed(3));
      });
    };
    const leave = () => { el.style.setProperty("--px", "0"); el.style.setProperty("--py", "0"); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => { cancelAnimationFrame(raf); el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave); };
  }, [reduced]);

  const open = KPIS.find((k) => k.id === kpi);
  const rows = Array.from({ length: 4 }, (_, i) => FEED[(tick - i + FEED.length * 2) % FEED.length]);

  return (
    <div className="pd-scene" ref={ref}>
      <figure className="pd-web" aria-label="Sample Command Center screen from the Tyre Pulse web app">
        <div className="pd-chrome" aria-hidden="true"><i /><i /><i /><span>Command Center</span></div>
        <div className="pd-web-body">
          <div className="pd-web-head">
            <span><b>Good morning</b><small>Riyadh · all sites · today</small></span>
            <span className="sample-tag">Sample data</span>
          </div>
          <div className="pd-kpis">
            {KPIS.map((k) => (
              <button key={k.id} type="button" className={`pd-kpi${kpi === k.id ? " is-on" : ""}`} aria-expanded={kpi === k.id} aria-controls={`${uid}-trend`} onClick={() => setKpi(kpi === k.id ? null : k.id)}>
                <span className="pd-kpi-ic" aria-hidden="true"><k.icon size={16} /></span>
                <span className="pd-kpi-v">{k.value}</span>
                <span className="pd-kpi-l">{k.label}</span>
                <span className="pd-kpi-s">{k.sub}</span>
              </button>
            ))}
          </div>
          <div id={`${uid}-trend`} className="pd-trend" hidden={!open}>
            {open && (
              <>
                <div className="pd-trend-h"><b>{open.label}, last 12 weeks</b><span className="pd-pill is-good">{open.delta}</span></div>
                <svg key={open.id} viewBox="0 0 260 56" preserveAspectRatio="none" role="img" aria-label={`${open.label} over the last 12 weeks, from ${open.trend[0]} to ${open.trend[11]} ${open.unit}`}>
                  <path className="pd-spark" d={sparkPath(open.trend)} />
                </svg>
              </>
            )}
          </div>
          <div className="pd-tabrow">
          <div className="pd-tabs" role="tablist" aria-label="Command Center panels">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" role="tab" id={`${uid}-t-${id}`} aria-selected={tab === id} aria-controls={`${uid}-p`} tabIndex={tab === id ? 0 : -1} className={tab === id ? "is-on" : undefined}
                onClick={() => setTab(id)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                  const i = TABS.findIndex(([t]) => t === tab);
                  const n = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length][0];
                  setTab(n);
                  document.getElementById(`${uid}-t-${n}`)?.focus();
                }}>{label}</button>
            ))}
          </div>
            {tab === "activity" && !reduced && (
              <button type="button" className="pd-pause" aria-label={paused ? "Play the activity feed" : "Pause the activity feed"} onClick={() => setPaused(!paused)}>
                {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
              </button>
            )}
          </div>
          <div className="pd-panel" id={`${uid}-p`} role="tabpanel" aria-labelledby={`${uid}-t-${tab}`}>
            {tab === "activity" && (
              <ol className="pd-feed">
                {rows.map(([time, text, meta], i) => <li key={`${time}-${text}`} className={i === 0 ? "is-new" : undefined}><time>{time}</time><span>{text}</span><em>{meta}</em></li>)}
              </ol>
            )}
            {tab === "tyres" && (
              <table className="pd-table"><thead><tr><th>Asset</th><th>Position</th><th>Serial</th><th>Life used</th></tr></thead>
                <tbody>{DUE.map(([a, p, s, l]) => <tr key={s}><td>{a}</td><td>{p}</td><td>{s}</td><td><span className="pd-pill is-warn">{l}</span></td></tr>)}</tbody></table>
            )}
            {tab === "jobs" && (
              <table className="pd-table"><thead><tr><th>Job</th><th>Asset</th><th>Work</th><th>Status</th></tr></thead>
                <tbody>{JOBS.map(([n, a, w, s]) => <tr key={n}><td>{n}</td><td>{a}</td><td>{w}</td><td><span className="pd-pill">{s}</span></td></tr>)}</tbody></table>
            )}
          </div>
        </div>
      </figure>

      <figure className="pd-phone" aria-label={`Sample field app screen: tyre inspection of ${ASSET.code} with one wheel flagged`}>
        <div className="pd-phone-top" aria-hidden="true"><span>9:41</span><span>Saved on phone</span></div>
        <div className="pd-phone-h"><b>Tyre inspection</b><small>{ASSET.code} · {ASSET.site}</small></div>
        <div className="pd-truck is-mini" aria-hidden="true">
          <span className="pd-truck-body" />
          {AXLES.map((axle, i) => (
            <div key={i} className={`pd-axle pd-axle-${axle.length}`}>
              {axle.map((id) => { const x = WHEELS.find((t) => t.id === id)!; return <span key={id} className={`pd-wheel is-${x.tone}${x.tone === "bad" ? " is-pulse" : ""}`}><i /></span>; })}
            </div>
          ))}
        </div>
        <div className="pd-phone-row"><b>LHR1-O</b><span className="pd-pill is-bad">Sidewall cut</span></div>
        <div className="pd-phone-foot"><span>9 of 10 wheels checked</span><span className="sample-tag">Sample data</span></div>
      </figure>
    </div>
  );
}
