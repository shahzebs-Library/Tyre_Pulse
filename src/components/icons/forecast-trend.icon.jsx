/**
 * forecast-trend — a rising trend line with a projected dashed segment. Registered as `forecast-trend`.
 */
import IconBase from './IconBase'

export default function ForecastTrendIcon(props) {
  return (
    <IconBase {...props}>
      {/* axes */}
      <path d="M4 4v16h16" />
      {/* actual trend */}
      <path d="M6 16l3.5-3.5 3 2 3.5-4.5" />
      {/* projected (dashed) */}
      <path d="M16 10l3-2.5" strokeDasharray="1.8 2" />
      {/* arrow head */}
      <path d="M19.5 7.5 20 9.5l-2 .3" />
    </IconBase>
  )
}
