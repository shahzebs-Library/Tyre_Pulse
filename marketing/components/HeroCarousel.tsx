"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export type HeroSlide = {
  id: string;
  /** Short name shown in the slide selector under the hero. */
  tab: string;
  kicker: string;
  title: string;
  lead: string;
  link: { href: string; label: string };
  visual: React.ReactNode;
};

/** How long each slide stays on screen. The progress bar in the selector is timed by the same value. */
const SLIDE_MS = 7000;

/**
 * Auto-rotating home hero. Every slide swaps the whole upper area (kicker,
 * headline, lead, link and visual), not just the picture.
 *
 * All slides sit in the same grid cell, so the hero is as tall as its tallest
 * slide and never jumps when it rotates. Inactive slides are `inert` and
 * visibility-hidden, so their links cannot be tabbed into and screen readers
 * only hear the slide on screen.
 *
 * There is no pause button, at the owner's request. Rotation still holds while
 * the pointer or keyboard focus is inside the hero (so nobody loses the slide
 * they are reading), while the tab is hidden, and for visitors who asked their
 * system for reduced motion. The timer is the CSS progress bar itself, so all of
 * those holds come from `animation-play-state`.
 */
export function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
  const [active, setActive] = useState(0);
  const [hold, setHold] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const sync = () => setHidden(document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const next = useCallback(() => setActive((i) => (i + 1) % slides.length), [slides.length]);
  const running = !hold && !reduced && !hidden;

  return (
    <section
      className="home-hero"
      aria-roledescription="carousel"
      aria-label="Tyre Pulse overview"
      onPointerEnter={() => setHold(true)}
      onPointerLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHold(false); }}
    >
      <div className="site-shell">
        <div className="hc-stage">
          {slides.map((s, i) => {
            const on = i === active;
            const Title = i === 0 ? "h1" : "p";
            return (
              <div
                key={s.id}
                className={`hc-slide${on ? " is-on" : ""}`}
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${slides.length}: ${s.tab}`}
                aria-hidden={!on}
                inert={!on}
              >
                <div className="hc-copy">
                  <span className="kicker">{s.kicker}</span>
                  <Title className="hero-h1">{s.title}</Title>
                  <p className="hero-lead">{s.lead}</p>
                  <div className="hero-cta">
                    <Link className="btn btn-primary" href="/contact">Book a demo <ArrowRight size={18} aria-hidden="true" /></Link>
                    <Link className="btn-text" href={s.link.href}>{s.link.label} <ArrowRight size={17} aria-hidden="true" /></Link>
                  </div>
                </div>
                <div className="hc-visual">{s.visual}</div>
              </div>
            );
          })}
        </div>

        <p className="hc-pick-now" aria-hidden="true">
          <span>{slides[active].tab}</span>
          <span className="hc-pick-count">{active + 1} / {slides.length}</span>
        </p>
        <div className="hc-picker" role="tablist" aria-label="Choose a hero slide">
          {slides.map((s, i) => {
            const on = i === active;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={on}
                className={`hc-pick${on ? " is-on" : ""}`}
                onClick={() => setActive(i)}
              >
                <span className="hc-pick-label">{s.tab}</span>
                <span className="hc-pick-track" aria-hidden="true">
                  {on && (
                    <span
                      key={`${s.id}-${active}`}
                      className="hc-pick-fill"
                      style={{ animationDuration: `${SLIDE_MS}ms`, animationPlayState: running ? "running" : "paused" }}
                      onAnimationEnd={() => { if (running) next(); }}
                    />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
