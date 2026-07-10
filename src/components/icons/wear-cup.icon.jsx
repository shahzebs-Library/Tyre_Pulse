/**
 * wear-cup — cupping/scalloped wear: a tyre tread surface with a repeating
 * wave/dished wear pattern. Registered as `wear-cup`.
 */
import IconBase from './IconBase'

export default function WearCupIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 9h16v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M4 11q2 3 4 0t4 0 4 0 4 0" />
    </IconBase>
  )
}
