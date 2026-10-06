import { BadgeCheck, CheckCircle2, FileText, MapPin, ShieldAlert, Users, Wallet } from "lucide-react";
import { Photo } from "@/components/art/Photos";
import { HBars, Notice, Pane, tap, type Scenario, type SceneProps } from "./shared";

/** Each team owns its own part of the case. */
const TEAMS = [
  { id: "fleet", name: "Fleet", state: "Done", tone: "green", work: "Vehicle checked, replacement truck sent", pct: 100 },
  { id: "hse", name: "HSE", state: "In progress", tone: "amber", work: "Root cause due 09 Oct: reversing in a blind spot", pct: 60 },
  { id: "ins", name: "Insurance", state: "Waiting", tone: "blue", work: "8 of 8 claim documents ready, sent to insurer", pct: 80 },
  { id: "ws", name: "Workshop", state: "In progress", tone: "amber", work: "Front bumper and left lamp, repair approved", pct: 50 },
  { id: "fin", name: "Finance", state: "Not started", tone: "grey", work: "Opens when the claim is settled", pct: 0 },
];
const team = (sel: string) => TEAMS.find((t) => t.id === sel) ?? TEAMS[1];

/** Damage zones on the outline, front-left marked. */
const ZONES = [
  { id: "fl", d: "M18 10 h22 v16 h-22 z", hit: true }, { id: "fr", d: "M60 10 h22 v16 h-22 z", hit: false },
  { id: "l", d: "M14 30 h10 v58 h-10 z", hit: true }, { id: "r", d: "M76 30 h10 v58 h-10 z", hit: false },
  { id: "rear", d: "M28 92 h44 v14 h-44 z", hit: false },
];

function Phone({ step, sel }: SceneProps) {
  return (
    <>
      <Pane on={step === "report"}>
        <div className="idemo-cam">
          <Photo name="mixer" className="idemo-photo zoom-front" sizes="480px" alt="" />
          <span className="wt-marker" style={{ left: "52%", top: "58%" }} />
          <span className="idemo-gps">24.712 N, 46.675 E · 10:14</span>
        </div>
        <div className="idemo-asset">
          <b>MX-152 <em>Transit mixer · Riyadh</em></b>
          <span><MapPin size={10} /> Plate, driver and site filled from the asset</span>
          <span className="wt-row"><span className="pill pill-amber">Moderate</span><span className="pill pill-grey">4 photos</span></span>
        </div>
      </Pane>
      <Pane on={step === "damage"}>
        <span className="muted-xs">Tap where it is damaged</span>
        <svg className="wt-outline" viewBox="0 0 100 112" aria-hidden="true">
          <rect x="24" y="6" width="52" height="100" rx="8" className="shell" />
          {ZONES.map((z) => <path key={z.id} d={z.d} className={z.hit ? "hit" : ""} />)}
        </svg>
        <div className="idemo-reading bad"><b>Front left</b><span>Bumper, lamp</span><em>Moderate</em></div>
      </Pane>
      <Pane on={step === "teams"}>
        <Notice title={`Task for ${team(sel).name}`} body={team(sel).work} when="2 min" />
        <div className="idemo-asset"><b>ACC-2026-0148</b><span>Your part: {team(sel).name}</span><span className="wt-row"><span className={`pill pill-${team(sel).tone}`}>{team(sel).state}</span></span></div>
      </Pane>
      <Pane on={step === "claim"}>
        <Notice title="Claim approved" body="ACC-2026-0148 · insurer approved SAR 15,900" when="now" />
        <div className="idemo-reading good"><b>Claim</b><span>Approved by insurer</span><em>SAR 15,900</em></div>
      </Pane>
      <Pane on={step === "close"}>
        <div className="idemo-done"><CheckCircle2 size={40} /><b>Case closed</b><span className="muted-xs">12 days, every team signed off</span></div>
      </Pane>
    </>
  );
}

