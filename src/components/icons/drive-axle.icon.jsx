/**
 * drive-axle — a powered dual-wheel drive axle with a differential hub. Registered as `drive-axle`.
 */
import IconBase from './IconBase'

export default function DriveAxleIcon(props) {
  return (
    <IconBase {...props}>
      {/* axle shaft */}
      <path d="M6 12h12" />
      {/* differential hub */}
      <circle cx="12" cy="12" r="2.5" />
      {/* left dual wheels */}
      <path d="M3 8v8M5.5 9v6" />
      {/* right dual wheels */}
      <path d="M21 8v8M18.5 9v6" />
    </IconBase>
  )
}
