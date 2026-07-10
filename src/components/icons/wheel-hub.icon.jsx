/**
 * wheel-hub — wheel hub: a central hub with lug-bolt holes around the bore.
 * Registered as `wheel-hub`.
 */
import IconBase from './IconBase'

export default function WheelHubIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="6.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="17.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="6.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="12" r="1" fill="currentColor" stroke="none" />
    </IconBase>
  )
}
