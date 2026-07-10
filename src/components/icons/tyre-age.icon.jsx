/**
 * tyre-age — tyre age: a tyre with an inset clock indicating service age.
 * Registered as `tyre-age`.
 */
import IconBase from './IconBase'

export default function TyreAgeIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 9.5v2.5l1.8 1.1" />
    </IconBase>
  )
}
