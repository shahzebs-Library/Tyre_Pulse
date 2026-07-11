/**
 * gauge-dashboard — a semicircular speedometer gauge. Registered as `gauge-dashboard`.
 */
import IconBase from './IconBase'

export default function GaugeDashboardIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M3.5 18a8.5 8.5 0 0 1 17 0" />
      <path d="M3.5 18h1.8M18.7 18h1.8" />
      {/* needle to upper-right */}
      <path d="M12 18 16 13.5" />
      <circle cx="12" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </IconBase>
  )
}
