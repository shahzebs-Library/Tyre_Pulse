"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const Scene = dynamic(() => import("./HeroScene"), { ssr: false, loading: () => <div className="canvas-fallback" /> });

/**
 * globals.css hides the canvas under prefers-reduced-motion and on narrow
 * screens, but display: none does not stop a three.js render loop. The scene
 * kept animating invisibly, which is wasted battery on a phone and ignores the
 * user's stated preference rather than honouring it. Deciding in JavaScript
 * means the canvas is never created at all in those cases.
 *
 * The query mirrors the CSS breakpoints exactly so the two cannot disagree.
 */
const QUIET = "(max-width: 560px), (prefers-reduced-motion: reduce)";

function useQuietScene() {
  // Assume quiet until proven otherwise so the server render and the first
  // client paint agree, and so nothing animates before we have checked.
  const [quiet, setQuiet] = useState(true);

  useEffect(() => {
    const query = window.matchMedia(QUIET);
    const sync = () => setQuiet(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return quiet;
}

export function Hero3D() {
  const quiet = useQuietScene();

  // The wheel is decoration beside the hero copy. It carries no information that
  // is not already in the text, so it is hidden from assistive technology.
  if (quiet) {
    return (
      <div className="scene-fallback" style={{ display: "block" }} aria-hidden="true">
        <div className="canvas-fallback" />
      </div>
    );
  }

  return (
    <div className="scene-desktop" aria-hidden="true">
      <Scene />
    </div>
  );
}
