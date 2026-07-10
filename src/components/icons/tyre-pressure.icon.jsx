/**
 * tyre-pressure — a tyre with a pressure-gauge dial reading. Registered as `tyre-pressure`.
 */
import IconBase from './IconBase'

export default function TyrePressureIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="9" cy="12" r="7" />
      <circle cx="9" cy="12" r="2.5" />
      {/* gauge dial */}
      <circle cx="19" cy="6" r="3" />
      {/* dial needle */}
      <path d="M19 6l1.6-1.6" />
      {/* stem linking tyre to gauge */}
      <path d="M14.6 8.2 16.8 7" />
    </IconBase>
  )
}
