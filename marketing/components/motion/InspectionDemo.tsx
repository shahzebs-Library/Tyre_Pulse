"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell, Camera, CheckCircle2, ClipboardCheck, CircleDot, CloudUpload, LayoutDashboard, MapPin, Pause, PenLine,
  Play, QrCode, ScanLine, Truck, Wrench,
} from "lucide-react";

/**
 * One walk-round inspection, told on two screens at once: the phone in the
 * inspector's hand and the web app the workshop is looking at. Each step on
 * the phone has a matching state on the web, so the visitor sees what the
 * office gets, not only what the field captures.
 *
 * HTML and CSS only (no video), sharp at every size, readable by assistive
 * technology. Plays only on screen with the tab visible; reduced motion never
 * auto-advances; holds while hovered or focused; a visible Pause control
 * stops it for touch users (WCAG 2.2.2). Every value is illustrative sample
 * data shaped like a real transit-mixer record, and both screens say so.
 */
const STEPS = [
  { id: "scan", icon: QrCode, title: "Scan the machine", text: "The QR on the cab opens the asset, its site, its tyre layout and its checklist." },
  { id: "tyres", icon: ScanLine, title: "Check every wheel", text: "Tread and pressure per position. A cut or low reading turns the wheel red." },
  { id: "photo", icon: Camera, title: "Photo the defect", text: "The picture is pinned to that wheel, with the time and the GPS point." },
  { id: "sign", icon: PenLine, title: "Sign it off", text: "The inspector signs on the glass. The supervisor sees it waiting to approve." },
  { id: "sync", icon: CloudUpload, title: "Synced, job raised", text: "Back in signal it uploads, and the workshop gets a priced work order." },
] as const;

const STEP_MS = 3600;

type Wheel = { id: string; x: number; y: number; tread: number; psi: number; s: "good" | "warn" | "bad" };

/** 6x4 transit mixer, top-down: steer pair, then two dual drive axles. */
const WHEELS: Wheel[] = [
  { id: "LHF1", x: 14, y: 14, tread: 11.2, psi: 120, s: "good" }, { id: "RHF1", x: 74, y: 14, tread: 11.0, psi: 119, s: "good" },
  { id: "LHR1", x: 8, y: 66, tread: 4.1, psi: 98, s: "bad" }, { id: "LHR1i", x: 20, y: 66, tread: 8.6, psi: 117, s: "good" },
  { id: "RHR1i", x: 68, y: 66, tread: 8.9, psi: 118, s: "good" }, { id: "RHR1", x: 80, y: 66, tread: 6.2, psi: 116, s: "warn" },
  { id: "LHR2", x: 8, y: 92, tread: 9.1, psi: 118, s: "good" }, { id: "LHR2i", x: 20, y: 92, tread: 9.0, psi: 117, s: "good" },
  { id: "RHR2i", x: 68, y: 92, tread: 8.8, psi: 118, s: "good" }, { id: "RHR2", x: 80, y: 92, tread: 8.7, psi: 119, s: "good" },
];

const TYRE_ROWS = [
  { pos: "LHR1", serial: "YMA55312", tread: "4.1 mm", psi: "98", s: "Cut", tone: "red" },
  { pos: "RHR1", serial: "YMA55309", tread: "6.2 mm", psi: "116", s: "Watch", tone: "amber" },
  { pos: "LHF1", serial: "2436326847", tread: "11.2 mm", psi: "120", s: "Good", tone: "green" },
  { pos: "RHF1", serial: "2436326851", tread: "11.0 mm", psi: "119", s: "Good", tone: "green" },
] as const;

const WEB_NAV = [["Overview", LayoutDashboard], ["Assets", Truck], ["Inspections", ClipboardCheck], ["Tyres", CircleDot], ["Workshop", Wrench]] as const;
const WEB_ACTIVE: Record<string, string> = { scan: "Assets", tyres: "Tyres", photo: "Inspections", sign: "Inspections", sync: "Workshop" };
const WEB_URL: Record<string, string> = {
  scan: "app.tyrepulse.app/assets/TM514",
  tyres: "app.tyrepulse.app/assets/TM514/tyres",
  photo: "app.tyrepulse.app/inspections/INS-3F9A21C0",
  sign: "app.tyrepulse.app/approvals",
  sync: "app.tyrepulse.app/work-orders/WO-2026-0418",
};

