/**
 * tyre-bead — tyre bead seat: a tyre cross-section highlighting the bead bundle
 * where the tyre seats on the rim. Registered as `tyre-bead`.
 */
import IconBase from './IconBase'

export default function TyreBeadIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M6 4c-2 4-2 12 0 16" />
      <path d="M6 4h9a5 5 0 0 1 5 5" />
      <path d="M6 20h9a5 5 0 0 0 5-5" />
      <circle cx="8" cy="7.5" r="1.4" />
      <circle cx="8" cy="16.5" r="1.4" />
    </IconBase>
  )
}
