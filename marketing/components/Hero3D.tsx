"use client";

import dynamic from "next/dynamic";

const Scene = dynamic(() => import("./HeroScene"), { ssr: false, loading: () => <div className="canvas-fallback" /> });

export function Hero3D() {
  return (
    <>
      <div className="scene-desktop"><Scene /></div>
      <div className="scene-fallback"><div className="canvas-fallback" aria-label="Tyre Pulse wheel illustration" /></div>
    </>
  );
}
