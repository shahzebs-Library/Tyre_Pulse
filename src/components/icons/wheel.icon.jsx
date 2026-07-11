/**
 * wheel — a road wheel: rim, hub and spokes. Registered as `wheel`.
 */
import IconBase from './IconBase'

export default function WheelIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
      {/* spokes */}
      <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
    </IconBase>
  )
}
