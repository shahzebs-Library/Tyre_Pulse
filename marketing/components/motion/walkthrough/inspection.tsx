import { Camera, CheckCircle2, ClipboardCheck, CloudUpload, MapPin, PenLine, QrCode, ScanLine, Wrench } from "lucide-react";
import { Photo } from "@/components/art/Photos";
import { Bars, Pane, tap, type Scenario, type SceneProps } from "./shared";

type Tone = "good" | "warn" | "bad";
type Wheel = { id: string; x: number; y: number; serial: string; tread: number; psi: number; s: Tone; note: string };

/** 6x4 transit mixer, top-down: steer pair, then two dual drive axles. */
const WHEELS: Wheel[] = [
  { id: "LHF1", x: 14, y: 14, serial: "RM-2208-117", tread: 11.2, psi: 120, s: "good", note: "Good" },
  { id: "RHF1", x: 74, y: 14, serial: "RM-2208-121", tread: 11.0, psi: 119, s: "good", note: "Good" },
  { id: "LHR1", x: 8, y: 66, serial: "DX-4471-208", tread: 4.1, psi: 98, s: "bad", note: "Sidewall cut" },
  { id: "LHR1i", x: 20, y: 66, serial: "DX-4471-213", tread: 8.6, psi: 117, s: "good", note: "Good" },
  { id: "RHR1i", x: 68, y: 66, serial: "DX-4471-197", tread: 8.9, psi: 118, s: "good", note: "Good" },
  { id: "RHR1", x: 80, y: 66, serial: "DX-4471-205", tread: 6.2, psi: 116, s: "warn", note: "Watch wear" },
  { id: "LHR2", x: 8, y: 92, serial: "DX-5102-031", tread: 9.1, psi: 118, s: "good", note: "Good" },
  { id: "LHR2i", x: 20, y: 92, serial: "DX-5102-034", tread: 9.0, psi: 117, s: "good", note: "Good" },
  { id: "RHR2i", x: 68, y: 92, serial: "DX-5102-029", tread: 8.8, psi: 118, s: "good", note: "Good" },
  { id: "RHR2", x: 80, y: 92, serial: "DX-5102-040", tread: 8.7, psi: 119, s: "good", note: "Good" },
];
const TABLE_IDS = ["LHR1", "RHR1", "LHF1", "RHF1", "LHR2"];
const TONE_PILL: Record<Tone, string> = { good: "green", warn: "amber", bad: "red" };
const TONE_LABEL: Record<Tone, string> = { good: "Good", warn: "Watch", bad: "Cut" };
const CPK = [["May", 0.046], ["Jun", 0.044], ["Jul", 0.045], ["Aug", 0.042], ["Sep", 0.043], ["Oct", 0.041]] as const;
const WEAR = [7.8, 6.9, 6.0, 5.1, 4.1];
const wheel = (sel: string) => WHEELS.find((x) => x.id === sel) ?? WHEELS[2];

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