function Pane({ on, children, className = "" }: { on: boolean; children: React.ReactNode; className?: string }) {
  return <div className={`idemo-pane ${className}${on ? " is-on" : ""}`}>{children}</div>;
}

export function InspectionDemo() {
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(false);
  const [held, setHeld] = useState(false);
  const [paused, setPaused] = useState(false);
  const running = auto && !held && !paused;
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!("IntersectionObserver" in window)) return;
    let onScreen = false;
    const sync = () => setAuto(onScreen && !document.hidden);
    const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; sync(); }, { threshold: 0.3 });
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
  const at = (id: string) => current.id === id;

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
      <ol className="idemo-steps">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <li key={s.id}>
              <button type="button" className={i === step ? "is-on" : ""} aria-current={i === step ? "step" : undefined} onClick={() => pick(i)}>
                <span className="idemo-n" aria-hidden="true"><Icon size={17} /></span>
                <span className="idemo-st"><small>Step {i + 1}</small><b>{s.title}</b></span>
                {i === step && running && <i className="idemo-timer" style={{ animationDuration: `${STEP_MS}ms` }} aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ol>

      <p className="idemo-caption" aria-live="polite">{current.text}</p>

      <div className="idemo-stage">
        {/* ---------- Phone: what the inspector does ---------- */}
        <figure className="phone idemo-phone" aria-label={`Mobile app, step ${step + 1} of ${STEPS.length}: ${current.title}`}>
          <div className="phone-status" aria-hidden="true"><span>07:42</span><span className="notch" /><span>{at("sync") ? "5G" : "No signal"}</span></div>
          <div className="phone-screen idemo-screen" aria-hidden="true">
            <div className="ph-head"><strong>Daily inspection</strong><span className="sample-tag">Sample data</span></div>
            <div className="idemo-progress"><span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>

            <Pane on={at("scan")}>
              <div className="idemo-scan"><QrCode size={46} /><i className="idemo-beam" /></div>
              <div className="idemo-asset">
                <b>TM514 <em>Transit mixer 6x4</em></b>
                <span><MapPin size={10} /> NHC · 184,220 km</span>
                <span>10 tyres · 315/80R22.5 · last checked yesterday</span>
              </div>
            </Pane>

            <Pane on={at("tyres")}>
              <svg className="idemo-truck" viewBox="0 0 100 112">
                <rect x="30" y="4" width="40" height="22" rx="4" className="cab" />
                <rect x="34" y="30" width="32" height="76" rx="6" className="body" />
                {WHEELS.map((w, i) => (
                  <rect key={w.id} x={w.x} y={w.y} width="11" height="18" rx="3" className={`wheel ${w.s}`} style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </svg>
              <div className="idemo-reading bad"><b>LHR1</b><span>4.1 mm · 98 psi</span><em>Sidewall cut</em></div>
              <div className="idemo-reading warn"><b>RHR1</b><span>6.2 mm · 116 psi</span><em>Watch</em></div>
            </Pane>

            <Pane on={at("photo")}>
              <div className="idemo-cam"><Camera size={34} /><i className="idemo-flash" /><span className="idemo-gps">24.774 N, 46.738 E</span></div>
              <div className="idemo-thumbs"><span className="t1" /><span className="t2" /><em>LHR1 · 2 photos · 07:44</em></div>
            </Pane>

            <Pane on={at("sign")}>
              <span className="muted-xs">Inspector signature</span>
              <div className="sig-pad idemo-sig">
                <svg viewBox="0 0 160 60"><path d="M8 44 C 20 10, 30 10, 28 40 S 44 58, 52 24 S 66 8, 70 38 C 72 50, 82 50, 90 30 C 96 18, 104 22, 104 34 C 104 44, 118 40, 150 30" /></svg>
              </div>
              <span className="muted-xs">Ahmed K. · 07:46 · 10 of 10 wheels checked</span>
            </Pane>

            <Pane on={at("sync")}>
              <div className="idemo-done"><CheckCircle2 size={40} /><b>Inspection synced</b><span className="muted-xs">2 photos, 1 signature uploaded</span></div>
              <div className="idemo-wo"><Wrench size={14} /><span><b>WO-2026-0418</b> raised for LHR1</span></div>
            </Pane>
          </div>
        </figure>

        {/* ---------- Web: what the office sees ---------- */}
        <figure className="idemo-web" aria-label={`Web app, same step: ${current.title}`}>
          <div className="idemo-chrome" aria-hidden="true">
            <i /><i /><i />
            <span className="idemo-url">{WEB_URL[current.id]}</span>
            <span className="sample-tag">Sample data</span>
          </div>
          <div className="idemo-app" aria-hidden="true">
            <aside className="idemo-side">
              <div className="idemo-brand"><span />Tyre Pulse</div>
              {WEB_NAV.map(([name, Icon]) => (
                <span key={name} className={WEB_ACTIVE[current.id] === name ? "on" : undefined}><Icon size={12} />{name}</span>
              ))}
            </aside>
            <div className="idemo-main">
              <div className="idemo-top"><span>NHC · Riyadh</span><Bell size={13} />{at("sync") && <i className="idemo-bell-dot" />}</div>

              <Pane on={at("scan")} className="web">
                <div className="idemo-web-h"><b>TM514</b><span className="pill pill-green">In service</span></div>
                <div className="idemo-kpis">
                  <div><small>Odometer</small><b>184,220 km</b></div>
                  <div><small>Tyre cost / km</small><b>SAR 0.041</b></div>
                  <div><small>Open jobs</small><b>0</b></div>
                  <div><small>Next PM</small><b>12 Oct</b></div>
                </div>
                <div className="idemo-live"><i />Inspector Ahmed K. opened this asset on mobile</div>
              </Pane>

              <Pane on={at("tyres")} className="web">
                <div className="idemo-web-h"><b>Tyres on TM514</b><span className="muted-xs">Live from the walk-round</span></div>
                <table className="idemo-table">
                  <thead><tr><th>Pos.</th><th>Serial</th><th>Tread</th><th>PSI</th><th>Status</th></tr></thead>
                  <tbody>
                    {TYRE_ROWS.map((r) => (
                      <tr key={r.pos}><td>{r.pos}</td><td>{r.serial}</td><td>{r.tread}</td><td>{r.psi}</td><td><span className={`pill pill-${r.tone}`}>{r.s}</span></td></tr>
                    ))}
                  </tbody>
                </table>
              </Pane>

              <Pane on={at("photo")} className="web">
                <div className="idemo-web-h"><b>Defect · LHR1</b><span className="pill pill-red">High</span></div>
                <div className="idemo-defect">
                  <div className="idemo-photos"><span className="t1" /><span className="t2" /></div>
                  <ul>
                    <li><small>Finding</small>Sidewall cut, 4 cm</li>
                    <li><small>Pressure</small>98 psi, 17% under this truck</li>
                    <li><small>Tread</small>4.1 mm left</li>
                    <li><small>Where</small>NHC gate 2 · 07:44</li>
                  </ul>
                </div>
              </Pane>

              <Pane on={at("sign")} className="web">
                <div className="idemo-web-h"><b>Waiting for approval</b><span className="pill pill-amber">1 new</span></div>
                <div className="idemo-approval">
                  <div><b>INS-3F9A21C0 · TM514</b><span>Ahmed K. signed at 07:46 · 2 findings</span></div>
                  <span className="yellow-btn">Approve</span>
                </div>
                <div className="idemo-approval dim">
                  <div><b>INS-3F9A1B77 · MP093</b><span>Approved by area manager · 07:12</span></div>
                  <span className="pill pill-green">Approved</span>
                </div>
              </Pane>

              <Pane on={at("sync")} className="web">
                <div className="idemo-web-h"><b>WO-2026-0418</b><span className="pill pill-blue">New</span></div>
                <div className="idemo-wo-web">
                  <div><small>Asset</small>TM514 · NHC</div>
                  <div><small>Job</small>Replace tyre LHR1</div>
                  <div><small>Part</small>315/80R22.5 · 1 pc</div>
                  <div><small>Estimate</small>SAR 1,450</div>
                </div>
                <div className="idemo-live ok"><i />Workshop NHC notified · raised 07:47</div>
              </Pane>
            </div>
          </div>
        </figure>
      </div>

      {auto && (
        <button type="button" className="idemo-toggle" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
          {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
          {paused ? "Play the walk-through" : "Pause the walk-through"}
        </button>
      )}
    </div>
  );
}
