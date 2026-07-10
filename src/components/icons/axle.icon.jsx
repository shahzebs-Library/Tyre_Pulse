/**
 * axle — a horizontal axle beam with a wheel at each end. Registered as `axle`.
 */
import IconBase from './IconBase'

export default function AxleIcon(props) {
  return (
    <IconBase {...props}>
      {/* axle shaft */}
      <path d="M7 12h10" />
      {/* left wheel */}
      <path d="M4 8v8" />
      {/* right wheel */}
      <path d="M20 8v8" />
      {/* end hubs */}
      <path d="M7 10v4M17 10v4" />
    </IconBase>
  )
}
