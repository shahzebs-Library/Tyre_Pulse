import { CalendarClock, Camera, CheckCircle2, FileText, MapPin, Wrench } from "lucide-react";
import { AXLES, ASSET, WHEELS } from "./data";

/**
 * The seven screens of the home page product story. Each one recreates the
 * part of the app that step happens in, with invented sample data. They are
 * static markup (no state), so they can render on the server and inside the
 * pinned stage alike. Charts draw in with CSS when their screen appears.
 */
function Frame({ kind, title, sub, children }: { kind: "phone" | "web"; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className={`ps-screen is-${kind}`}>
      <div className="ps-bar"><span><b>{title}</b><small>{sub}</small></span><span className="sample-tag">Sample data</span></div>
      <div className="ps-body">{children}</div>
    </div>
  );
}

function MiniTruck({ pulse = true }: { pulse?: boolean }) {
  return (
    <div className="pd-truck is-mini" aria-hidden="true">
      <span className="pd-truck-body" />
      {AXLES.map((axle, i) => (
        <div key={i} className={`pd-axle pd-axle-${axle.length}`}>
          {axle.map((id) => { const x = WHEELS.find((t) => t.id === id)!; return <span key={id} className={`pd-wheel is-${x.tone}${pulse && x.tone === "bad" ? " is-pulse" : ""}`}><i /></span>; })}
        </div>
      ))}
    </div>
  );
}

const SCREENS: React.ReactNode[] = [
  /* 1 Inspection */
  <Frame key="s1" kind="phone" title="Tyre inspection" sub={`${ASSET.code} · ${ASSET.site} · saved on the phone`}>
    <div className="ps-split">
      <MiniTruck />
      <ul className="ps-list">
        <li><span>Wheels checked</span><b>9 of 10</b></li>
        <li><span>Odometer</span><b>{ASSET.odo}</b></li>
        <li><span>Photos</span><b>2</b></li>
        <li><span>Signal</span><b>Offline, will sync</b></li>
      </ul>
    </div>
  </Frame>,
  /* 2 Defect */
  <Frame key="s2" kind="phone" title="LHR1-O" sub="Finding recorded 07:44">
    <div className="ps-defect">
      <div className="ps-photo" aria-hidden="true"><Camera size={22} /><span>Photo pinned to this wheel</span></div>
      <ul className="ps-list">
        <li><span>Condition</span><b><span className="pd-pill is-bad">Sidewall cut</span></b></li>
        <li><span>Pressure</span><b>98 psi</b></li>
        <li><span>Vehicle median</span><b>118 psi</b></li>
        <li><span>Serial</span><b>DX-4471-208</b></li>
        <li><span><MapPin size={13} aria-hidden="true" /> Location</span><b>Riyadh yard</b></li>
      </ul>
    </div>
  </Frame>,
  /* 3 Root cause */
  <Frame key="s3" kind="web" title="Root cause" sub="DX-4471-208 · LHR1-O">
    <ul className="ps-rca">
      <li className="is-on"><b>Run under-inflated</b><span>Pressure 17% under the vehicle median at two inspections in a row.</span></li>
      <li><b>Kerb or debris impact</b><span>Cut is on the outer sidewall of an outer dual.</span></li>
      <li><b>Manufacturing defect</b><span>No other tyre of this batch shows it.</span></li>
    </ul>
    <p className="ps-note"><CheckCircle2 size={15} aria-hidden="true" /> Recorded by the tyre supervisor with a corrective action: weekly pressure check on outer duals.</p>
  </Frame>,
  /* 4 Work order */
  <Frame key="s4" kind="web" title="WO-2026-0418" sub="Tyre replacement · MX-214">
    <ol className="ps-flow">
      <li className="is-done">Raised<small>07:52</small></li>
      <li className="is-done">Approved<small>08:05</small></li>
      <li className="is-done">Assigned<small>08:12</small></li>
      <li className="is-now">In progress<small>08:40</small></li>
      <li>Verified</li>
    </ol>
    <ul className="ps-list">
      <li><span><Wrench size={13} aria-hidden="true" /> Technician</span><b>R. Ali, tyre bay</b></li>
      <li><span>Part issued</span><b>1 x 315/80R22.5, Riyadh store</b></li>
      <li><span>Priority</span><b><span className="pd-pill is-warn">High</span></b></li>
    </ul>
  </Frame>,
  /* 5 Replacement */
  <Frame key="s5" kind="phone" title="Tyre change" sub={`${ASSET.code} · LHR1-O · ${ASSET.odo}`}>
    <div className="ps-swap">
      <div><small>Removed</small><b>DX-4471-208</b><span>Brand C · 61,240 km run</span><span className="pd-pill is-bad">Sidewall cut</span></div>
      <i aria-hidden="true" />
      <div><small>Fitted</small><b>RM-2611-044</b><span>Brand B · new</span><span className="pd-pill is-good">Active</span></div>
    </div>
    <p className="ps-note"><CheckCircle2 size={15} aria-hidden="true" /> One active tyre per wheel. The old tyre keeps its full history.</p>
  </Frame>,
  /* 6 Cost per km */
  <Frame key="s6" kind="web" title="Tyre cost per km" sub="315/80R22.5 · by brand · SAR">
    <div className="ps-bars" role="img" aria-label="Sample cost per km by brand: Brand B 0.036, Brand A 0.041, Brand C 0.052 riyals">
      {[["Brand B", 0.036, 69], ["Brand A", 0.041, 79], ["Brand C", 0.052, 100]].map(([n, v, w], i) => (
        <div key={String(n)} className={i === 0 ? "is-key" : undefined}><span>{n}</span><i style={{ ["--w" as string]: `${w}%`, ["--d" as string]: `${i * 90}ms` }} /><b>{Number(v).toFixed(3)}</b></div>
      ))}
    </div>
    <ul className="ps-list">
      <li><span>This tyre</span><b>SAR 0.048 per km</b></li>
      <li><span>Basis</span><b>Price paid / km run</b></li>
    </ul>
  </Frame>,
  /* 7 Management report */
  <Frame key="s7" kind="web" title="Tyre report, October" sub="Riyadh · scheduled">
    <div className="ps-report">
      <svg viewBox="0 0 64 64" role="img" aria-label="Sample removal reasons: worn out 58 percent, damage 27 percent, other 15 percent">
        <circle cx="32" cy="32" r="25" className="ps-donut-track" />
        <circle cx="32" cy="32" r="25" pathLength="100" className="ps-donut a" style={{ strokeDasharray: "58 100" }} />
        <circle cx="32" cy="32" r="25" pathLength="100" className="ps-donut b" style={{ strokeDasharray: "27 100", strokeDashoffset: -58 }} />
        <circle cx="32" cy="32" r="25" pathLength="100" className="ps-donut c" style={{ strokeDasharray: "15 100", strokeDashoffset: -85 }} />
      </svg>
      <ul className="ps-list">
        <li><span>Tyres removed</span><b>64</b></li>
        <li><span>Worn out</span><b>58%</b></li>
        <li><span>Damage</span><b>27%</b></li>
        <li><span>Cost per km</span><b>SAR 0.041</b></li>
      </ul>
    </div>
    <p className="ps-note"><CalendarClock size={15} aria-hidden="true" /> Emailed Mondays 07:00. <FileText size={15} aria-hidden="true" /> PDF, Excel, PowerPoint.</p>
  </Frame>,
];

export function StoryScreen({ step }: { step: number }) {
  return <>{SCREENS[step] ?? null}</>;
}
