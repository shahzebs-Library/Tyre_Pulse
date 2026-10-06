"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell, Camera, CheckCircle2, ClipboardCheck, CircleDot, CloudUpload, LayoutDashboard, MapPin, Pause, PenLine,
  Play, QrCode, ScanLine, Truck, Wrench,
} from "lucide-react";
import { Photo } from "@/components/art/Photos";

/**
 * One walk-round inspection, told on two screens at once: an iPhone in the
 * inspector's hand and the web app the office is looking at. Each step on
 * the phone has a matching state on the web.
 *
 * It is interactive, like the real product: tap a wheel on the phone or a row
 * in the web table and both screens show that tyre. Any interaction pauses the
 * tour so the visitor can look around; the step buttons resume it.
 *
 * HTML, CSS and real photos only (no video). Plays only on screen with the tab
 * visible; reduced motion never auto-advances; a visible Pause control stops it
 * (WCAG 2.2.2). All values are illustrative sample data and both screens say so.
 */
const STEPS = [
  { id: "scan", icon: QrCode, title: "Scan the machine", text: "The QR on the cab opens the asset, its site, its tyre layout and its checklist." },
  { id: "tyres", icon: ScanLine, title: "Check every wheel", text: "Tread and pressure per position. Tap any wheel or row to see that tyre." },
  { id: "photo", icon: Camera, title: "Photo the defect", text: "The picture is pinned to that wheel, with the time and the GPS point." },
  { id: "sign", icon: PenLine, title: "Sign it off", text: "The inspector signs on the glass. The supervisor sees it waiting to approve." },
  { id: "sync", icon: CloudUpload, title: "Synced, job raised", text: "Back in signal it uploads. The supervisor turns the finding into a work order in one click." },
] as const;

const STEP_MS = 2600;

type Tone = "good" | "warn" | "bad";
type Wheel = { id: string; x: number; y: number; serial: string; tread: number; psi: number; s: Tone; note: string };

/** 6x4 transit mixer, top-down: steer pair, then two dual drive axles. */
const WHEELS: Wheel[] = [
  { id: "LHF1", x: 14, y: 14, serial: "2436326847", tread: 11.2, psi: 120, s: "good", note: "Good" },
  { id: "RHF1", x: 74, y: 14, serial: "2436326851", tread: 11.0, psi: 119, s: "good", note: "Good" },
  { id: "LHR1", x: 8, y: 66, serial: "YMA55312", tread: 4.1, psi: 98, s: "bad", note: "Sidewall cut" },
  { id: "LHR1i", x: 20, y: 66, serial: "YMA55318", tread: 8.6, psi: 117, s: "good", note: "Good" },
  { id: "RHR1i", x: 68, y: 66, serial: "YMA55306", tread: 8.9, psi: 118, s: "good", note: "Good" },
  { id: "RHR1", x: 80, y: 66, serial: "YMA55309", tread: 6.2, psi: 116, s: "warn", note: "Watch wear" },
  { id: "LHR2", x: 8, y: 92, serial: "YMA60221", tread: 9.1, psi: 118, s: "good", note: "Good" },
  { id: "LHR2i", x: 20, y: 92, serial: "YMA60224", tread: 9.0, psi: 117, s: "good", note: "Good" },
  { id: "RHR2i", x: 68, y: 92, serial: "YMA60219", tread: 8.8, psi: 118, s: "good", note: "Good" },
  { id: "RHR2", x: 80, y: 92, serial: "YMA60230", tread: 8.7, psi: 119, s: "good", note: "Good" },
];
const TABLE_IDS = ["LHR1", "RHR1", "LHF1", "RHF1", "LHR2"];
const TONE_PILL: Record<Tone, string> = { good: "green", warn: "amber", bad: "red" };
const TONE_LABEL: Record<Tone, string> = { good: "Good", warn: "Watch", bad: "Cut" };

