/**
 * driver-id — an ID card with a portrait and detail lines. Registered as `driver-id`.
 */
import IconBase from './IconBase'

export default function DriverIdIcon(props) {
  return (
    <IconBase {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      {/* portrait */}
      <circle cx="8.5" cy="10.5" r="2" />
      <path d="M5.5 15.5a3 3 0 0 1 6 0" />
      {/* detail lines */}
      <path d="M14.5 9.5h4M14.5 12.5h4M14.5 15.5h2.5" />
    </IconBase>
  )
}
