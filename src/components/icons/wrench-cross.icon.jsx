/**
 * wrench-cross — crossed wrench and screwdriver (maintenance). Registered as `wrench-cross`.
 */
import IconBase from './IconBase'

export default function WrenchCrossIcon(props) {
  return (
    <IconBase {...props}>
      {/* wrench */}
      <path d="M6.5 4.5a3 3 0 0 0 3.8 3.8l8.4 8.4a1.8 1.8 0 0 1-2.6 2.6L7.7 10.9A3 3 0 0 1 3.9 7.1z" />
      {/* screwdriver crossing */}
      <path d="M17.5 4.5 20 7l-6.6 6.6-2.5-2.5z" />
      <path d="m11 12-4.5 4.5" />
    </IconBase>
  )
}
