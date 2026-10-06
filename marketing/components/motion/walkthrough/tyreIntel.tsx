import { Activity, AlertOctagon, BadgeDollarSign, Nfc, Radar, TrendingDown } from "lucide-react";
import { Photo } from "@/components/art/Photos";
import { HBars, Notice, Pane, tap, type Scenario, type SceneProps } from "./shared";
import { Donut, SparkKpi } from "./charts";

/** One tyre's life across vehicles, read from its RFID tag. */
const PASSPORT = [
  { asset: "MX-214", pos: "LHR1", from: "Mar 2026", km: "41,200 km", note: "Fitted new" },
  { asset: "MX-188", pos: "RHR2", from: "Nov 2025", km: "22,600 km", note: "Moved after rotation" },
  { asset: "PT-118", pos: "LHF1", from: "Jun 2025", km: "18,900 km", note: "First fitment" },
] as const;

/** Pressure on the leaking wheel at its last readings, from TPMS uploads and inspections (psi). */
const PSI = [118, 117, 116, 112, 107, 101, 94];
/** Tread forecast per tyre: mm now, weeks until 3 mm. */
const FORECAST = [
  { id: "lhr1", pos: "LHR1", mm: 4.1, weeks: 5, tone: "red" },
  { id: "rhr2", pos: "RHR2", mm: 5.6, weeks: 11, tone: "amber" },
  { id: "lhf1", pos: "LHF1", mm: 7.4, weeks: 22, tone: "green" },
  { id: "rhf1", pos: "RHF1", mm: 7.9, weeks: 26, tone: "green" },
];
const fc = (sel: string) => FORECAST.find((f) => f.id === sel) ?? FORECAST[0];

/** What the anomaly engine raised this week. */
const ANOMALIES = [
  { id: "odo", sev: "red", title: "Odometer went backwards", where: "MX-152 · Dammam", why: "Reading 96,410 km is 3,200 km below the last one. Saved, flagged for review." },
  { id: "dup", sev: "amber", title: "Same expense line twice", where: "JC-2026-0998 · Riyadh", why: "Tyre 315/80R22.5, SAR 1,450, same job card, 2 minutes apart." },
  { id: "psi", sev: "amber", title: "Pressure out of pattern", where: "PT-118 · Jeddah", why: "LHF1 runs 18% below the other wheels on the same axle." },
  { id: "life", sev: "grey", title: "Tyre life too short", where: "Brand C · 385/65R22.5", why: "Removed at 21,000 km, half the fleet average for this size." },
];
const anomaly = (sel: string) => ANOMALIES.find((a) => a.id === sel) ?? ANOMALIES[0];

function PsiLine() {
  const lo = 90, hi = 120, lim = 105;
  const top = (v: number) => ((hi - v) / (hi - lo)) * 100;
  const left = (i: number) => 3 + i * (94 / (PSI.length - 1));
  return (
    <figure className="idemo-chart" aria-label="Pressure on LHR1 at its last 7 readings, falling from 118 to 94 psi, alert level 105 psi">
      <figcaption><span>LHR1 pressure, last 7 readings</span><b>94 psi</b><em className="warn">Falling at every reading</em></figcaption>
      <div className="idemo-line" aria-hidden="true">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <line x1="0" x2="100" y1={top(lim)} y2={top(lim)} className="limit" vectorEffect="non-scaling-stroke" />
          <polyline points={PSI.map((v, i) => `${left(i)},${top(v)}`).join(" ")} className="wear" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="limit-t" style={{ top: `${top(lim)}%` }}>Alert 105 psi</span>
        {PSI.map((v, i) => (i % 2 === 0 || i === PSI.length - 1) && (
          <span key={i} className={`dot${i === PSI.length - 1 ? " last" : ""}`} style={{ left: `${left(i)}%`, top: `${top(v)}%` }}><em>{v}</em></span>
        ))}
      </div>
    </figure>
  );
}

