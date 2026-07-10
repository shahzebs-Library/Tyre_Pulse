/**
 * mileage-life — tyre mileage life: a road stretching to the horizon marking
 * distance-to-life covered. Registered as `mileage-life`.
 */
import IconBase from './IconBase'

export default function MileageLifeIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M5 20 10 5" />
      <path d="M19 20 14 5" />
      <path d="M12 6.5v1.5M12 11v1.5M12 15.5V17" />
    </IconBase>
  )
}
