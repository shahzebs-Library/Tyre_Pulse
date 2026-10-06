import { BarChart3, Coins, Gauge, Receipt, TrendingDown } from "lucide-react";
import { Photo } from "@/components/art/Photos";
import { Bars, Notice, Pane, tap, type Scenario, type SceneProps } from "./shared";

/** Cost per km by asset, worst first. */
const ASSETS = [
  { id: "mx308", asset: "MX-308", cpk: 1.42, tyre: 0.31, spare: 0.86, oil: 0.25, flag: true },
  { id: "mx214", asset: "MX-214", cpk: 0.97, tyre: 0.21, spare: 0.55, oil: 0.21, flag: false },
  { id: "pt118", asset: "PT-118", cpk: 0.88, tyre: 0.18, spare: 0.52, oil: 0.18, flag: false },
  { id: "mx152", asset: "MX-152", cpk: 0.81, tyre: 0.17, spare: 0.47, oil: 0.17, flag: false },
];
const asset = (sel: string) => ASSETS.find((a) => a.id === sel) ?? ASSETS[0];
const MONTHS = [["May", 1.06], ["Jun", 1.02], ["Jul", 1.05], ["Aug", 0.98], ["Sep", 0.96], ["Oct", 0.93]] as const;

function Phone({ step, sel }: SceneProps) {
  const a = asset(sel);
  return (
    <>
      <Pane on={step === "meter"}>
        <div className="idemo-cam">
          <Photo name="loaderCab" className="idemo-photo" sizes="480px" alt="" />
          <span className="idemo-gps">Odometer photo · 06:40</span>
        </div>
        <span className="muted-xs">Daily meter log</span>
        <div className="wt-meter">184,220 <small>km</small></div>
        <div className="idemo-reading good"><b>MX-214</b><span>+212 km since yesterday</span><em>Saved</em></div>
      </Pane>
      <Pane on={step === "lines"}>
        <div className="idemo-asset"><b>Nothing to type</b><span>Expense lines come in from your ERP export and are sorted on their own.</span></div>
        <div className="idemo-reading good"><b>Today</b><span>1,284 lines sorted</span><em>Tyre · Spare · Oil</em></div>
      </Pane>
      <Pane on={step === "asset"}>
        <Notice title="Cost alert" body={`${a.asset} costs SAR ${a.cpk.toFixed(2)} per km, ${a.flag ? "46% above" : "close to"} the fleet.`} when="now" />
        <div className="idemo-reading warn"><b>{a.asset}</b><span>SAR {a.cpk.toFixed(2)} / km</span><em>{a.flag ? "Check" : "Normal"}</em></div>
      </Pane>
      <Pane on={step === "trend"}>
        <div className="idemo-asset"><b>Fleet cost per km</b><span>SAR 0.93 in October</span><span>-12% since May</span></div>
      </Pane>
    </>
  );
}

