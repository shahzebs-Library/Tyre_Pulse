import { AlertTriangle, CheckCircle2, Clock, Hourglass, Package, UserCheck, Wrench } from "lucide-react";
import { Photo } from "@/components/art/Photos";
import { Notice, Pane, tap, type Scenario, type SceneProps } from "./shared";
import { Donut } from "./charts";

/** Technicians the board suggests, scored on skill, availability, workload and site. */
const TECHS = [
  { id: "mk", name: "M. Khan", skill: "Hydraulics", score: 92, why: "Hydraulics, free now, same site" },
  { id: "rs", name: "R. Santos", skill: "Mechanical", score: 74, why: "Free in 40 min" },
  { id: "ap", name: "A. Patel", skill: "Electrical", score: 58, why: "No hydraulics record" },
];
const tech = (sel: string) => TECHS.find((t) => t.id === sel) ?? TECHS[0];

const COLS = [
  { name: "New", cards: [["MX-308", "Hydraulic leak, drum motor", "hot"], ["PB-063", "Belt noise", ""]] },
  { name: "In progress", cards: [["WL-207", "Brake inspection", ""], ["PT-118", "Tyre change LHF2", ""]] },
  { name: "Waiting parts", cards: [["GN-305", "Fuel injector", ""]] },
  { name: "Completed", cards: [["MX-214", "Tyre LHR1 replaced", ""]] },
] as const;

function Phone({ step, sel }: SceneProps) {
  const t = tech(sel);
  return (
    <>
      <Pane on={step === "report"}>
        <div className="idemo-cam wt-tall">
          <Photo name="mixer" className="idemo-photo zoom-drum" sizes="480px" alt="" />
          <span className="wt-marker" style={{ left: "38%", top: "34%" }} />
          <span className="idemo-gps">MX-308 · Riyadh · 06:58</span>
        </div>
        <div className="idemo-asset">
          <b>Report a problem</b>
          <span>Hydraulic leak at the drum motor</span>
          <span className="wt-row"><span className="pill pill-red">Machine stopped</span><span className="pill pill-grey">1 photo</span></span>
        </div>
      </Pane>
      <Pane on={step === "assign"}>
        <Notice title="New job assigned" body={`MX-308 · Hydraulic leak, drum motor. Assigned to ${t.name}.`} />
        <div className="idemo-asset">
          <b>JC-2026-1012</b>
          <span>MX-308 · Transit mixer · Riyadh workshop, bay 2</span>
          <span className="wt-row"><span className="pill pill-red">High</span><span className="pill pill-blue">Assigned</span></span>
        </div>
        <div className="wt-btns"><span className="yellow-btn">Start job</span></div>
      </Pane>
      <Pane on={step === "parts"}>
        <div className="idemo-asset">
          <b>Pause the job</b>
          <span>Why is the work stopped?</span>
        </div>
        <div className="wt-choices">
          <span className="on"><Package size={13} /> Waiting for parts</span>
          <span><Clock size={13} /> Waiting for approval</span>
          <span><UserCheck size={13} /> Need another technician</span>
        </div>
        <div className="idemo-wo"><Package size={14} /><span>Parts request: drum motor seal kit × 1</span></div>
      </Pane>
      <Pane on={step === "done"}>
        <div className="idemo-done"><CheckCircle2 size={40} /><b>Job completed</b><span className="muted-xs">Back to production 14:40</span></div>
        <div className="idemo-reading good"><b>Repair</b><span>2 h 10 min on the job</span><em>Logged</em></div>
      </Pane>
    </>
  );
}