function Phone({ step, sel, choose }: SceneProps) {
  const w = wheel(sel);
  return (
    <>
      <Pane on={step === "scan"}>
        <div className="idemo-scan">
          <Photo name="mixer" className="idemo-photo" sizes="240px" position="60% 50%" alt="" />
          <span className="idemo-qr"><QrCode size={30} /></span><i className="idemo-beam" />
        </div>
        <div className="idemo-asset">
          <b>MX-214 <em>Transit mixer 6x4</em></b>
          <span><MapPin size={10} /> Riyadh · 184,220 km</span>
          <span>10 tyres · 315/80R22.5 · checked yesterday</span>
        </div>
      </Pane>
      <Pane on={step === "tyres"}>
        <div className="idemo-veh">
          <span className="idemo-veh-pic"><Photo name="mixer" className="idemo-photo" sizes="72px" position="60% 50%" alt="" /></span>
          <span><b>MX-214</b><small>Transit mixer 6x4 · 10 tyres</small></span>
        </div>
        <svg className="idemo-truck" viewBox="0 0 100 112" role="group" aria-label="Tyre map, tap a wheel">
          <rect x="30" y="4" width="40" height="22" rx="4" className="cab" />
          <rect x="34" y="30" width="32" height="76" rx="6" className="body" />
          {WHEELS.map((x, i) => (
            <rect key={x.id} x={x.x} y={x.y} width="11" height="18" rx="3"
              className={`wheel ${x.s}${sel === x.id ? " sel" : ""}`} style={{ animationDelay: `${i * 0.08}s` }}
              role="button" aria-label={`${x.id}: ${x.tread} mm, ${x.psi} psi, ${x.note}`} {...tap(() => choose(x.id))} />
          ))}
        </svg>
        <div className={`idemo-reading ${w.s}`}><b>{w.id}</b><span>{w.tread} mm · {w.psi} psi</span><em>{w.note}</em></div>
        <span className="muted-xs idemo-hint">Tap a wheel</span>
      </Pane>
      <Pane on={step === "photo"}>
        <div className="idemo-cam">
          <Photo name="mixer" className="idemo-photo zoom-rear" sizes="480px" alt="" />
          <i className="idemo-flash" /><span className="idemo-gps">24.774 N, 46.738 E · 07:44</span>
        </div>
        <div className="idemo-thumbs"><span className="t1"><Photo name="mixer" className="idemo-photo zoom-rear" sizes="96px" alt="" /></span><span className="t2"><Photo name="mixer" className="idemo-photo zoom-wide" sizes="96px" alt="" /></span><em>LHR1 · 2 photos</em></div>
      </Pane>
      <Pane on={step === "sign"}>
        <span className="muted-xs">Inspector signature</span>
        <div className="sig-pad idemo-sig">
          <svg viewBox="0 0 160 60"><path d="M8 44 C 20 10, 30 10, 28 40 S 44 58, 52 24 S 66 8, 70 38 C 72 50, 82 50, 90 30 C 96 18, 104 22, 104 34 C 104 44, 118 40, 150 30" /></svg>
        </div>
        <span className="muted-xs">Ahmed K. · 07:46 · 10 of 10 wheels checked</span>
      </Pane>
      <Pane on={step === "sync"}>
        <div className="idemo-done"><CheckCircle2 size={40} /><b>Inspection synced</b><span className="muted-xs">2 photos, 1 signature uploaded</span></div>
        <div className="idemo-wo"><Wrench size={14} /><span>LHR1 finding sent to the supervisor</span></div>
      </Pane>
    </>
  );
}