function Web({ step, sel, choose }: SceneProps) {
  const t = team(sel);
  return (
    <>
      <Pane on={step === "report"} className="web">
        <div className="idemo-web-h"><b>Accident register</b><span className="muted-xs">This month</span></div>
        <table className="idemo-table">
          <thead><tr><th>Case</th><th>Asset</th><th>Site</th><th>Severity</th><th>Days</th></tr></thead>
          <tbody>
            <tr className="sel"><td>ACC-2026-0148</td><td>MX-152</td><td>Riyadh</td><td><span className="pill pill-amber">Moderate</span></td><td>0</td></tr>
            <tr><td>ACC-2026-0147</td><td>PT-118</td><td>Dammam</td><td><span className="pill pill-grey">Minor</span></td><td>6</td></tr>
            <tr><td>ACC-2026-0145</td><td>BH-041</td><td>Jeddah</td><td><span className="pill pill-red">Major</span></td><td>19</td></tr>
          </tbody>
        </table>
        <div className="idemo-live"><i />New case from the driver phone, with 4 photos and the GPS point</div>
      </Pane>
      <Pane on={step === "damage"} className="web">
        <div className="idemo-web-h"><b>ACC-2026-0148 · damage</b><span className="pill pill-amber">Moderate</span></div>
        <div className="idemo-defect">
          <div className="idemo-photos">
            <span className="t1"><Photo name="mixer" className="idemo-photo zoom-front" sizes="180px" alt="MX-152 front left damage" /></span>
            <span className="t2"><Photo name="mixer" className="idemo-photo" sizes="180px" position="70% 50%" alt="MX-152 cab" /></span>
          </div>
          <ul>
            <li><small>Zones</small>Front left, left side</li>
            <li><small>Parts</small>Bumper, left head lamp</li>
            <li><small>Fault</small>Under review</li>
          </ul>
        </div>
      </Pane>
      <Pane on={step === "teams"} className="web">
        <div className="idemo-web-h"><b>One case, every team</b><span className="muted-xs">Click a team</span></div>
        <div className="wt-teams" role="tablist" aria-label="Teams on this case">
          {TEAMS.map((x) => (
            <span key={x.id} role="tab" aria-selected={sel === x.id} className={sel === x.id ? "on" : undefined} {...tap(() => choose(x.id))}>
              {x.name}<i style={{ width: `${x.pct}%` }} />
            </span>
          ))}
        </div>
        <div className="idemo-approval dim">
          <div><b>{t.name}</b><span>{t.work}</span></div>
          <span className={`pill pill-${t.tone}`}>{t.state}</span>
        </div>
        <div className="idemo-live"><i />Each team sees only its own work, and the case cannot close until all are done</div>
      </Pane>
      <Pane on={step === "claim"} className="web">
        <div className="idemo-web-h"><b>Insurance claim</b><span className="pill pill-green">Approved</span></div>
        <HBars label="Claimed SAR 18,400, approved SAR 15,900, deductible SAR 1,000" max={18400} fmt={(v) => `SAR ${v.toLocaleString("en")}`}
          rows={[{ name: "Claimed", v: 18400 }, { name: "Approved", v: 15900, tone: "brand" }, { name: "Deductible", v: 1000, tone: "warn" }]} />
        <div className="idemo-live ok"><i />Every document the policy asks for was attached, so nothing was sent back</div>
      </Pane>
      <Pane on={step === "close"} className="web">
        <div className="idemo-web-h"><b>Closure check</b><span className="pill pill-green">Closed</span></div>
        <div className="wt-checks">
          {["Fleet", "HSE root cause", "Insurance settled", "Workshop repair", "Finance recovery"].map((c) => (
            <span key={c}><BadgeCheck size={14} />{c}</span>
          ))}
        </div>
        <div className="idemo-kpis">
          <div><small>Days open</small><b>12</b></div>
          <div><small>Off the road</small><b>4 days</b></div>
          <div><small>Repeat on asset</small><b>No</b></div>
        </div>
      </Pane>
    </>
  );
}

export const accident: Scenario = {
  id: "accident",
  label: "Accidents & claims",
  icon: ShieldAlert,
  pitch: "One case that every team works on, with the claim documents complete before the insurer asks.",
  appTitle: "Report accident",
  site: "Riyadh",
  defaultSel: "hse",
  steps: [
    { id: "report", icon: ShieldAlert, title: "Report on the spot", text: "Photos, GPS and time from the phone. Plate, driver and site fill in from the asset.", url: "app.tyrepulse.app/accidents", nav: "Accidents", bell: true },
    { id: "damage", icon: MapPin, title: "Mark the damage", text: "Tap the zones on the outline. The office sees the photos and the parts at once.", url: "app.tyrepulse.app/accidents/ACC-2026-0148", nav: "Accidents" },
    { id: "teams", icon: Users, title: "Every team its part", text: "Fleet, HSE, insurance, workshop and finance each get their own task. Click a team.", url: "app.tyrepulse.app/accidents/ACC-2026-0148/teams", nav: "Accidents" },
    { id: "claim", icon: FileText, title: "Claim, with every document", text: "Claimed, approved and deductible side by side, with the policy's checklist done.", url: "app.tyrepulse.app/accidents/ACC-2026-0148/claim", nav: "Accidents" },
    { id: "close", icon: Wallet, title: "Closed when all are done", text: "The case closes only when every team has signed off. Nothing is left half open.", url: "app.tyrepulse.app/accidents/ACC-2026-0148/closure", nav: "Accidents" },
  ],
  Phone,
  Web,
};
