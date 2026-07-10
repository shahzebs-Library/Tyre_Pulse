/**
 * ply-rating — tyre ply/casing layers: a stack of parallel cord plies denoting
 * ply rating strength. Registered as `ply-rating`.
 */
import IconBase from './IconBase'

export default function PlyRatingIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <path d="M6 5v14M18 5v14" />
    </IconBase>
  )
}
