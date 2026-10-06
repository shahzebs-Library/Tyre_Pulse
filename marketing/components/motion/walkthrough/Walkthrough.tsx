"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, ClipboardCheck, CircleDot, Coins, LayoutDashboard, Pause, Play, ShieldAlert, Truck, Wrench, CalendarClock } from "lucide-react";
import type { NavKey, Scenario } from "./shared";
import { inspection } from "./inspection";
import { workshop } from "./workshop";
import { accident } from "./accident";
import { maintenance } from "./maintenance";
import { cost } from "./cost";
import { tyreIntel } from "./tyreIntel";

/**
 * Product walk-throughs, one per module, each told on two screens at once:
 * an iPhone in the field and the web app in the office, in step.
 *
 * Module tabs on top; the tour plays every step of a module and then moves to
 * the next module. Wheels, rows, bars and teams are tappable: exploring pauses
 * the tour, choosing a step or a module resumes it. Hover and focus do not
 * hold the tour: that made the Play button read as broken. The Pause button
 * is the one stop control (WCAG 2.2.2).
 *
 * HTML, CSS and real photos only. Plays only on screen with the tab visible;
 * reduced motion never auto-advances; a visible Pause control stops it
 * (WCAG 2.2.2). All values are illustrative sample data and the scene says so.
 */
export const SCENARIOS: Scenario[] = [inspection, tyreIntel, workshop, accident, maintenance, cost];
export type ScenarioId = "inspection" | "tyres" | "workshop" | "accident" | "maintenance" | "cost";

const STEP_MS = 2800;

const WEB_NAV: ReadonlyArray<readonly [NavKey, typeof LayoutDashboard]> = [
  ["Overview", LayoutDashboard], ["Assets", Truck], ["Inspections", ClipboardCheck], ["Tyres", CircleDot],
  ["Workshop", Wrench], ["Maintenance", CalendarClock], ["Accidents", ShieldAlert], ["Costs", Coins],
];

