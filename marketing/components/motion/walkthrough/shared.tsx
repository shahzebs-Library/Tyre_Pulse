import type { LucideIcon } from "lucide-react";

/** Which web navigation item a step lights up. */
export type NavKey = "Overview" | "Assets" | "Inspections" | "Tyres" | "Workshop" | "Maintenance" | "Accidents" | "Costs";

export type StepDef = {
  id: string;
  icon: LucideIcon;
  title: string;
  text: string;
  /** Address shown in the browser bar for this step. */
  url: string;
  nav: NavKey;
  /** When set, the phone shows an Offline / Online pill and greys the signal bars. */
  online?: boolean;
  /** Red dot on the web bell: something just arrived. */
  bell?: boolean;
};

/** What every scene receives. `sel` and `choose` power the tap-to-explore parts. */
export type SceneProps = { step: string; sel: string; choose: (id: string) => void };

export type Scenario = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** One line under the module tabs: why a buyer cares. */
  pitch: string;
  /** Title in the phone app header. */
  appTitle: string;
  site: string;
  steps: StepDef[];
  defaultSel?: string;
  Phone: (p: SceneProps) => React.ReactNode;
  Web: (p: SceneProps) => React.ReactNode;
};

export function Pane({ on, children, className = "" }: { on: boolean; children: React.ReactNode; className?: string }) {
  return <div className={`idemo-pane ${className}${on ? " is-on" : ""}`} aria-hidden={!on} inert={!on}>{children}</div>;
}

/** Keyboard + click handler pair for a tappable element that is not a native button. */
export function tap(fn: () => void) {
  return {
    tabIndex: 0,
    onClick: fn,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } },
  };
}

/** Small column chart: quiet grey columns, the brand colour on the one that matters. */
export function Bars({
  title, value, note, noteTone = "good", data, max, fmt = (v) => String(v), highlight, label,
}: {
  title: string; value: string; note?: string; noteTone?: "good" | "warn";
  data: ReadonlyArray<readonly [string, number]>; max: number; fmt?: (v: number) => string;
  highlight?: number; label: string;
}) {
  const hi = highlight ?? data.length - 1;
  return (
    <figure className="idemo-chart" aria-label={label}>
      <figcaption><span>{title}</span><b>{value}</b>{note && <em className={noteTone === "warn" ? "warn" : undefined}>{note}</em>}</figcaption>
      <div className="idemo-bars" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }} aria-hidden="true">
        {data.map(([m, v], i) => (
          <div key={m} className={i === hi ? "last" : undefined}>
            <span className="val">{fmt(v)}</span>
            <i style={{ height: `${Math.max(4, (v / max) * 100)}%`, animationDelay: `${i * 0.05}s` }} />
            <span className="m">{m}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

/** Horizontal ranked bars, for comparisons (brands, sites, teams). */
export function HBars({ rows, max, fmt, label, unit }: {
  rows: ReadonlyArray<{ name: string; v: number; tone?: "good" | "warn" | "bad" | "brand" }>; max: number;
  fmt: (v: number) => string; label: string; unit?: string;
}) {
  return (
    <div className="wt-hbars" role="img" aria-label={label}>
      {rows.map((r, i) => (
        <div key={r.name} className="wt-hbar">
          <span className="n">{r.name}</span>
          <span className="t"><i className={r.tone ?? ""} style={{ width: `${(r.v / max) * 100}%`, animationDelay: `${i * 0.06}s` }} /></span>
          <b>{fmt(r.v)}{unit}</b>
        </div>
      ))}
    </div>
  );
}

/** Phone notification banner, the way a push lands on the lock screen. */
export function Notice({ title, body, when = "now" }: { title: string; body: string; when?: string }) {
  return (
    <div className="wt-notice">
      <span className="wt-notice-ic" aria-hidden="true" />
      <div><b>{title}</b><span>{body}</span></div>
      <small>{when}</small>
    </div>
  );
}
