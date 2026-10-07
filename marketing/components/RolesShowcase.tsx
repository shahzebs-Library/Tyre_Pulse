"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Monitor, Pause, Play, Smartphone, Tv, Bell, Check, Camera, Wrench, Package, ShieldAlert, Gauge } from "lucide-react";
import "./roles-showcase.css";

export type Role = {
  id: string; label: string; title: string; text: string;
  screen: string[]; kpis: [string, string][]; devices: ("phone" | "web" | "tv")[];
};

const STEP_MS = 5200;

const DEVICE: Record<Role["devices"][number], [typeof Smartphone, string]> = {
  phone: [Smartphone, "Phone, works offline"], web: [Monitor, "Web app"], tv: [Tv, "TV wallboard"],
};

/* Web app sidebar areas; each role lands on its own area. */
const AREAS = ["Dashboard", "Inspections", "Workshop", "Tyres", "Stores", "Accidents", "Reports"] as const;
const ROLE_AREA: Record<string, { area: (typeof AREAS)[number]; path: string }> = {
  driver: { area: "Inspections", path: "inspections" },
  tech: { area: "Workshop", path: "workshop/my-jobs" },
  tyre: { area: "Tyres", path: "tyres/map" },
  store: { area: "Stores", path: "stores/issues" },
  sup: { area: "Workshop", path: "workshop/live" },
  claims: { area: "Accidents", path: "accidents/cases" },
  pmv: { area: "Reports", path: "reports/availability" },
};
const ASSETS = ["MX-214", "PT-118", "GN-305", "WL-207"];
const CITIES = ["Riyadh", "Jeddah", "Dammam", "Dubai"];
const STATES: [string, "ok" | "warn" | "bad" | "info"][] = [["Done", "ok"], ["In progress", "info"], ["Waiting", "warn"], ["Due", "bad"]];