function Web({ step, sel, choose }: SceneProps) {
  const w = wheel(sel);
  return (
    <>
      <Pane on={step === "scan"} className="web">
        <div className="idemo-asset-web">
          <span className="idemo-asset-pic"><Photo name="mixer" className="idemo-photo" sizes="120px" position="60% 50%" alt="Transit mixer MX-214" /></span>
          <div>
            <div className="idemo-web-h"><b>MX-214</b><span className="pill pill-green">In service</span></div>
            <span className="muted-xs">Transit mixer 6x4 · Riyadh · 10 tyres</span>
            <div className="idemo-kpis">
              <div><small>Odometer</small><b>184,220 km</b></div>
              <div><small>Open jobs</small><b>0</b></div>
              <div><small>Next PM</small><b>12 Oct</b></div>
            </div>
          </div>
        </div>
        <Bars title="Tyre cost / km" value="SAR 0.041" note="-11% in 6 months" data={CPK} max={0.05} fmt={(v) => v.toFixed(3)}
          label="Tyre cost per km, last six months, falling from 0.046 to 0.041 SAR" />
        <div className="idemo-live"><i />Ahmed K. opened this asset on mobile</div>
      </Pane>
      <Pane on={step === "tyres"} className="web">
        <div className="idemo-web-h"><b>Tyres on MX-214</b><span className="muted-xs">Click a row</span></div>
        <table className="idemo-table">
          <thead><tr><th>Pos.</th><th>Serial</th><th>Tread</th><th>PSI</th><th>Status</th></tr></thead>
          <tbody>
            {TABLE_IDS.map((id) => {
              const r = WHEELS.find((x) => x.id === id)!;
              return (
                <tr key={id} className={sel === id ? "sel" : undefined} aria-selected={sel === id} {...tap(() => choose(id))}>
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
      <Pane on={step === "photo"} className="web">
        <div className="idemo-web-h"><b>Defect · LHR1</b><span className="pill pill-red">High</span></div>
        <div className="idemo-defect">
          <div className="idemo-photos">
            <span className="t1"><Photo name="mixer" className="idemo-photo zoom-rear" sizes="180px" alt="Rear left wheel of MX-214, close-up" /></span>
            <span className="t2"><Photo name="mixer" className="idemo-photo zoom-wide" sizes="180px" alt="MX-214 rear axles" /></span>
          </div>
          <ul>
            <li><small>Finding</small>Sidewall cut, 4 cm</li>
            <li><small>Pressure</small>98 psi, 17% under</li>
            <li><small>Where</small>Riyadh yard, gate 2 · 07:44</li>
          </ul>
        </div>
        <WearLine />
      </Pane>
      <Pane on={step === "sign"} className="web">
        <div className="idemo-web-h"><b>Waiting for approval</b><span className="pill pill-amber">1 new</span></div>
        <div className="idemo-approval">
          <div><b>INS-3F9A21C0 · MX-214</b><span>Ahmed K. signed at 07:46 · 2 findings</span></div>
          <span className="yellow-btn">Approve</span>
        </div>
        <div className="idemo-approval dim">
          <div><b>INS-3F9A1B77 · PT-118</b><span>Approved by area manager · 07:12</span></div>
          <span className="pill pill-green">Approved</span>
        </div>
      </Pane>
      <Pane on={step === "sync"} className="web">
        <div className="idemo-web-h"><b>WO-2026-0418</b><span className="pill pill-blue">New</span></div>
        <div className="idemo-wo-web">
          <div><small>From</small>Inspection INS-3F9A21C0</div>
          <div><small>Job</small>Replace tyre LHR1</div>
          <div><small>Asset</small>MX-214 · Riyadh</div>
          <div><small>Cost</small>Added as parts and labour are booked</div>
        </div>
        <div className="idemo-live ok"><i />Raised by the supervisor from the finding · 07:52</div>
      </Pane>
    </>
  );
}

export const inspection: Scenario = {
  id: "inspection",
  label: "Tyre inspection",
  icon: ClipboardCheck,
  pitch: "Catch the cut tyre before it becomes a blowout, and have the job on the workshop's list before the truck leaves the yard.",
  appTitle: "Daily inspection",
  site: "Riyadh",
  defaultSel: "LHR1",
  steps: [
    { id: "scan", icon: QrCode, title: "Scan the machine", text: "The QR on the cab opens the asset, its site, its tyre layout and its checklist.", url: "app.tyrepulse.app/assets/MX-214", nav: "Assets", online: false },
    { id: "tyres", icon: ScanLine, title: "Check every wheel", text: "Tread and pressure per position. Tap any wheel or row to see that tyre.", url: "app.tyrepulse.app/assets/MX-214/tyres", nav: "Tyres", online: false },
    { id: "photo", icon: Camera, title: "Photo the defect", text: "The picture is pinned to that wheel, with the time and the GPS point.", url: "app.tyrepulse.app/inspections/INS-3F9A21C0", nav: "Inspections", online: false },
    { id: "sign", icon: PenLine, title: "Sign it off", text: "The inspector signs on the glass. The supervisor sees it waiting to approve.", url: "app.tyrepulse.app/approvals", nav: "Inspections", online: false },
    { id: "sync", icon: CloudUpload, title: "Synced, job raised", text: "Back in signal it uploads. The supervisor turns the finding into a work order in one click.", url: "app.tyrepulse.app/work-orders/WO-2026-0418", nav: "Workshop", online: true, bell: true },
  ],
  Phone,
  Web,
};
