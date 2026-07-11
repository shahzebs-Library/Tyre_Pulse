/**
 * mechanic — technician wearing a cap with a wrench badge. Registered as `mechanic`.
 */
import IconBase from './IconBase'

export default function MechanicIcon(props) {
  return (
    <IconBase {...props}>
      {/* cap */}
      <path d="M6 8a6 6 0 0 1 12 0" />
      <path d="M5 8h14" />
      {/* head */}
      <circle cx="12" cy="12.5" r="3" />
      {/* shoulders */}
      <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
    </IconBase>
  )
}
