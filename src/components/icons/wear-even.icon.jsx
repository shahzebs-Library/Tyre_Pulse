/**
 * wear-even — even tread wear: a tyre cross-section with a flat, uniform wear
 * line across the tread. Registered as `wear-even`.
 */
import IconBase from './IconBase'

export default function WearEvenIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 8h16v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M4 11h16" />
      <path d="M8 8v3M12 8v3M16 8v3" />
    </IconBase>
  )
}
