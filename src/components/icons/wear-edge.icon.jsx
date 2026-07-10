/**
 * wear-edge — edge/shoulder wear: a tyre cross-section with the outer edges worn
 * lower than the centre. Registered as `wear-edge`.
 */
import IconBase from './IconBase'

export default function WearEdgeIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 8h16v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M4 9.5q4 3 8 0 4-3 8 0" />
    </IconBase>
  )
}
