/**
 * anomaly-scan — a magnifier over a waveform with a flagged spike. Registered as `anomaly-scan`.
 */
import IconBase from './IconBase'

export default function AnomalyScanIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="10" cy="10" r="6.5" />
      <path d="m15 15 5 5" />
      {/* signal with anomalous spike */}
      <path d="M6.5 11.5h1.6l1-4 1.4 5 1-2.5h1.6" />
    </IconBase>
  )
}
