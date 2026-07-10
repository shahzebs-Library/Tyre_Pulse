/**
 * balance-weight — wheel balancing weight: a clip-on rim weight attached to a
 * rim arc. Registered as `balance-weight`.
 */
import IconBase from './IconBase'

export default function BalanceWeightIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 6a12 12 0 0 1 16 0" />
      <path d="M8.5 9h7l-1 8a2 2 0 0 1-2 1.8h-1a2 2 0 0 1-2-1.8z" />
      <path d="M8.5 9c-.5-1.6.6-3 1.5-3h4c.9 0 2 1.4 1.5 3" />
    </IconBase>
  )
}
