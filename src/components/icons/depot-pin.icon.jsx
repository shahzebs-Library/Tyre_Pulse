/**
 * depot-pin — a map pin containing a warehouse mark. Registered as `depot-pin`.
 */
import IconBase from './IconBase'

export default function DepotPinIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 21.5c4.5-4.6 7-8 7-11.5a7 7 0 1 0-14 0c0 3.5 2.5 6.9 7 11.5z" />
      {/* warehouse inside */}
      <path d="M8 12.5 12 9.5l4 3v3.5H8z" />
      <path d="M11 16v-2.2h2V16" />
    </IconBase>
  )
}
