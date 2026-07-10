/**
 * flat-spot — tyre flat spot: a mostly round tyre with one flattened section on
 * its circumference. Registered as `flat-spot`.
 */
import IconBase from './IconBase'

export default function FlatSpotIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M8 19.6A9 9 0 1 1 16 19.6" />
      <path d="M8 19.6h8" />
      <circle cx="12" cy="12" r="3" />
    </IconBase>
  )
}
