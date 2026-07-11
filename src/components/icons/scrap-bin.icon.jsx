/**
 * scrap-bin — scrap tyre bin: a waste bin holding a discarded tyre.
 * Registered as `scrap-bin`.
 */
import IconBase from './IconBase'

export default function ScrapBinIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M5 7h14l-1.2 12.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z" />
      <path d="M3.5 7h17" />
      <path d="M9.5 7 10 4h4l.5 3" />
      <circle cx="12" cy="13.5" r="3" />
    </IconBase>
  )
}