function Phone({ step, sel }: SceneProps) {
  const f = fc(sel);
  const a = anomaly(sel);
  return (
    <>
      <Pane on={step === "rfid"}>
        <div className="idemo-scan">
          <Photo name="mixer" className="idemo-photo zoom-rear" sizes="240px" alt="" />
          <span className="idemo-qr"><Nfc size={30} /></span><i className="idemo-beam" />
        </div>
        <div className="idemo-asset">
          <b>Tag read · DX-4471-208</b>
          <span>315/80R22.5 · Brand A · DOT 2025</span>
          <span>3 vehicles · 82,700 km so far</span>
        </div>
      </Pane>
      <Pane on={step === "tpms"}>
        <div className="idemo-asset"><b>MX-214 · pressure check</b><span>Readings saved per wheel</span></div>
        <div className="idemo-reading bad"><b>LHR1</b><span>94 psi · 19% low</span><em>Flagged</em></div>
        <div className="idemo-reading good"><b>RHR1</b><span>117 psi</span><em>Normal</em></div>
      </Pane>
      <Pane on={step === "predict"}>
        <div className="idemo-asset"><b>{f.pos} on MX-214</b><span>{f.mm} mm left</span><span>Reaches 3 mm in about {f.weeks} weeks</span></div>
        <div className="wt-btns"><span className="yellow-btn">Order replacement</span></div>
      </Pane>
      <Pane on={step === "anomaly"}>
        <Notice title="Data check" body={`${a.title}: ${a.where}`} when="3 min" />
        <div className="idemo-asset"><b>{a.title}</b><span>{a.why}</span></div>
      </Pane>
      <Pane on={step === "value"}>
        <div className="idemo-done"><BadgeDollarSign size={40} /><b>SAR 0.021 per km</b><span className="muted-xs">Brand A on 315/80R22.5, best in the fleet</span></div>
      </Pane>
    </>
  );
}