export function Walkthrough({ only, initial }: { only?: ScenarioId[]; initial?: ScenarioId }) {
  const list = only ? SCENARIOS.filter((s) => only.includes(s.id as ScenarioId)) : SCENARIOS;
  const [mi, setMi] = useState(() => Math.max(0, list.findIndex((s) => s.id === initial)));
  const [step, setStep] = useState(0);
  const [inView, setInView] = useState(false);
  // Reduced motion: start paused, but Play still works because pressing it is an explicit choice.
  const [paused, setPaused] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const mod = list[mi];
  const [sel, setSel] = useState(mod.defaultSel ?? "");
  const running = inView && !paused;
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) { const r = requestAnimationFrame(() => setInView(true)); return () => cancelAnimationFrame(r); }
    let onScreen = false;
    const sync = () => setInView(onScreen && !document.hidden);
    const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; sync(); }, { threshold: 0.3 });
    io.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => { io.disconnect(); document.removeEventListener("visibilitychange", sync); };
  }, []);

  // Last step of a module rolls on to the next module, so the tour shows the whole product.
  useEffect(() => {
    if (!running) return;
    const t = window.setTimeout(() => {
      if (step < mod.steps.length - 1) { setStep(step + 1); return; }
      const next = (mi + 1) % list.length;
      setMi(next); setStep(0); setSel(list[next].defaultSel ?? "");
    }, STEP_MS);
    return () => window.clearTimeout(t);
  }, [running, step, mi, mod, list]);

  /** Choosing a module or a step is an explicit "carry on": it clears the pause. */
  const pickModule = useCallback((i: number) => {
    setMi(i); setStep(0); setSel(list[i].defaultSel ?? ""); setPaused(false);
  }, [list]);
  const pickStep = useCallback((i: number) => { setStep(i); setPaused(false); }, []);
  /** Exploring stops the tour so the visitor is not pulled away mid-look. */
  const choose = useCallback((id: string) => { setSel(id); setPaused(true); }, []);

  const current = mod.steps[step];
  const online = current.online;
  const Phone = mod.Phone;
  const Web = mod.Web;

  return (
    <div
      className="idemo"
      ref={rootRef}
      data-module={mod.id}
      data-step={current.id}
    >
      {list.length > 1 && (
        <div className="wt-mods" role="tablist" aria-label="Choose a module">
          {list.map((s, i) => {
            const Icon = s.icon;
            return (
              <button key={s.id} type="button" role="tab" aria-selected={i === mi} className={i === mi ? "is-on" : ""} onClick={() => pickModule(i)}>
                <Icon size={15} aria-hidden="true" />{s.label}
              </button>
            );
          })}
        </div>
      )}
      <p className="wt-pitch">{mod.pitch}</p>

      <ol className="idemo-steps" style={{ gridTemplateColumns: `repeat(${mod.steps.length}, minmax(0, 1fr))` }}>
        {mod.steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <li key={s.id}>
              <button type="button" className={i === step ? "is-on" : ""} aria-label={`Step ${i + 1}: ${s.title}`} aria-current={i === step ? "step" : undefined} onClick={() => pickStep(i)}>
                <span className="idemo-n" aria-hidden="true"><Icon size={17} /></span>
                <span className="idemo-st"><small>Step {i + 1}</small><b>{s.title}</b></span>
                {i === step && running && <i className="idemo-timer" style={{ animationDuration: `${STEP_MS}ms` }} aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ol>

      <p className="idemo-caption"><span aria-live="polite">{current.text}</span><span className="sample-tag">Sample data</span></p>

      <div className="idemo-stage" key={mod.id}>
        <figure className="iphone idemo-phone" aria-label={`Mobile app, ${mod.label}, step ${step + 1} of ${mod.steps.length}: ${current.title}`}>
          <span className="ip-btn ip-action" aria-hidden="true" /><span className="ip-btn ip-vol1" aria-hidden="true" />
          <span className="ip-btn ip-vol2" aria-hidden="true" /><span className="ip-btn ip-power" aria-hidden="true" />
          <div className="ip-screen">
            <div className="ip-status" aria-hidden="true">
              <span className="ip-time">9:41</span>
              <span className="ip-island" />
              <span className="ip-icons">
                <svg viewBox="0 0 18 12" className={`ip-signal${online === false ? " off" : ""}`}><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5.5" width="3" height="6.5" rx="1" /><rect x="10" y="3" width="3" height="9" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
                <svg viewBox="0 0 27 12" className="ip-batt"><rect x="0.5" y="0.5" width="23" height="11" rx="3.5" /><rect x="2.5" y="2.5" width="16" height="7" rx="2" className="fill" /><rect x="24.5" y="4" width="1.8" height="4" rx="1" className="fill" /></svg>
              </span>
            </div>
            <div className="ip-app">
              <div className="ph-head">
                <strong>{mod.appTitle}</strong>
                {online !== undefined && <span className={`idemo-net${online ? " on" : ""}`}>{online ? "Online" : "Offline"}</span>}
              </div>
              <div className="idemo-progress"><span style={{ width: `${((step + 1) / mod.steps.length) * 100}%` }} /></div>
              <Phone step={current.id} sel={sel} choose={choose} />
            </div>
            <span className="ip-home" aria-hidden="true" />
          </div>
        </figure>

        <figure className="idemo-web" aria-label={`Web app, ${mod.label}, same step: ${current.title}`}>
          <div className="idemo-chrome" aria-hidden="true">
            <i /><i /><i />
            <span className="idemo-url">{current.url}</span>
            <span className="sample-tag">Sample data</span>
          </div>
          <div className="idemo-app">
            <aside className="idemo-side" aria-hidden="true">
              <div className="idemo-brand"><span />Tyre Pulse</div>
              {WEB_NAV.map(([name, Icon]) => (
                <span key={name} className={current.nav === name ? "on" : undefined}><Icon size={12} />{name}</span>
              ))}
            </aside>
            <div className="idemo-main">
              <div className="idemo-top" aria-hidden="true"><span>{mod.site}</span><Bell size={13} />{current.bell && <i className="idemo-bell-dot" />}</div>
              <Web step={current.id} sel={sel} choose={choose} />
            </div>
          </div>
        </figure>
      </div>

      {/* The label follows what the tour is actually doing, so Play always means "start moving now". */}
      <button type="button" className="idemo-toggle" aria-pressed={!running}
        onClick={() => { setPaused(running); }}>
        {running ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
        {running ? "Pause the walk-through" : "Play the walk-through"}
      </button>
    </div>
  );
}
