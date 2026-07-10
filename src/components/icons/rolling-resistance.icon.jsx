/**
 * rolling-resistance — rolling resistance: a rolling tyre with a directional arc
 * and a drag/friction arrow opposing motion. Registered as `rolling-resistance`.
 */
import IconBase from './IconBase'

export default function RollingResistanceIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="11" cy="12" r="7" />
      <circle cx="11" cy="12" r="2.5" />
      <path d="M18 6.5a9 9 0 0 1 0 11" />
      <path d="m18 17.5 2-1M18 17.5l-.6-2.1" />
    </IconBase>
  )
}
