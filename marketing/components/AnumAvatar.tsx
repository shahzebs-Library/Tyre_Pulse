/**
 * Anum, drawn as a friendly cartoon fleet coordinator: headscarf, white safety
 * helmet and a hi-vis vest, so the guide reads as someone from the industry
 * rather than a letter. Pure inline SVG (no image request, scales crisply from
 * the 22px mobile bar up to the launcher). Decorative: callers keep aria-hidden
 * and the visible/accessible name "Anum" carries the meaning.
 */
export function AnumAvatar({ size = 34, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      className={`anum-face ${className}`.trim()}
      viewBox="0 0 48 48"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="24" cy="24" r="24" fill="#FFC629" />
      <g>
        {/* shoulders: navy shirt under an orange hi-vis vest with a reflective band */}
        <path d="M6 48c1-9 8-14 18-14s17 5 18 14z" fill="#1f3550" />
        <path d="M9 48c1-7 5-11 10-12.5L22 48zM39 48c-1-7-5-11-10-12.5L26 48z" fill="#F26B1D" />
        <path d="M10.5 44.5l9-1.6.4 2.2-9.2 1.6zM37.5 44.5l-9-1.6-.4 2.2 9.2 1.6z" fill="#e9eef2" />
        {/* headscarf framing the face and falling to the shoulders */}
        <path d="M11.5 27c0-9 5.5-15 12.5-15s12.5 6 12.5 15c0 4-1.2 7.5-3 10-2.5 2-5.8 3.2-9.5 3.2S17 39 14.5 37c-1.8-2.5-3-6-3-10z" fill="#2f5d62" />
        {/* face */}
        <ellipse cx="24" cy="27" rx="8" ry="9" fill="#E9B98F" />
        <path d="M16.3 23.5c1.2-4.2 4.2-6.5 7.7-6.5s6.5 2.3 7.7 6.5c-2.4-1.6-5-2.3-7.7-2.3s-5.3.7-7.7 2.3z" fill="#2f5d62" />
        {/* eyes, brows, smile, cheeks */}
        <ellipse cx="20.6" cy="26.4" rx="1.15" ry="1.35" fill="#2a1d14" />
        <ellipse cx="27.4" cy="26.4" rx="1.15" ry="1.35" fill="#2a1d14" />
        <path d="M18.9 23.9q1.7-.9 3.3 0M25.8 23.9q1.7-.9 3.3 0" stroke="#3b2a1e" strokeWidth=".9" fill="none" strokeLinecap="round" />
        <path d="M21 31q3 2.4 6 0" stroke="#8a3b2e" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <circle cx="18.6" cy="29.6" r="1.4" fill="#f08f7a" opacity=".55" />
        <circle cx="29.4" cy="29.6" r="1.4" fill="#f08f7a" opacity=".55" />
        {/* white safety helmet with a brim and a centre ridge */}
        <path d="M12.5 17.5c0-6.3 5.1-10.5 11.5-10.5s11.5 4.2 11.5 10.5z" fill="#ffffff" />
        <path d="M24 7v10.5" stroke="#d9dde1" strokeWidth="2" />
        <rect x="9.5" y="16.6" width="29" height="3" rx="1.5" fill="#f2f4f6" stroke="#cfd5da" strokeWidth=".6" />
      </g>
    </svg>
  );
}
