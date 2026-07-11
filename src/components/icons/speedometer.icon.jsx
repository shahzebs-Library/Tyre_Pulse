/**
 * speedometer — a gauge dial with a sweeping needle. Registered as `speedometer`.
 */
import IconBase from './IconBase'

export default function SpeedometerIcon(props) {
  return (
    <IconBase {...props}>
      {/* dial arc */}
      <path d="M3.5 17a9 9 0 0 1 17 0" />
      {/* needle */}
      <path d="M12 15l4.5-4.5" />
      {/* hub */}
      <circle cx="12" cy="15" r="1.25" />
      {/* scale ticks */}
      <path d="M4.5 14l1.4.6M19.5 14l-1.4.6M7.5 9.5l1 1.2M12 7.5v1.6" />
    </IconBase>
  )
}