function Web({ step, sel, choose }: SceneProps) {
  const a = anomaly(sel);
  return (
    <>
      <Pane on={step === "rfid"} className="web">
        <div className="idemo-web-h"><b>Tyre passport · DX-4471-208</b><span className="pill pill-green">Fitted</span></div>
        <ol className="wt-pass">
          {PASSPORT.map((p, i) => (
            <li key={p.asset} className={i === 0 ? "now" : undefined}>
              <i /><div><b>{p.asset} · {p.pos}</b><span>{p.from} · {p.km} · {p.note}</span></div>
            </li>
          ))}
        </ol>
        <div className="idemo-live"><i />The tag follows the tyre, so its history moves with it between vehicles</div>
      </Pane>
      <Pane on={step === "tpms"} className="web">
        <PsiLine />
        <div className="v-sparks">
          <SparkKpi label="Pressure compliance" value="96%" data={[88, 90, 91, 93, 94, 96]} good="up" />
          <SparkKpi label="Tyres below alert" value="3" data={[9, 7, 8, 5, 4, 3]} />
          <SparkKpi label="Blowouts this quarter" value="1" data={[5, 4, 4, 2, 2, 1]} />
        </div>
      </Pane>
      <Pane on={step === "predict"} className="web">
        <div className="idemo-web-h"><b>Predicted removals · MX-214</b><span className="muted-xs">Click a tyre</span></div>
        <div className="wt-hbars">
          {FORECAST.map((x, i) => (
            <div key={x.id} className={`wt-hbar click${sel === x.id ? " sel" : ""}`} role="button" aria-pressed={sel === x.id} {...tap(() => choose(x.id))}>
              <span className="n">{x.pos}</span>
              <span className="t"><i className={x.tone === "red" ? "bad" : x.tone === "amber" ? "warn" : "good"} style={{ width: `${(x.weeks / 26) * 100}%`, animationDelay: `${i * 0.06}s` }} /></span>
              <b>{x.weeks} wk</b>
            </div>
          ))}
        </div>
        <div className="idemo-kpis">
          <div><small>Due in 30 days</small><b>46 tyres</b></div>
          <div><small>Budget, next quarter</small><b>SAR 212k</b></div>
          <div><small>In stock</small><b>31</b></div>
        </div>
      </Pane>
      <Pane on={step === "anomaly"} className="web">
        <div className="idemo-web-h"><b>Anomalies this week</b><span className="muted-xs">Click one</span></div>
        <div className="wt-list">
          {ANOMALIES.map((x) => (
            <div key={x.id} className={`wt-item${sel === x.id ? " sel" : ""}`} role="button" aria-pressed={sel === x.id} {...tap(() => choose(x.id))}>
              <span className={`wt-sev ${x.sev}`} aria-hidden="true" />
              <div><b>{x.title}</b><span>{x.where}</span></div>
            </div>
          ))}
        </div>
        <div className="idemo-live"><i />{a.why}</div>
      </Pane>
      <Pane on={step === "value"} className="web">
        <div className="wt-two">
          <div>
            <small className="wt-cap">Cost per km by brand, 315/80R22.5</small>
            <HBars label="Cost per km by brand: A 0.021, B 0.026, C 0.034 SAR" max={0.036} fmt={(v) => v.toFixed(3)}
              rows={[{ name: "Brand A", v: 0.021, tone: "brand" }, { name: "Brand B", v: 0.026 }, { name: "Brand C", v: 0.034, tone: "warn" }]} />
          </div>
          <div><small className="wt-cap">Fleet tyre health</small>
            <Donut size={92} center="2,140" sub="tyres" label="Fleet tyre health: 71 percent good, 21 percent watch, 8 percent replace, out of 2,140 tyres"
              slices={[{ name: "Good", v: 71, tone: "good" }, { name: "Watch", v: 21, tone: "warn" }, { name: "Replace", v: 8, tone: "bad" }]} />
          </div>
        </div>
        <div className="idemo-kpis">
          <div><small>Blowouts avoided</small><b>9</b></div>
          <div><small>Downtime saved</small><b>63 h</b></div>
          <div><small>Saving if all Brand A</small><b>SAR 48k / yr</b></div>
        </div>
      </Pane>
    </>
  );
}

export const tyreIntel: Scenario = {
  id: "tyres",
  label: "Tyre intelligence",
  icon: Radar,
  pitch: "RFID tags, TPMS readings and every inspection feed one tyre record, so you know which tyre fails next and which brand is worth the money.",
  appTitle: "Tyres",
  site: "Riyadh",
  defaultSel: "lhr1",
  steps: [
    { id: "rfid", icon: Nfc, title: "Read the RFID tag", text: "One read opens the tyre's passport: every vehicle, wheel and km it has run.", url: "app.tyrepulse.app/tyre-passport/DX-4471-208", nav: "Tyres" },
    { id: "tpms", icon: Activity, title: "Pressure flags the leak", text: "Readings from TPMS sensor uploads and inspections are compared wheel by wheel, so a tyre losing pressure is flagged before it fails.", url: "app.tyrepulse.app/tpms", nav: "Tyres", bell: true },
    { id: "predict", icon: TrendingDown, title: "Forecast the removal", text: "Tread trend predicts when each tyre reaches its limit. Click a tyre to see its date.", url: "app.tyrepulse.app/predictive-maintenance", nav: "Tyres" },
    { id: "anomaly", icon: AlertOctagon, title: "Anomalies flagged", text: "Meter rollbacks, duplicate expenses and odd pressures are found for you. Click one.", url: "app.tyrepulse.app/ops-intelligence", nav: "Overview", bell: true },
    { id: "value", icon: BadgeDollarSign, title: "Buy the right brand", text: "Cost per km by brand and fleet tyre health show where the money and the risk are.", url: "app.tyrepulse.app/cpk-intelligence", nav: "Costs" },
  ],
  Phone,
  Web,
};
