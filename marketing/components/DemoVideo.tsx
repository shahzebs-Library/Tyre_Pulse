"use client";

import { useRef, useState } from "react";
import { Play } from "lucide-react";

/**
 * The product video slot. Nothing downloads until the visitor presses play (preload="none"
 * behind a poster image), so the page pays nothing for it. It never autoplays, so it is
 * calm for anyone who asked for reduced motion. The video has no soundtrack: every message
 * is written on screen, which is why it carries no caption track.
 *
 * To swap in a longer promo, change VIDEO and POSTER (files live in public/videos).
 */
const VIDEO = "/videos/tyrepulse-promo-15s.mp4";
const POSTER = "/videos/tyrepulse-promo-poster.webp";

export function DemoVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const start = () => {
    setStarted(true);
    // Wait one frame for the controls to mount, then play with the user's gesture.
    requestAnimationFrame(() => { void ref.current?.play().catch(() => {}); });
  };
  return (
    <figure className="tp-video">
      <div className="tp-video-frame">
        <video
          ref={ref}
          src={started ? VIDEO : undefined}
          poster={POSTER}
          preload="none"
          playsInline
          muted
          controls={started}
          aria-label="Tyre Pulse in fifteen seconds: tyre inspection on the phone, cost per km, the live workshop board and the fleet it runs on"
        />
        {!started && (
          <button type="button" className="tp-video-play" onClick={start}>
            <Play size={22} aria-hidden="true" /> Play the 15 second video
          </button>
        )}
      </div>
      <figcaption>Silent video: every message is written on screen, so no captions are needed. Screens show the product in English.</figcaption>
    </figure>
  );
}
