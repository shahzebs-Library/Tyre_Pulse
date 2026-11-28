"use client";

import { useId, useState } from "react";

/** The one assumption the estimate rests on, stated on screen next to the result. */
export const LIFE_GAIN = 0.1;

export type RoiInput = { vehicles: number; tyresPerVehicle: number; tyrePrice: number; lifeMonths: number };

/**
 * Yearly tyre spend today, and with tyres lasting LIFE_GAIN longer.
 * Tyres bought per year = vehicles x tyres per vehicle x 12 / tyre life in months.
 * Returns null when an input is missing or not positive, so no figure is invented.
 */
export function estimateRoi({ vehicles, tyresPerVehicle, tyrePrice, lifeMonths }: RoiInput) {
  if (![vehicles, tyresPerVehicle, tyrePrice, lifeMonths].every((n) => Number.isFinite(n) && n > 0)) return null;
  const tyresPerYear = (vehicles * tyresPerVehicle * 12) / lifeMonths;
  const spend = tyresPerYear * tyrePrice;
  const spendLonger = spend / (1 + LIFE_GAIN);
  return { tyresPerYear, spend, saving: spend - spendLonger, tyresSaved: tyresPerYear - tyresPerYear / (1 + LIFE_GAIN) };
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * A plain estimate, not a promise: four inputs, one stated assumption, the arithmetic shown.
 * Prices are in whatever currency the visitor types; nothing is converted or assumed.
 */
export function RoiCalculator() {
  const id = useId();
  const [v, setV] = useState({ vehicles: "100", tyresPerVehicle: "10", tyrePrice: "1500", lifeMonths: "18" });
  const num = (s: string) => Number(s.replace(/,/g, ""));
  const result = estimateRoi({ vehicles: num(v.vehicles), tyresPerVehicle: num(v.tyresPerVehicle), tyrePrice: num(v.tyrePrice), lifeMonths: num(v.lifeMonths) });
  const field = (key: keyof typeof v, label: string, hint: string) => (
    <div className="roi-field">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <input id={`${id}-${key}`} inputMode="decimal" type="number" min="1" step="any" value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} aria-describedby={`${id}-${key}-hint`} />
      <small id={`${id}-${key}-hint`}>{hint}</small>
    </div>
  );
  return (
    <div className="roi">
      <form className="roi-inputs" onSubmit={(e) => e.preventDefault()} aria-label="Your fleet">
        {field("vehicles", "Number of vehicles", "Machines and vehicles that run on tyres.")}
        {field("tyresPerVehicle", "Tyres per vehicle", "For example 10 on a transit mixer.")}
        {field("tyrePrice", "Average tyre price", "In your own currency.")}
        {field("lifeMonths", "Current tyre life, in months", "How long a tyre lasts today.")}
      </form>
      <div className="roi-result" role="status" aria-live="polite">
        {result ? (
          <>
            <p className="roi-k">Estimated saving per year</p>
            <p className="roi-v">{fmt(result.saving)}</p>
            <p className="roi-s">About {fmt(result.tyresSaved)} fewer tyres a year, from a yearly tyre spend of {fmt(result.spend)} today.</p>
            <p className="roi-note">Estimate only. Assumes tyres last {Math.round(LIFE_GAIN * 100)}% longer. Your real figure depends on how tyres are used, inflated and rotated, and is measured in the platform as cost per km.</p>
          </>
        ) : (
          <p className="roi-s">Enter a number above zero in each field to see the estimate.</p>
        )}
      </div>
    </div>
  );
}