/** Tyre cost per km on TM514, last six months (SAR). */
const CPK = [["May", 0.046], ["Jun", 0.044], ["Jul", 0.045], ["Aug", 0.042], ["Sep", 0.043], ["Oct", 0.041]] as const;
/** Tread on LHR1 at the last five inspections (mm). */
const WEAR = [7.8, 6.9, 6.0, 5.1, 4.1];

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
  return <div className={`idemo-pane ${className}${on ? " is-on" : ""}`} aria-hidden={!on} inert={!on}>{children}</div>;
}

function CpkBars() {
  const max = 0.05;
  return (
    <figure className="idemo-chart" aria-label="Tyre cost per km, last six months, falling from 0.046 to 0.041 SAR">
      <figcaption><span>Tyre cost / km</span><b>SAR 0.041</b><em>-11% in 6 months</em></figcaption>
      <div className="idemo-bars" aria-hidden="true">
        {CPK.map(([m, v], i) => (
          <div key={m} className={i === CPK.length - 1 ? "last" : undefined}>
            <span className="val">{v.toFixed(3)}</span>
            <i style={{ height: `${(v / max) * 100}%`, animationDelay: `${i * 0.05}s` }} />
            <span className="m">{m}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

function WearLine() {
  const lo = 2, hi = 9;
  const top = (mm: number) => ((hi - mm) / (hi - lo)) * 100;
  const left = (i: number) => 4 + i * (92 / (WEAR.length - 1));
  const pts = WEAR.map((mm, i) => `${left(i)},${top(mm)}`).join(" ");
  return (
    <figure className="idemo-chart" aria-label="Tread on LHR1 at the last five inspections, from 7.8 down to 4.1 mm, limit 3 mm">
      <figcaption><span>Tread on LHR1</span><b>4.1 mm</b><em className="warn">Reaches 3 mm in about 5 weeks</em></figcaption>
      <div className="idemo-line" aria-hidden="true">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <line x1="0" x2="100" y1={top(3)} y2={top(3)} className="limit" vectorEffect="non-scaling-stroke" />
          <polyline points={pts} className="wear" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="limit-t" style={{ top: `${top(3)}%` }}>Limit 3 mm</span>
        {WEAR.map((mm, i) => (
          <span key={i} className={`dot${i === WEAR.length - 1 ? " last" : ""}`} style={{ left: `${left(i)}%`, top: `${top(mm)}%` }}><em>{mm}</em></span>
        ))}
      </div>
    </figure>
  );
}

export function InspectionDemo() {
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(false);
  const [held, setHeld] = useState(false);
  const [paused, setPaused] = useState(false);
  const [sel, setSel] = useState("LHR1");
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

  /** Choosing a step is an explicit "carry on": it clears both the pause and the hover/focus hold. */
  const pick = useCallback((i: number) => { setStep(i); setPaused(false); setHeld(false); }, []);
  /** Exploring a tyre stops the tour so the visitor is not pulled away mid-look. */
  const choose = useCallback((id: string) => { setSel(id); setPaused(true); }, []);
  const current = STEPS[step];
  const at = (id: string) => current.id === id;
  const w = WHEELS.find((x) => x.id === sel) ?? WHEELS[2];

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
              <button type="button" className={i === step ? "is-on" : ""} aria-label={`Step ${i + 1}: ${s.title}`} aria-current={i === step ? "step" : undefined} onClick={() => pick(i)}>
                <span className="idemo-n" aria-hidden="true"><Icon size={17} /></span>
                <span className="idemo-st"><small>Step {i + 1}</small><b>{s.title}</b></span>
                {i === step && running && <i className="idemo-timer" style={{ animationDuration: `${STEP_MS}ms` }} aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ol>

      <p className="idemo-caption"><span aria-live="polite">{current.text}</span><span className="sample-tag">Sample data</span></p>

      <div className="idemo-stage">
        {/* ---------- iPhone: what the inspector does ---------- */}
        <figure className="iphone idemo-phone" aria-label={`Mobile app, step ${step + 1} of ${STEPS.length}: ${current.title}`}>
          <span className="ip-btn ip-action" aria-hidden="true" /><span className="ip-btn ip-vol1" aria-hidden="true" />
          <span className="ip-btn ip-vol2" aria-hidden="true" /><span className="ip-btn ip-power" aria-hidden="true" />
          <div className="ip-screen">
            <div className="ip-status" aria-hidden="true">
              <span className="ip-time">9:41</span>
              <span className="ip-island" />
              <span className="ip-icons">
                <svg viewBox="0 0 18 12" className={`ip-signal${at("sync") ? "" : " off"}`}><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5.5" width="3" height="6.5" rx="1" /><rect x="10" y="3" width="3" height="9" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
                <svg viewBox="0 0 27 12" className="ip-batt"><rect x="0.5" y="0.5" width="23" height="11" rx="3.5" /><rect x="2.5" y="2.5" width="16" height="7" rx="2" className="fill" /><rect x="24.5" y="4" width="1.8" height="4" rx="1" className="fill" /></svg>
              </span>
            </div>
            <div className="ip-app">
              <div className="ph-head"><strong>Daily inspection</strong><span className={`idemo-net${at("sync") ? " on" : ""}`}>{at("sync") ? "Online" : "Offline"}</span></div>
              <div className="idemo-progress"><span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>

              <Pane on={at("scan")}>
                <div className="idemo-scan">
                  <Photo name="mixer" className="idemo-photo" sizes="240px" position="60% 50%" alt="" />
                  <span className="idemo-qr"><QrCode size={30} /></span><i className="idemo-beam" />
                </div>
                <div className="idemo-asset">
                  <b>TM514 <em>Transit mixer 6x4</em></b>
                  <span><MapPin size={10} /> NHC · 184,220 km</span>
                  <span>10 tyres · 315/80R22.5 · checked yesterday</span>
                </div>
              </Pane>

              <Pane on={at("tyres")}>
                <div className="idemo-veh">
                  <span className="idemo-veh-pic"><Photo name="mixer" className="idemo-photo" sizes="72px" position="60% 50%" alt="" /></span>
                  <span><b>TM514</b><small>Transit mixer 6x4 · 10 tyres</small></span>
                </div>
                <svg className="idemo-truck" viewBox="0 0 100 112" role="group" aria-label="Tyre map, tap a wheel">
                  <rect x="30" y="4" width="40" height="22" rx="4" className="cab" />
                  <rect x="34" y="30" width="32" height="76" rx="6" className="body" />
                  {WHEELS.map((x, i) => (
                    <rect
                      key={x.id} x={x.x} y={x.y} width="11" height="18" rx="3"
                      className={`wheel ${x.s}${sel === x.id ? " sel" : ""}`}
                      style={{ animationDelay: `${i * 0.08}s` }}
                      role="button" tabIndex={0} aria-label={`${x.id}: ${x.tread} mm, ${x.psi} psi, ${x.note}`}
                      onClick={() => choose(x.id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(x.id); } }}
                    />
                  ))}
                </svg>
                <div className={`idemo-reading ${w.s}`}><b>{w.id}</b><span>{w.tread} mm · {w.psi} psi</span><em>{w.note}</em></div>
                <span className="muted-xs idemo-hint">Tap a wheel</span>
              </Pane>

              <Pane on={at("photo")}>
                <div className="idemo-cam">
                  <Photo name="mixer" className="idemo-photo zoom-rear" sizes="480px" alt="" />
                  <i className="idemo-flash" /><span className="idemo-gps">24.774 N, 46.738 E · 07:44</span>
                </div>
                <div className="idemo-thumbs"><span className="t1"><Photo name="mixer" className="idemo-photo zoom-rear" sizes="96px" alt="" /></span><span className="t2"><Photo name="mixer" className="idemo-photo zoom-wide" sizes="96px" alt="" /></span><em>LHR1 · 2 photos</em></div>
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
                <div className="idemo-wo"><Wrench size={14} /><span>LHR1 finding sent to the supervisor</span></div>
              </Pane>
            </div>
            <span className="ip-home" aria-hidden="true" />
          </div>
        </figure>

        {/* ---------- Web: what the office sees ---------- */}
        <figure className="idemo-web" aria-label={`Web app, same step: ${current.title}`}>
          <div className="idemo-chrome" aria-hidden="true">
            <i /><i /><i />
            <span className="idemo-url">{WEB_URL[current.id]}</span>
            <span className="sample-tag">Sample data</span>
          </div>
          <div className="idemo-app">
            <aside className="idemo-side" aria-hidden="true">
              <div className="idemo-brand"><span />Tyre Pulse</div>
              {WEB_NAV.map(([name, Icon]) => (
                <span key={name} className={WEB_ACTIVE[current.id] === name ? "on" : undefined}><Icon size={12} />{name}</span>
              ))}
            </aside>
            <div className="idemo-main">
              <div className="idemo-top" aria-hidden="true"><span>NHC · Riyadh</span><Bell size={13} />{at("sync") && <i className="idemo-bell-dot" />}</div>

              <Pane on={at("scan")} className="web">
                <div className="idemo-asset-web">
                  <span className="idemo-asset-pic"><Photo name="mixer" className="idemo-photo" sizes="120px" position="60% 50%" alt="Transit mixer TM514" /></span>
                  <div>
                    <div className="idemo-web-h"><b>TM514</b><span className="pill pill-green">In service</span></div>
                    <span className="muted-xs">Transit mixer 6x4 · NHC · 10 tyres</span>
                    <div className="idemo-kpis">
                      <div><small>Odometer</small><b>184,220 km</b></div>
                      <div><small>Open jobs</small><b>0</b></div>
                      <div><small>Next PM</small><b>12 Oct</b></div>
                    </div>
                  </div>
                </div>
                <CpkBars />
                <div className="idemo-live"><i />Ahmed K. opened this asset on mobile</div>
              </Pane>

              <Pane on={at("tyres")} className="web">
                <div className="idemo-web-h"><b>Tyres on TM514</b><span className="muted-xs">Click a row</span></div>
                <table className="idemo-table">
                  <thead><tr><th>Pos.</th><th>Serial</th><th>Tread</th><th>PSI</th><th>Status</th></tr></thead>
                  <tbody>
                    {TABLE_IDS.map((id) => {
                      const r = WHEELS.find((x) => x.id === id)!;
                      return (
                        <tr key={id} className={sel === id ? "sel" : undefined} tabIndex={0} aria-selected={sel === id}
                          onClick={() => choose(id)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(id); } }}>
                          <td>{id}</td><td>{r.serial}</td><td>{r.tread} mm</td><td>{r.psi}</td>
                          <td><span className={`pill pill-${TONE_PILL[r.s]}`}>{TONE_LABEL[r.s]}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="idemo-gauges">
                  <div><small>Tread {w.id}</small><span className="bar"><i className={w.s} style={{ width: `${Math.min(100, (w.tread / 14) * 100)}%` }} /></span><b>{w.tread} mm</b></div>
                  <div><small>Pressure vs truck median 118</small><span className="bar"><i className={w.s} style={{ width: `${Math.min(100, (w.psi / 130) * 100)}%` }} /></span><b>{w.psi} psi</b></div>
                </div>
              </Pane>

              <Pane on={at("photo")} className="web">
                <div className="idemo-web-h"><b>Defect · LHR1</b><span className="pill pill-red">High</span></div>
                <div className="idemo-defect">
                  <div className="idemo-photos">
                    <span className="t1"><Photo name="mixer" className="idemo-photo zoom-rear" sizes="180px" alt="Rear left wheel of TM514, close-up" /></span>
                    <span className="t2"><Photo name="mixer" className="idemo-photo zoom-wide" sizes="180px" alt="TM514 rear axles" /></span>
                  </div>
                  <ul>
                    <li><small>Finding</small>Sidewall cut, 4 cm</li>
                    <li><small>Pressure</small>98 psi, 17% under</li>
                    <li><small>Where</small>NHC gate 2 · 07:44</li>
                  </ul>
                </div>
                <WearLine />
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
                  <div><small>From</small>Inspection INS-3F9A21C0</div>
                  <div><small>Job</small>Replace tyre LHR1</div>
                  <div><small>Asset</small>TM514 · NHC</div>
                  <div><small>Cost</small>Added as parts and labour are booked</div>
                </div>
                <div className="idemo-live ok"><i />Raised by the supervisor from the finding · 07:52</div>
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
