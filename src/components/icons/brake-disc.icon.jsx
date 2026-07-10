/**
 * brake-disc — a vented brake rotor gripped by a caliper. Registered as `brake-disc`.
 */
import IconBase from './IconBase'

export default function BrakeDiscIcon(props) {
  return (
    <IconBase {...props}>
      {/* rotor */}
      <circle cx="11" cy="12" r="8" />
      {/* hub */}
      <circle cx="11" cy="12" r="2.25" />
      {/* vent holes */}
      <path d="M11 6.5v1M11 16.5v1M5.5 12h1M15.5 12h1" />
      {/* caliper */}
      <path d="M17 8.5a4 4 0 0 1 0 7h2v-7z" />
    </IconBase>
  )
}
