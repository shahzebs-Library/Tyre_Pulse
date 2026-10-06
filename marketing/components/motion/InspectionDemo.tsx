"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, CloudUpload, Pause, PenLine, Play, QrCode, ScanLine, Wrench } from "lucide-react";

/**
 * A short, silent product scene: one walk-round inspection on the phone,
 * from scanning the machine to the work order it raises.
 *
 * Drawn in HTML and CSS (no video file), so it is sharp at every size, weighs
 * a few kilobytes and stays readable by assistive technology. It plays only
 * while on screen and while the tab is visible. Reduced motion never
 * auto-advances: the steps stay as buttons the visitor can press. It also
 * holds while the pointer or keyboard focus is inside it, and a visible
 * Pause control stops it for touch users (WCAG 2.2.2).
 * Every value is illustrative sample data and the scene says so.
 */
const STEPS = [
  { id: "scan", icon: QrCode, title: "Scan the machine", text: "The QR on the cab opens the right asset, its site and its checklist." },
  { id: "tyres", icon: ScanLine, title: "Check every wheel", text: "Each position is marked on the diagram. A damaged tyre turns red." },
  { id: "photo", icon: Camera, title: "Photo the defect", text: "The picture is attached to that wheel, with the time and place." },
  { id: "sign", icon: PenLine, title: "Sign it off", text: "The inspector signs on the glass. No paper, no re-typing." },
  { id: "sync", icon: CloudUpload, title: "Synced, job raised", text: "Back in signal, it uploads and the workshop gets a work order." },
] as const;

const STEP_MS = 3200;

/** Wheel layout for a 6x4 transit mixer, top-down: steer pair, then two dual rear axles. */
const WHEELS = [
  { id: "LHF1", x: 14, y: 14, s: "good" }, { id: "RHF1", x: 74, y: 14, s: "good" },
  { id: "LHR1", x: 8, y: 66, s: "bad" }, { id: "LHR1i", x: 20, y: 66, s: "good" },
  { id: "RHR1i", x: 68, y: 66, s: "good" }, { id: "RHR1", x: 80, y: 66, s: "good" },
  { id: "LHR2", x: 8, y: 92, s: "good" }, { id: "LHR2i", x: 20, y: 92, s: "good" },
  { id: "RHR2i", x: 68, y: 92, s: "good" }, { id: "RHR2", x: 80, y: 92, s: "good" },
];

export function InspectionDemo() {
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(false);
  const [held, setHeld] = useState(false);
  const [paused, setPaused] = useState(false);
  const running = auto && !held && !paused;
  const rootRef = useRef<HTMLDivElement>(null);

  // Auto-play only when on screen, the tab is visible and motion is welcome.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!("IntersectionObserver" in window)) return;
    let onScreen = false;
    const sync = () => setAuto(onScreen && !document.hidden);
    const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; sync(); }, { threshold: 0.35 });
    io.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => { io.disconnect(); document.removeEventListener("visibilitychange", sync); };
  }, []);

  useEffect(() => {
    if (!running) return;
    const t = window.setTimeout(() => setStep((s) => (s + 1) % STEPS.length), STEP_MS);
    return () => window.clearTimeout(t);
  }, [running, step]);

  const pick = useCallback((i: number) => setStep(i), []);
  const current = STEPS[step];

  return (
    <div
      className="idemo"
      ref={rootRef}
      data-step={current.id}
      onPointerEnter={(e) => { if (e.pointerType === "mouse") setHeld(true); }}
      onPointerLeave={(e) => { if (e.pointerType === "mouse") setHeld(false); }}
      onFocus={() => setHeld(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false); }}
    >
      <figure className="phone idemo-phone" aria-label={`Sample inspection on the mobile app, step ${step + 1} of ${STEPS.length}: ${current.title}`}>
        <div className="phone-status" aria-hidden="true"><span>07:42</span><span className="notch" /><span>{current.id === "sync" ? "5G" : "No signal"}</span></div>
        <div className="phone-screen idemo-screen" aria-hidden="true">
          <div className="ph-head"><strong>Daily inspection</strong><span className="sample-tag">Sample data</span></div>
          <div className="idemo-progress"><span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>

          <div className={`idemo-pane${step === 0 ? " is-on" : ""}`}>
            <div className="idemo-scan"><QrCode size={46} /><i className="idemo-beam" /></div>
            <div className="idemo-asset">
              <b>TM514</b><span>Transit mixer · NHC</span><span>Last inspected 1 day ago</span>
            </div>
          </div>

          <div className={`idemo-pane${step === 1 ? " is-on" : ""}`}>
            <svg className="idemo-truck" viewBox="0 0 100 112">
              <rect x="30" y="4" width="40" height="22" rx="4" className="cab" />
              <rect x="34" y="30" width="32" height="76" rx="6" className="body" />
              {WHEELS.map((w, i) => (
                <rect key={w.id} x={w.x} y={w.y} width="11" height="18" rx="3" className={`wheel ${w.s}`} style={{ animationDelay: `${i * 0.18}s` }} />
              ))}
            </svg>
            <div className="idemo-flag"><span className="dot" />LHR1 · Sidewall cut</div>
          </div>

          <div className={`idemo-pane${step === 2 ? " is-on" : ""}`}>
            <div className="idemo-cam"><Camera size={34} /><i className="idemo-flash" /></div>
            <div className="idemo-thumbs"><span className="t1" /><span className="t2" /><em>LHR1 · 2 photos</em></div>
          </div>

          <div className={`idemo-pane${step === 3 ? " is-on" : ""}`}>
            <span className="muted-xs">Inspector signature</span>
            <div className="sig-pad idemo-sig">
              <svg viewBox="0 0 160 60"><path d="M8 44 C 20 10, 30 10, 28 40 S 44 58, 52 24 S 66 8, 70 38 C 72 50, 82 50, 90 30 C 96 18, 104 22, 104 34 C 104 44, 118 40, 150 30" /></svg>
            </div>
            <span className="muted-xs">Ahmed K. · 07:46</span>
          </div>

          <div className={`idemo-pane${step === 4 ? " is-on" : ""}`}>
            <div className="idemo-done"><CheckCircle2 size={40} /><b>Inspection synced</b></div>
            <div className="idemo-wo"><Wrench size={14} /><span><b>WO-2026-0418</b> raised for LHR1</span></div>
          </div>
        </div>
      </figure>

      <ol className="idemo-steps">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <li key={s.id}>
              <button type="button" className={i === step ? "is-on" : ""} aria-current={i === step ? "step" : undefined} onClick={() => pick(i)}>
                <span className="idemo-n" aria-hidden="true"><Icon size={18} /></span>
                <span><b>{s.title}</b><span>{s.text}</span></span>
                {i === step && running && <i className="idemo-timer" style={{ animationDuration: `${STEP_MS}ms` }} aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ol>
      {auto && (
        <button type="button" className="idemo-toggle" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
          {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
          {paused ? "Play the walk-through" : "Pause the walk-through"}
        </button>
      )}
    </div>
  );
}
