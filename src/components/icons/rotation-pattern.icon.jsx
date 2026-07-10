/**
 * rotation-pattern — tyre rotation cross-pattern: four corner wheels linked by a
 * crossing swap path. Registered as `rotation-pattern`.
 */
import IconBase from './IconBase'

export default function RotationPatternIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="6" cy="6" r="1.6" />
      <circle cx="18" cy="6" r="1.6" />
      <circle cx="6" cy="18" r="1.6" />
      <circle cx="18" cy="18" r="1.6" />
      <path d="M7.2 7.2 16.8 16.8M16.8 7.2 7.2 16.8" />
    </IconBase>
  )
}
