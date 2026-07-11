/**
 * speed-rating — tyre speed rating: a speedometer arc with a fast-swept needle
 * and motion lines. Registered as `speed-rating`.
 */
import IconBase from './IconBase'

export default function SpeedRatingIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 18a8 8 0 0 1 16 0" />
      <path d="M12 18 17 9" />
      <circle cx="12" cy="18" r="1.3" fill="currentColor" stroke="none" />
      <path d="M3 12h2.5M18.5 12H21" />
    </IconBase>
  )
}
