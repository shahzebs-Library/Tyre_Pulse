/**
 * fuel-pump — a fuel dispenser with hose, nozzle and side tank. Registered as `fuel-pump`.
 */
import IconBase from './IconBase'

export default function FuelPumpIcon(props) {
  return (
    <IconBase {...props}>
      {/* pump body */}
      <path d="M4 21V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v16" />
      <path d="M3 21h11" />
      {/* display window */}
      <rect x="6" y="6" width="5" height="4" rx="0.75" />
      {/* filler side tank / nozzle stack */}
      <path d="M13 9h3a2 2 0 0 1 2 2v5.5a1.5 1.5 0 0 0 3 0V8l-2.5-2.5" />
    </IconBase>
  )
}
