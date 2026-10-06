import { CalendarClock, CheckCircle2, Gauge, ListChecks, TrendingUp } from "lucide-react";
import { Photo } from "@/components/art/Photos";
import { Bars, Pane, tap, type Scenario, type SceneProps } from "./shared";

/** What the PM list shows today, by hours or by km. */
const DUE = [
  { id: "gn305", asset: "GN-305", what: "500-hour service", due: "Due in 12 h", tone: "amber", meter: "6,228 h" },
  { id: "mx214", asset: "MX-214", what: "10,000 km service", due: "2 days late", tone: "red", meter: "184,220 km" },
  { id: "wl207", asset: "WL-207", what: "250-hour grease", due: "Due in 6 days", tone: "green", meter: "6,190 h" },
];
const CHECKS = ["Engine oil and filter", "Fuel filters", "Air filter", "Belts and hoses", "Coolant level"];
const COMPLIANCE = [["May", 84], ["Jun", 86], ["Jul", 85], ["Aug", 89], ["Sep", 90], ["Oct", 94]] as const;

function Phone({ step, sel, choose }: SceneProps) {
  return (
    <>
      <Pane on={step === "due"}>
        <span className="muted-xs">Due for you today</span>
        <div className="wt-list">
          {DUE.map((d) => (
            <div key={d.id} className={`wt-item${sel === d.id ? " sel" : ""}`} role="button" aria-pressed={sel === d.id} {...tap(() => choose(d.id))}>
              <div><b>{d.asset}</b><span>{d.what}</span></div>
              <span className={`pill pill-${d.tone}`}>{d.due}</span>
            </div>
          ))}
        </div>
      </Pane>
      <Pane on={step === "check"}>
        <div className="idemo-veh">
          <span className="idemo-veh-pic"><Photo name="technicianGenerator" className="idemo-photo" sizes="72px" alt="" /></span>
          <span><b>GN-305</b><small>Generator · 500-hour service</small></span>
        </div>
        <div className="wt-checks phone">
          {CHECKS.map((c, i) => <span key={c} style={{ animationDelay: `${0.15 + i * 0.18}s` }}><CheckCircle2 size={13} />{c}</span>)}
        </div>
      </Pane>
      <Pane on={step === "meter"}>
        <span className="muted-xs">Hour meter now</span>
        <div className="wt-meter">6,240 <small>h</small></div>
        <div className="idemo-reading good"><b>Next</b><span>6,740 h, or 12 Apr</span><em>Whichever first</em></div>
        <div className="wt-btns"><span className="yellow-btn">Record service</span></div>
      </Pane>
      <Pane on={step === "trend"}>
        <div className="idemo-done"><CheckCircle2 size={40} /><b>Service recorded</b><span className="muted-xs">5 of 5 checks, 1 photo</span></div>
      </Pane>
    </>
  );
}

function Web({ step, sel, choose }: SceneProps) {
  return (
    <>
      <Pane on={step === "due"} className="web">
        <div className="idemo-web-h"><b>Preventive maintenance</b><span className="muted-xs">Click a row</span></div>
        <div className="idemo-kpis wt-k4">
          <div><small>Plans active</small><b>212</b></div>
          <div><small>Overdue</small><b>3</b></div>
          <div><small>Due this week</small><b>17</b></div>
          <div><small>Compliance</small><b>92%</b></div>
        </div>
        <table className="idemo-table">
          <thead><tr><th>Asset</th><th>Service</th><th>Meter</th><th>Due</th></tr></thead>
          <tbody>
            {DUE.map((d) => (
              <tr key={d.id} className={sel === d.id ? "sel" : undefined} aria-selected={sel === d.id} {...tap(() => choose(d.id))}>
                <td>{d.asset}</td><td>{d.what}</td><td>{d.meter}</td><td><span className={`pill pill-${d.tone}`}>{d.due}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Pane>
      <Pane on={step === "check"} className="web">
        <div className="idemo-web-h"><b>GN-305 · 500-hour service</b><span className="pill pill-blue">In progress</span></div>
        <div className="idemo-defect">
          <div className="idemo-photos"><span className="t1"><Photo name="technicianGenerator" className="idemo-photo" sizes="180px" alt="Technician servicing generator GN-305" /></span></div>
          <ul>
            <li><small>Technician</small>S. Al Harbi</li>
            <li><small>Checklist</small>Engine, filters, belts, coolant</li>
            <li><small>Started</small>08:05, on site</li>
          </ul>
        </div>
        <div className="idemo-live"><i />Ticks arrive here as the technician works</div>
      </Pane>
      <Pane on={step === "meter"} className="web">
        <div className="idemo-web-h"><b>Next service worked out for you</b><span className="pill pill-green">Scheduled</span></div>
        <div className="idemo-wo-web">
          <div><small>Done at</small>6,240 h · 06 Oct</div>
          <div><small>Interval</small>Every 500 h or 6 months</div>
          <div><small>Next by hours</small>6,740 h</div>
          <div><small>Next by date</small>12 Apr 2027</div>
        </div>
        <div className="idemo-live ok"><i />The meter reading also updates the asset, so cost per hour stays right</div>
      </Pane>
      <Pane on={step === "trend"} className="web">
        <Bars title="PM done on time" value="94%" note="+10 points since May" data={COMPLIANCE} max={100} fmt={(v) => `${v}%`}
          label="Preventive maintenance done on time, May to October, from 84 to 94 percent" />
        <div className="idemo-kpis">
          <div><small>Overdue now</small><b>2</b></div>
          <div><small>Breakdowns this month</small><b>-31%</b></div>
          <div><small>Service cost</small><b>Per asset</b></div>
        </div>
      </Pane>
    </>
  );
}

export const maintenance: Scenario = {
  id: "maintenance",
  label: "Preventive maintenance",
  icon: CalendarClock,
  pitch: "Service every machine on time, by hours or by km, and watch breakdowns fall as compliance rises.",
  appTitle: "My services",
  site: "Riyadh",
  defaultSel: "gn305",
  steps: [
    { id: "due", icon: CalendarClock, title: "See what is due", text: "By engine hours, km or date, whichever comes first. Click a row to pick a job.", url: "app.tyrepulse.app/pm-programs", nav: "Maintenance" },
    { id: "check", icon: ListChecks, title: "Follow the checklist", text: "The service template for that machine, ticked off on the phone with a photo.", url: "app.tyrepulse.app/pm-programs/GN-305", nav: "Maintenance" },
    { id: "meter", icon: Gauge, title: "Record the meter", text: "One reading closes the job and schedules the next one, no spreadsheet.", url: "app.tyrepulse.app/pm-programs/GN-305/history", nav: "Maintenance" },
    { id: "trend", icon: TrendingUp, title: "Compliance goes up", text: "Management sees services done on time, month by month, and what is still late.", url: "app.tyrepulse.app/pm-programs/dashboard", nav: "Overview" },
  ],
  Phone,
  Web,
};
