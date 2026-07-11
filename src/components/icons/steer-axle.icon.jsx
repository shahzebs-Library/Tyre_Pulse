/**
 * steer-axle — a front steer axle with angled (turning) wheels. Registered as `steer-axle`.
 */
import IconBase from './IconBase'

export default function SteerAxleIcon(props) {
  return (
    <IconBase {...props}>
      {/* axle shaft */}
      <path d="M7 12h10" />
      {/* left wheel steered */}
      <path d="M3.5 7.5l1.5 4.5-1.5 4.5" />
      {/* right wheel steered */}
      <path d="M20.5 7.5l-1.5 4.5 1.5 4.5" />
      {/* steering indication */}
      <path d="M12 12V5M9.5 7L12 4.5 14.5 7" />
    </IconBase>
  )
}
