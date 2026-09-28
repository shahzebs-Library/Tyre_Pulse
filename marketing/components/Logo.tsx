/**
 * The Tyre Pulse wordmark: a leaning yellow bar (a tread lug / road stripe)
 * beside the name. Drawn in SVG so it stays crisp at every size and can sit on
 * the dark header and the white page without a second asset.
 */
export function Logo({ tone = "light", size = 26 }: { tone?: "light" | "dark"; size?: number }) {
  const ink = tone === "light" ? "#ffffff" : "#161616";
  return (
    <span className="logo" style={{ color: ink, fontSize: size * 0.82 }}>
      <svg width={size * 0.9} height={size} viewBox="0 0 22 24" aria-hidden="true" focusable="false">
        <path d="M9 0h13L13 24H0z" fill="#FFC629" />
        <path d="M11.5 4h4.5l-6 16H5.5z" fill="#161616" opacity=".14" />
      </svg>
      <span>Tyre Pulse</span>
    </span>
  );
}
