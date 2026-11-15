"use client";

import { useState } from "react";
import { AXLES, ASSET, MEDIAN_PSI, WHEELS, fmt } from "./data";
import "./product.css";

const TONE_LABEL = { good: "Good", warn: "Watch", bad: "Action needed" } as const;

/**
 * The tyre board: a top view of the vehicle with one button per wheel. Selecting
 * a wheel shows that tyre's reading, the way the inspection workspace does in
 * the app. Every wheel is a real button, so the keyboard reaches each reading.
 */
export function WheelBoard({ compact = false, initial = "LHR1-O", title = "Tyre board" }: { compact?: boolean; initial?: string; title?: string }) {
  const [sel, setSel] = useState(initial);
  const w = WHEELS.find((x) => x.id === sel) ?? WHEELS[0];
  const delta = Math.round(((w.psi - MEDIAN_PSI) / MEDIAN_PSI) * 100);
  return (
    <figure className={`pd-card pd-wheelboard${compact ? " is-compact" : ""}`} aria-label={`Sample tyre board for transit mixer ${ASSET.code}`}>
      <figcaption className="pd-head">
        <span><b>{title}</b><small>{ASSET.code} · {ASSET.type}</small></span>
        <span className="sample-tag">Sample data</span>
      </figcaption>
      <div className="pd-wb">
        <div className="pd-truck" role="group" aria-label="Wheel positions, front of the vehicle at the top">
          <span className="pd-truck-front" aria-hidden="true">Front</span>
          <span className="pd-truck-body" aria-hidden="true" />
          {AXLES.map((axle, i) => (
            <div key={i} className={`pd-axle pd-axle-${axle.length}`}>
              {axle.map((id) => {
                const x = WHEELS.find((t) => t.id === id)!;
                return (
                  <button key={id} type="button" className={`pd-wheel is-${x.tone}${sel === id ? " is-sel" : ""}`} aria-pressed={sel === id} aria-label={`${id}: ${x.cond}, ${x.psi} psi`} onClick={() => setSel(id)}>
                    <i aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="pd-reading" aria-live="polite">
          <div className="pd-reading-h"><b>{w.id}</b><span className={`pd-pill is-${w.tone}`}>{TONE_LABEL[w.tone]}</span></div>
          <dl>
            <div><dt>Serial</dt><dd>{w.serial}</dd></div>
            <div><dt>Brand</dt><dd>{w.brand}</dd></div>
            <div><dt>Condition</dt><dd>{w.cond}</dd></div>
            <div><dt>Pressure</dt><dd>{w.psi} psi <small>{delta === 0 ? "at vehicle median" : `${delta > 0 ? "+" : ""}${delta}% vs median`}</small></dd></div>
            {!compact && <div><dt>Km run</dt><dd>{fmt(w.km)} km</dd></div>}
          </dl>
          <div className="pd-life" aria-label={`Life used ${w.life} percent of expected`}>
            <span><i className={`is-${w.tone}`} style={{ transform: `scaleX(${w.life / 100})` }} /></span>
            <small>{w.life}% of expected life used</small>
          </div>
        </div>
      </div>
      {!compact && <p className="pd-hint">Select a wheel to see its tyre.</p>}
    </figure>
  );
}
