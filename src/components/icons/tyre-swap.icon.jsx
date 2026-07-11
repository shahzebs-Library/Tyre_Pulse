/**
 * tyre-swap — two tyres exchanging positions via swap arrows. Registered as `tyre-swap`.
 */
import IconBase from './IconBase'

export default function TyreSwapIcon(props) {
  return (
    <IconBase {...props}>
      {/* left tyre */}
      <circle cx="6.5" cy="6.5" r="4" />
      <circle cx="6.5" cy="6.5" r="1" />
      {/* right tyre */}
      <circle cx="17.5" cy="17.5" r="4" />
      <circle cx="17.5" cy="17.5" r="1" />
      {/* swap arrows */}
      <path d="M13 6.5h5l-2-2M11 17.5H6l2 2" />
    </IconBase>
  )
}
