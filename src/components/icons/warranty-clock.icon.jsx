/**
 * warranty-clock — warranty period: a shield with a clock face marking the
 * covered time window. Registered as `warranty-clock`.
 */
import IconBase from './IconBase'

export default function WarrantyClockIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" />
      <path d="M12 8.5v3l2 1.2" />
    </IconBase>
  )
}
