import Image from "next/image";

/**
 * The Tyre Pulse lockup: the slanted tread-block TP mark beside the outlined
 * TYRE PULSE wordmark (brand master art, never re-typed). "light" is the
 * reverse colourway for dark surfaces (white TYRE, yellow PULSE and mark);
 * "dark" is the asphalt colourway for white pages.
 */
const RATIO = 1226.2 / 266;

export function Logo({ tone = "light", size = 26 }: { tone?: "light" | "dark"; size?: number }) {
  const src = tone === "light" ? "/brand/tyre-pulse-wordmark-reverse.svg" : "/brand/tyre-pulse-wordmark-ink.svg";
  const height = Math.round(size * 1.1);
  return (
    <span className="logo">
      <Image src={src} alt="Tyre Pulse" width={Math.round(height * RATIO)} height={height} unoptimized priority />
    </span>
  );
}
