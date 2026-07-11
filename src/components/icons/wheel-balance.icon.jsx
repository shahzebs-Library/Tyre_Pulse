/**
 * wheel-balance — a wheel on a balancer with a weight mark. Registered as `wheel-balance`.
 */
import IconBase from './IconBase'

export default function WheelBalanceIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="11" r="8" />
      <circle cx="12" cy="11" r="2" />
      {/* balance weight on the rim */}
      <path d="M12 3v2.5" />
      {/* level base */}
      <path d="M4 21h16" />
      <path d="M12 19v2" />
      {/* balance level bubbles */}
      <path d="M9.5 21a2.5 2 0 0 1 5 0" />
    </IconBase>
  )
}
