/**
 * sidewall — a tyre cross-section highlighting the sidewall between bead and tread. Registered as `sidewall`.
 */
import IconBase from './IconBase'

export default function SidewallIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      {/* sidewall span callout */}
      <path d="M12 3v4.5" />
      {/* span end ticks */}
      <path d="M10 3h4M10 7.5h4" />
    </IconBase>
  )
}
