/**
 * inspection-check — a magnifier with a checkmark lens. Registered as `inspection-check`.
 */
import IconBase from './IconBase'

export default function InspectionCheckIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="10" cy="10" r="6.5" />
      <path d="m15 15 5 5" />
      {/* check in lens */}
      <path d="m7 10 2 2 4-4.2" />
    </IconBase>
  )
}
