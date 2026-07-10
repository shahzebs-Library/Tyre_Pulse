/**
 * barcode-scan — a barcode within scanner corner brackets. Registered as `barcode-scan`.
 */
import IconBase from './IconBase'

export default function BarcodeScanIcon(props) {
  return (
    <IconBase {...props}>
      {/* scanner brackets */}
      <path d="M3 7V5.5A1.5 1.5 0 0 1 4.5 4H6" />
      <path d="M18 4h1.5A1.5 1.5 0 0 1 21 5.5V7" />
      <path d="M21 17v1.5a1.5 1.5 0 0 1-1.5 1.5H18" />
      <path d="M6 20H4.5A1.5 1.5 0 0 1 3 18.5V17" />
      {/* barcode bars */}
      <path d="M7 8v8M9.5 8v8M12 8v8M14.5 8v8M17 8v8" />
    </IconBase>
  )
}
