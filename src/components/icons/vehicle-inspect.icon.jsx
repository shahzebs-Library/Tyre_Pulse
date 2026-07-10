/**
 * vehicle-inspect — a vehicle examined through a magnifier. Registered as `vehicle-inspect`.
 */
import IconBase from './IconBase'

export default function VehicleInspectIcon(props) {
  return (
    <IconBase {...props}>
      {/* car body */}
      <path d="M3 13l1.5-4h9l2.5 4" />
      <path d="M3 13v3h13" />
      {/* wheels */}
      <circle cx="6.5" cy="16" r="1.6" />
      <circle cx="13.5" cy="16" r="1.6" />
      {/* magnifier */}
      <circle cx="16.5" cy="9" r="3" />
      <path d="M18.7 11.2 21 13.5" />
    </IconBase>
  )
}