function Web({ step, sel, choose }: SceneProps) {
  const a = asset(sel);
  return (
    <>
      <Pane on={step === "meter"} className="web">
        <div className="idemo-web-h"><b>Meter readings</b><span className="muted-xs">Today</span></div>
        <table className="idemo-table">
          <thead><tr><th>Asset</th><th>Reading</th><th>Change</th><th>Source</th></tr></thead>
          <tbody>
            <tr className="sel"><td>MX-214</td><td>184,220 km</td><td>+212 km</td><td>Driver, with photo</td></tr>
            <tr><td>GN-305</td><td>6,240 h</td><td>+11 h</td><td>PM service</td></tr>
            <tr><td>PT-118</td><td>97,410 km</td><td>+180 km</td><td>Telematics</td></tr>
          </tbody>
        </table>
        <div className="idemo-live"><i />A reading lower than the last one is flagged, never silently saved</div>
      </Pane>
      <Pane on={step === "lines"} className="web">
        <div className="idemo-web-h"><b>Expense lines, sorted by the item</b><span className="muted-xs">October</span></div>
        <table className="idemo-table">
          <thead><tr><th>Item</th><th>Job card</th><th>Value</th><th>Sorted as</th></tr></thead>
          <tbody>
            <tr><td>Tyre 315/80R22.5</td><td>JC-2026-0998</td><td>SAR 1,450</td><td><span className="pill pill-yellow">Tyre</span></td></tr>
            <tr><td>Drum motor seal kit</td><td>JC-2026-1012</td><td>SAR 640</td><td><span className="pill pill-grey">Spare</span></td></tr>
            <tr><td>Engine oil 15W-40, 20 L</td><td>JC-2026-1004</td><td>SAR 310</td><td><span className="pill pill-blue">Oil</span></td></tr>
          </tbody>
        </table>
        <div className="idemo-live ok"><i />Uploading the same file twice adds nothing: repeats are caught</div>
      </Pane>
      <Pane on={step === "asset"} className="web">
        <div className="idemo-web-h"><b>Cost per km by asset</b><span className="muted-xs">Click a bar</span></div>
        <div className="wt-hbars">
          {ASSETS.map((x, i) => (
            <div key={x.id} className={`wt-hbar click${sel === x.id ? " sel" : ""}`} role="button" aria-pressed={sel === x.id} {...tap(() => choose(x.id))}>
              <span className="n">{x.asset}</span>
              <span className="t"><i className={x.flag ? "bad" : ""} style={{ width: `${(x.cpk / 1.5) * 100}%`, animationDelay: `${i * 0.06}s` }} /></span>
              <b>SAR {x.cpk.toFixed(2)}</b>
            </div>
          ))}
        </div>
        <div className="wt-stack" role="img" aria-label={`${a.asset}: tyres ${a.tyre}, spares ${a.spare}, oil ${a.oil} SAR per km`}>
          <i className="s1" style={{ flex: a.tyre }}><span>Tyres {a.tyre.toFixed(2)}</span></i>
          <i className="s2" style={{ flex: a.spare }}><span>Spares {a.spare.toFixed(2)}</span></i>
          <i className="s3" style={{ flex: a.oil }}><span>Oil {a.oil.toFixed(2)}</span></i>
        </div>
      </Pane>
      <Pane on={step === "trend"} className="web">
        <Bars title="Fleet cost per km" value="SAR 0.93" note="-12% since May" data={MONTHS} max={1.2} fmt={(v) => v.toFixed(2)}
          label="Fleet cost per km, May to October, falling from 1.06 to 0.93 SAR" />
        <div className="idemo-kpis">
          <div><small>Why it moved</small><b>Price -4%</b></div>
          <div><small>Volume</small><b>-6%</b></div>
          <div><small>New assets</small><b>+2</b></div>
        </div>
      </Pane>
    </>
  );
}

export const cost: Scenario = {
  id: "cost",
  label: "Cost per km",
  icon: Coins,
  pitch: "Know what every machine costs to run per km or per hour, which one is out of line, and why the total moved.",
  appTitle: "Meter log",
  site: "All sites · KSA",
  defaultSel: "mx308",
  steps: [
    { id: "meter", icon: Gauge, title: "Meters come in daily", text: "Drivers log the odometer with a photo, or it arrives from telematics.", url: "app.tyrepulse.app/odometer-logs", nav: "Assets" },
    { id: "lines", icon: Receipt, title: "Expenses sort themselves", text: "Every ERP line is filed as tyre, spare or oil by what the item is.", url: "app.tyrepulse.app/expense-report", nav: "Costs" },
    { id: "asset", icon: BarChart3, title: "Spot the costly machine", text: "Cost per km by asset, worst first. Click a bar to see where the money goes.", url: "app.tyrepulse.app/cpk-intelligence", nav: "Costs", bell: true },
    { id: "trend", icon: TrendingDown, title: "See why it changed", text: "The month-on-month change split into price, volume and new machines.", url: "app.tyrepulse.app/expense-trends", nav: "Costs" },
  ],
  Phone,
  Web,
};
