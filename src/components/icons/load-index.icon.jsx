/**
 * load-index — tyre load rating: a downward load arrow pressing onto a tyre
 * contact patch. Registered as `load-index`.
 */
import IconBase from './IconBase'

export default function LoadIndexIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 3v9" />
      <path d="m8 8 4 4 4-4" />
      <path d="M5 16h14" />
      <path d="M6.5 19.5 8 16M17.5 19.5 16 16M12 20v-4" />
    </IconBase>
  )
}
