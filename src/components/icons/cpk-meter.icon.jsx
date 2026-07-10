/**
 * cpk-meter — a gauge with a needle (cost-per-km metric). Registered as `cpk-meter`.
 */
import IconBase from './IconBase'

export default function CpkMeterIcon(props) {
  return (
    <IconBase {...props}>
      {/* dial arc */}
      <path d="M4 17a8 8 0 0 1 16 0" />
      <path d="M4 17h2M18 17h2" />
      {/* ticks */}
      <path d="M6.6 10.6l1.2 1.2M12 8v1.7M17.4 10.6l-1.2 1.2" />
      {/* needle */}
      <path d="M12 17 15 12" />
      <circle cx="12" cy="17" r="1.1" fill="currentColor" stroke="none" />
    </IconBase>
  )
}