function Web({ step, sel, choose }: SceneProps) {
  return (
    <>
      <Pane on={step === "report"} className="web">
        <div className="idemo-web-h"><b>Workshop live</b><span className="muted-xs">Riyadh · today</span></div>
        <div className="idemo-kpis wt-k4">
          <div><small>Out of production</small><b>4</b></div>
          <div><small>Technicians busy</small><b>6 / 9</b></div>
          <div><small>Waiting parts</small><b>1</b></div>
          <div><small>Utilisation</small><b>71%</b></div>
        </div>
        <div className="wt-board">
          {COLS.map((c) => (
            <div key={c.name} className="wt-col">
              <small>{c.name} <em>{c.cards.length}</em></small>
              {c.cards.map(([a, d, hot]) => (
                <span key={a} className={`wt-card${hot ? " hot" : ""}`}><b>{a}</b>{d}</span>
              ))}
            </div>
          ))}
        </div>
      </Pane>
      <Pane on={step === "assign"} className="web">
        <div className="idemo-web-h"><b>Assign MX-308 · hydraulic leak</b><span className="muted-xs">Click a technician</span></div>
        <div className="wt-list">
          {TECHS.map((t) => (
            <div key={t.id} className={`wt-item${sel === t.id ? " sel" : ""}`} role="button" aria-pressed={sel === t.id} {...tap(() => choose(t.id))}>
              <span className="wt-score">{t.score}</span>
              <div><b>{t.name}</b><span>{t.skill} · {t.why}</span></div>
              {sel === t.id ? <span className="pill pill-green">Assigned</span> : <span className="pill pill-grey">Suggest</span>}
            </div>
          ))}
        </div>
        <div className="idemo-live"><i />The score weighs skill, who is free now, workload and site</div>
      </Pane>
      <Pane on={step === "parts"} className="web">
        <div className="idemo-web-h"><b>MX-308 · waiting for parts</b><span className="pill pill-amber">Paused 1 h 20 min</span></div>
        <div className="idemo-wo-web">
          <div><small>Parts request</small>Drum motor seal kit × 1</div>
          <div><small>Status</small>Approved, issued from Riyadh store</div>
          <div><small>Waiting reason</small>Parts, not the technician</div>
          <div><small>Counted as</small>Waiting time, not repair time</div>
        </div>
        <div className="idemo-live"><i />A paused job is never counted as idle technician time</div>
      </Pane>
      <Pane on={step === "done"} className="web">
        <div className="idemo-web-h"><b>Where the MX-308 downtime went</b><span className="pill pill-green">Back in production</span></div>
        <Donut center="7 h 50" sub="down" label="MX-308 downtime 7 h 50 min: waiting to start 4 h 20, waiting for parts 1 h 20, repair 2 h 10"
          slices={[
            { name: "Waiting to start", v: 260, tone: "ink2", label: "4 h 20" },
            { name: "Waiting for parts", v: 80, tone: "ink3", label: "1 h 20" },
            { name: "Repair", v: 130, tone: "brand", label: "2 h 10" },
          ]} />
        <div className="idemo-kpis">
          <div><small>Total downtime</small><b>7 h 50</b></div>
          <div><small>Repair share</small><b>28%</b></div>
          <div><small>Fix first time</small><b>Yes</b></div>
        </div>
        <div className="idemo-live"><i />Most of the stop was waiting to start, a scheduling problem, not a workshop one</div>
      </Pane>
    </>
  );
}

export const workshop: Scenario = {
  id: "workshop",
  label: "Breakdowns & workshop",
  icon: Wrench,
  pitch: "See every machine that is off the road, who is on it, and whether time is lost to the repair or to waiting.",
  appTitle: "Workshop",
  site: "Riyadh workshop",
  defaultSel: "mk",
  steps: [
    { id: "report", icon: AlertTriangle, title: "Driver reports it", text: "One tap with a photo. The machine shows up on the live workshop board at once.", url: "app.tyrepulse.app/workshop-live", nav: "Workshop", bell: true },
    { id: "assign", icon: UserCheck, title: "Assign the right person", text: "The board ranks technicians by skill and who is free. Click one to assign.", url: "app.tyrepulse.app/workshop-live/assign", nav: "Workshop" },
    { id: "parts", icon: Hourglass, title: "Paused for parts", text: "The technician says why the job stopped, so waiting is never mistaken for slow work.", url: "app.tyrepulse.app/parts-requests", nav: "Workshop" },
    { id: "done", icon: CheckCircle2, title: "Back in production", text: "Downtime is split into waiting and repair, so you fix the part of the problem that is real.", url: "app.tyrepulse.app/workshop-analytics", nav: "Workshop" },
  ],
  Phone,
  Web,
};
