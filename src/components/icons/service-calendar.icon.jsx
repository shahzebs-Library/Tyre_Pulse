/**
 * service-calendar — a calendar with a wrench (scheduled maintenance). Registered as `service-calendar`.
 */
import IconBase from './IconBase'

export default function ServiceCalendarIcon(props) {
  return (
    <IconBase {...props}>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3.5v3M16 3.5v3" />
      {/* wrench mark */}
      <path d="M11.6 13.2a1.7 1.7 0 0 0 2.2 2.2l1.4 1.4a1 1 0 0 1-1.4 1.4l-1.4-1.4a1.7 1.7 0 0 1-2.2-2.2z" />
    </IconBase>
  )
}
