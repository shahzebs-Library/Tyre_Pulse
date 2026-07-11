/**
 * kpi-target — a bullseye with a center hit. Registered as `kpi-target`.
 */
import IconBase from './IconBase'

export default function KpiTargetIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </IconBase>
  )
}
