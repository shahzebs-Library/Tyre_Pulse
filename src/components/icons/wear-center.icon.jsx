/**
 * wear-center — centre wear (over-inflation): a tyre cross-section worn lower in
 * the middle than the shoulders. Registered as `wear-center`.
 */
import IconBase from './IconBase'

export default function WearCenterIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 8h16v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M4 9q4 4 8 0 4-4 8 0" />
    </IconBase>
  )
}