function WebWindow({ role }: { role: Role }) {
  const a = ROLE_AREA[role.id] ?? { area: "Dashboard" as const, path: "dashboard" };
  return (
    <div className="rs-web" aria-hidden="true">
      <div className="rs-chrome">
        <span className="rs-dots"><i /><i /><i /></span>
        <span className="rs-url">app.tyrepulse.app/{a.path}</span>
      </div>
      <div className="rs-app">
        <nav className="rs-side">
          <b className="rs-logo">TP</b>
          {AREAS.map((x) => <span key={x} className={x === a.area ? "on" : ""}>{x}</span>)}
        </nav>
        <div className="rs-main">
          <div className="rs-main-h"><strong>{a.area}</strong><span className="rs-tag">Sample data</span></div>
          <div className="rs-tiles">
            {role.kpis.map(([k, v]) => <div key={k}><small>{k}</small><b>{v}</b></div>)}
          </div>
          <div className="rs-rows">
            {role.screen.map((s, i) => (
              <div key={s} className="rs-row">
                <span className="rs-asset">{ASSETS[i % ASSETS.length]}</span>
                <span className="rs-rowtext">{s}</span>
                <span className="rs-city">{CITIES[i % CITIES.length]}</span>
                <span className={`rs-pill ${STATES[i][1]}`}>{STATES[i][0]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PhoneBody({ role }: { role: Role }) {
  switch (role.id) {
    case "driver":
      return (<>
        <p className="rs-ph-t">Pre-trip check · MX-214</p>
        {["Tyres and wheels", "Lights and mirrors", "Brakes", "Fluid levels"].map((x, i) => (
          <div key={x} className="rs-ph-check"><span className={i < 3 ? "y" : ""}>{i < 3 ? <Check size={11} /> : null}</span>{x}</div>
        ))}
        <div className="rs-ph-btn"><Camera size={12} /> Add photo</div>
      </>);
    case "tech":
      return (<>
        <p className="rs-ph-t">Job card · PT-118</p>
        <div className="rs-ph-card"><Wrench size={13} /><div><b>Hydraulic hose leak</b><small>Priority high · Jeddah</small></div></div>
        <div className="rs-ph-timer">01:42:10</div>
        <div className="rs-ph-two"><span>Pause: parts</span><span className="y">Finish</span></div>
      </>);
    case "tyre":
      return (<>
        <p className="rs-ph-t">Tyre map · MX-214</p>
        <div className="rs-ph-tyres">
          {["ok", "ok", "ok", "bad", "ok", "warn", "ok", "ok"].map((s, i) => <i key={i} className={s} />)}
        </div>
        <small className="rs-ph-note">Rear left inner: 84 psi, low</small>
      </>);
    case "store":
      return (<>
        <p className="rs-ph-t">Issue parts · GN-305</p>
        {[["Oil filter", "x2"], ["Fuel filter", "x1"], ["Fan belt", "x1"]].map(([p, q]) => (
          <div key={p} className="rs-ph-line"><Package size={12} /><span>{p}</span><b>{q}</b></div>
        ))}
        <div className="rs-ph-btn y">Issue to job card</div>
      </>);
    case "sup":
      return (<>
        <p className="rs-ph-t">Approvals · 5 waiting</p>
        {[["Inspection", "WL-207"], ["Job close", "PT-118"], ["Parts request", "GN-305"]].map(([k, v]) => (
          <div key={v} className="rs-ph-appr"><span><b>{k}</b><small>{v}</small></span><em>Approve</em></div>
        ))}
      </>);
    case "pmv":
      return (<>
        <p className="rs-ph-t">Fleet availability</p>
        <div className="rs-ph-gauge"><b>93%</b></div>
        <small className="rs-ph-note">Target 95% · 4 machines down</small>
      </>);
    default:
      return (<>
        <p className="rs-ph-t">Notification</p>
        <div className="rs-ph-notif"><ShieldAlert size={14} /><div><b>New accident case</b><small>WL-207 · Dammam · open on web</small></div></div>
        <small className="rs-ph-note">Case work is done in the web app.</small>
      </>);
  }
}

function SideDevice({ role }: { role: Role }) {
  const hasPhone = role.devices.includes("phone");
  if (!hasPhone && role.devices.includes("tv")) {
    return (
      <div className="rs-tv" aria-hidden="true">
        <div className="rs-tv-screen">
          <div className="rs-tv-h"><Gauge size={12} /> Wallboard · Riyadh</div>
          <div className="rs-tv-big">93%<small>availability</small></div>
          <div className="rs-tv-bars">{[70, 88, 93, 81, 95, 90].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div>
        </div>
        <span className="rs-tv-stand" />
      </div>
    );
  }
  return (
    <div className="rs-phone" aria-hidden="true">
      <div className="rs-ph-screen">
        <div className="rs-ph-bar"><span>9:41</span>{hasPhone ? <span>Offline ready</span> : <Bell size={10} />}</div>
        <PhoneBody role={role} />
      </div>
    </div>
  );
}

const RM = "(prefers-reduced-motion: reduce)";
function subscribeMotion(cb: () => void) {
  const m = window.matchMedia?.(RM);
  m?.addEventListener?.("change", cb);
  return () => m?.removeEventListener?.("change", cb);
}
function subscribeVis(cb: () => void) {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}

export function RolesShowcase({ roles }: { roles: Role[] }) {
  const [idx, setIdx] = useState(0);
  const [choice, setChoice] = useState<boolean | null>(null);
  const reduced = useSyncExternalStore(subscribeMotion, () => window.matchMedia?.(RM).matches ?? false, () => false);
  const visible = useSyncExternalStore(subscribeVis, () => document.visibilityState === "visible", () => true);
  const paused = choice ?? reduced;
  const [inView, setInView] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const running = !paused && inView && visible && roles.length > 1;
  const role = roles[idx] ?? roles[0];
  if (!role) return null;
  const next = () => setIdx((i) => (i + 1) % roles.length);

  return (
    <div className="rs" ref={rootRef} style={{ ["--rs-step" as string]: `${STEP_MS}ms` }}>
      <div className="rs-pick">
        <div className="rs-pick-list" role="group" aria-label="Choose a role">
          {roles.map((r, i) => (
            <button key={r.id} type="button" aria-pressed={i === idx} className={i === idx ? "on" : ""} onClick={() => setIdx(i)}>
              <span>{r.label}</span>
              {i === idx && (
                <span className="rs-prog" aria-hidden="true">
                  <span key={`${r.id}-${idx}`} className="rs-prog-fill" style={{ animationPlayState: running ? "running" : "paused" }} onAnimationEnd={next} />
                </span>
              )}
            </button>
          ))}
        </div>
        <button type="button" className="rs-play" onClick={() => setChoice(!paused)} aria-label={paused ? "Play role tour" : "Pause role tour"}>
          {paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
          {paused ? "Play" : "Pause"}
        </button>
      </div>

      <div className="rs-body" aria-live={running ? "off" : "polite"}>
        <div className="rs-stage" key={`stage-${role.id}`}>
          <WebWindow role={role} />
          <SideDevice role={role} />
        </div>
        <div className="rs-copy" key={`copy-${role.id}`}>
          <h3>{role.title}</h3>
          <p>{role.text}</p>
          <dl className="rs-kpis">
            {role.kpis.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
          <div className="rs-foot">
            <span className="rs-tag">Sample figures</span>
            <ul className="rs-chips" aria-label="Used on">
              {role.devices.map((d) => { const [Icon, l] = DEVICE[d]; return <li key={d}><Icon size={14} aria-hidden="true" />{l}</li>; })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RolesShowcase;
