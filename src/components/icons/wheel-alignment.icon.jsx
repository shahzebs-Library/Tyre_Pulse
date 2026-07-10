/**
 * wheel-alignment — two wheels toed against a centre alignment axis. Registered as `wheel-alignment`.
 */
import IconBase from './IconBase'

export default function WheelAlignmentIcon(props) {
  return (
    <IconBase {...props}>
      {/* alignment axis */}
      <path d="M12 2v20" />
      {/* left wheel toed in */}
      <path d="M6 6.5l1.5 4.5-1.5 4.5" />
      {/* right wheel toed in */}
      <path d="M18 6.5l-1.5 4.5 1.5 4.5" />
      {/* reference ticks */}
      <path d="M8.5 12H6M18 12h-2.5" />
    </IconBase>
  )
}
