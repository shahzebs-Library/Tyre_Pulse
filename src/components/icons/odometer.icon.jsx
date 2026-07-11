/**
 * odometer — a distance counter with a digit reel window. Registered as `odometer`.
 */
import IconBase from './IconBase'

export default function OdometerIcon(props) {
  return (
    <IconBase {...props}>
      {/* housing */}
      <rect x="3" y="7" width="18" height="10" rx="2" />
      {/* digit reel window */}
      <rect x="6" y="10" width="12" height="4" rx="0.75" />
      {/* digit dividers */}
      <path d="M9 10v4M12 10v4M15 10v4" />
    </IconBase>
  )
}
