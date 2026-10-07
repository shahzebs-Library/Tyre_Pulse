/**
 * Chart kit for the walk-through and the home page.
 *
 * One restrained palette (see `--v-*` in motion.css): ink greys carry the
 * data, the brand yellow marks only the value that matters, and green, amber
 * and red are kept for status. Every chart is plain SVG or HTML, labels its
 * values directly, and carries a text alternative for screen readers.
 */

export type Tone = "ink" | "ink2" | "ink3" | "ink4" | "brand" | "good" | "warn" | "bad";

export type Slice = { name: string; v: number; tone: Tone; label?: string };

/** Donut with small gaps between slices, a total in the centre and a value legend. */
export function Donut({
  slices, center, sub, label, size = 116, legend = true,
}: { slices: ReadonlyArray<Slice>; center: string; sub?: string; label: string; size?: number; legend?: boolean }) {
  const total = slices.reduce((s, x) => s + x.v, 0) || 1;
  const gap = slices.length > 1 ? 0.8 : 0;
  const segs = slices.map((s, i) => {
    const before = slices.slice(0, i).reduce((t, x) => t + x.v, 0);
    const pct = (s.v / total) * 100;
    const dash = Math.max(0, pct - gap);
    return { ...s, dash, off: 25 - (before / total) * 100 };
  });
  return (
    <div className="v-donut" role="img" aria-label={label}>
      <div className="v-donut-fig" style={{ width: size, height: size }}>
      <svg viewBox="0 0 42 42" width={size} height={size} aria-hidden="true">
        <circle cx="21" cy="21" r="15.915" className="v-track" />
        {segs.map((s) => (
          <circle key={s.name} cx="21" cy="21" r="15.915" className={`v-seg v-${s.tone}`}
            strokeDasharray={`${s.dash} ${100 - s.dash}`} strokeDashoffset={s.off} />
        ))}
      </svg>
      <span className="v-donut-c"><b>{center}</b>{sub && <small>{sub}</small>}</span>
      </div>
      {legend && (
        <ul className="v-legend">
          {slices.map((s) => (
            <li key={s.name}><i className={`v-${s.tone}`} />{s.name}<b>{s.label ?? `${Math.round((s.v / total) * 100)}%`}</b></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Half-circle gauge with a target tick. Value and target are 0 to 100. */
export function Gauge({ value, target, title, sub, label }: { value: number; target?: number; title: string; sub?: string; label: string }) {
  const ang = (p: number) => Math.PI * (1 - p / 100);
  const tx = (p: number, r: number) => 50 + r * Math.cos(ang(p));
  const ty = (p: number, r: number) => 50 - r * Math.sin(ang(p));
  const tone = target !== undefined && value < target ? "warn" : "good";
  return (
    <figure className="v-gauge" role="img" aria-label={label}>
      <svg viewBox="0 0 100 58" aria-hidden="true">
        <path d="M 10 50 A 40 40 0 0 1 90 50" className="v-gtrack" pathLength={100} />
        <path d="M 10 50 A 40 40 0 0 1 90 50" className={`v-gval v-${tone}`} pathLength={100} strokeDasharray={`${value} 100`} />
        {target !== undefined && (
          <line x1={tx(target, 33)} y1={ty(target, 33)} x2={tx(target, 47)} y2={ty(target, 47)} className="v-gtick" />
        )}
      </svg>
      <figcaption><b>{value}%</b><span>{title}</span>{sub && <small>{sub}</small>}</figcaption>
    </figure>
  );
}

/** Bridge from a start value to an end value through the reasons it moved. Lower is better here. */
export function Waterfall({
  start, end, steps, fmt, label, title,
}: {
  start: { name: string; v: number }; end: { name: string; v: number };
  steps: ReadonlyArray<{ name: string; v: number }>; fmt: (v: number) => string; label: string; title: string;
}) {
  const levels: number[] = [start.v];
  steps.forEach((s) => levels.push(levels[levels.length - 1] + s.v));
  const lo = Math.min(...levels, end.v) * 0.9;
  const hi = Math.max(...levels, end.v) * 1.02;
  const y = (v: number) => ((v - lo) / (hi - lo)) * 100;
  type Col = { name: string; from: number; to: number; kind: "total" | "down" | "up"; text: string };
  const cols: Col[] = [{ name: start.name, from: lo, to: start.v, kind: "total", text: fmt(start.v) }];
  let run = start.v;
  steps.forEach((s) => {
    cols.push({ name: s.name, from: run, to: run + s.v, kind: s.v < 0 ? "down" : "up", text: `${s.v > 0 ? "+" : ""}${fmt(s.v)}` });
    run += s.v;
  });
  cols.push({ name: end.name, from: lo, to: end.v, kind: "total", text: fmt(end.v) });
  return (
    <figure className="idemo-chart v-wf" aria-label={label}>
      <figcaption><span>{title}</span></figcaption>
      <div className="v-wf-plot" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }} aria-hidden="true">
        {cols.map((c, i) => {
          const b = y(Math.min(c.from, c.to));
          const h = Math.max(2, Math.abs(y(c.to) - y(c.from)));
          return (
            <div key={c.name} className="v-wf-col">
              <i className={`v-wf-bar ${c.kind}${i === cols.length - 1 ? " last" : ""}`} style={{ bottom: `${b}%`, height: `${h}%`, animationDelay: `${i * 0.07}s` }}>
                <em>{c.text}</em>
              </i>
              <span className="m">{c.name}</span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

/** Grid of cells shaded by value: where and when something happens. */
export function Heatmap({
  rows, cols, data, label, unit = "",
}: { rows: ReadonlyArray<string>; cols: ReadonlyArray<string>; data: ReadonlyArray<ReadonlyArray<number>>; label: string; unit?: string }) {
  const max = Math.max(...data.flat(), 1);
  return (
    <div className="v-heat" role="img" aria-label={label} style={{ gridTemplateColumns: `auto repeat(${cols.length}, minmax(0, 1fr))` }}>
      <span />
      {cols.map((c) => <span key={c} className="v-heat-h">{c}</span>)}
      {rows.map((r, ri) => (
        <div key={r} className="v-heat-row">
          <span className="v-heat-r">{r}</span>
          {data[ri].map((v, ci) => {
            const t = v / max;
            return (
              <i key={ci} className={t > 0.75 ? "hot" : undefined} style={{ ["--t" as string]: t.toFixed(2), animationDelay: `${(ri * cols.length + ci) * 0.012}s` }}
                title={`${r}, ${cols[ci]}: ${v}${unit}`}>{t > 0.55 ? v : ""}</i>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** KPI tile with a sparkline of its recent trend. */
export function SparkKpi({ label, value, data, good = "down" }: { label: string; value: string; data: ReadonlyArray<number>; good?: "up" | "down" }) {
  const lo = Math.min(...data), hi = Math.max(...data);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${hi === lo ? 50 : 90 - ((v - lo) / (hi - lo)) * 80}`).join(" ");
  const rising = data[data.length - 1] >= data[0];
  const ok = (good === "up") === rising;
  return (
    <div className="v-spark">
      <small>{label}</small>
      <b>{value}</b>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={pts} className={ok ? "v-good" : "v-bad"} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
