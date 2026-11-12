"use client";

import { useEffect, useRef, useState } from "react";
import { StoryScreen } from "./StoryScreens";
import "./product.css";

export const STORY: ReadonlyArray<{ id: string; label: string; title: string; text: string; who: string }> = [
  { id: "inspection", label: "Inspection", who: "Tyre fitter, on the phone", title: "The walk-round is recorded where it happens.", text: "Each wheel gets a condition and a pressure on the tyre map of that vehicle type. It saves on the phone and syncs when signal returns." },
  { id: "defect", label: "Defect found", who: "Tyre fitter", title: "A finding is pinned to its wheel.", text: "The cut, the photo, the serial and the reading stay together, so the office sees the same tyre the fitter saw." },
  { id: "root-cause", label: "Root cause", who: "Tyre supervisor", title: "The cause is recorded, with the evidence beside it.", text: "Pressure history and earlier findings sit next to the failure, and the corrective action is assigned to a person." },
  { id: "work-order", label: "Work order", who: "Supervisor and workshop", title: "The finding becomes a job with an owner.", text: "Raised from the inspection, approved, assigned to a technician and issued its part from the site store." },
  { id: "replacement", label: "Replacement", who: "Tyre fitter", title: "Old tyre off, new tyre on, both on record.", text: "Removal reason and kilometres run close the old tyre. The new serial takes the wheel position from that odometer reading." },
  { id: "cost", label: "Cost per km", who: "Fleet manager", title: "The tyre's cost per kilometre is now a fact.", text: "Price paid over kilometres run, by brand and size. Plant that works by the hour is measured per engine hour." },
  { id: "report", label: "Management report", who: "Management", title: "The month reaches management without a spreadsheet.", text: "Removals, reasons and cost per km in a scheduled report, exported to PDF, Excel or PowerPoint." },
];

/**
 * The home page product story: one tyre, from inspection to the management report.
 *
 * Wide screens: the product stage is pinned (position: sticky) while the seven
 * steps scroll past it, and the stage shows the screen of the step in view.
 * An IntersectionObserver picks the step; there is no scroll listener.
 *
 * Phones, and anyone who asked for reduced motion: a plain stacked sequence.
 * Each step carries its own screen inline and nothing is pinned.
 *
 * Every step is real text in the page, and the step rail is real buttons, so a
 * keyboard or screen reader reaches all seven states without scrolling tricks.
 */
export function ProductStory() {
  const [active, setActive] = useState(0);
  const steps = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    // A step is "in view" while it crosses the middle band of the viewport.
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
      }
    }, { rootMargin: "-45% 0px -45% 0px", threshold: 0 });
    steps.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  const go = (i: number) => {
    const el = steps.current[i];
    if (!el) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" });
    el.querySelector<HTMLElement>("h3")?.focus({ preventScroll: true });
  };

  return (
    <div className="ps">
      <p className="ps-swipe-hint">Swipe through the seven steps.</p>
      <ol className="ps-steps" tabIndex={0} aria-label="The seven steps">
        {STORY.map((s, i) => (
          <li key={s.id} id={`story-${s.id}`} data-step={i} ref={(el) => { steps.current[i] = el; }} className={i === active ? "is-on" : undefined}>
            <span className="ps-n" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
            <span className="ps-who">{s.label} · {s.who}</span>
            <h3 tabIndex={-1}>{s.title}</h3>
            <p>{s.text}</p>
            <div className="ps-inline"><StoryScreen step={i} /></div>
          </li>
        ))}
      </ol>
      <div className="ps-stage">
        <div className="ps-stage-pin">
          <div className="ps-rail" role="group" aria-label="Story steps">
            {STORY.map((s, i) => (
              <button key={s.id} type="button" aria-current={i === active ? "step" : undefined} className={i === active ? "is-on" : undefined} onClick={() => go(i)}>
                <i aria-hidden="true">{i + 1}</i><span>{s.label}</span>
              </button>
            ))}
          </div>
          {/* The text of each step is in the list beside this; the stage is its picture. */}
          <div className="ps-stage-screen" key={active} aria-hidden="true"><StoryScreen step={active} /></div>
        </div>
      </div>
    </div>
  );
}
