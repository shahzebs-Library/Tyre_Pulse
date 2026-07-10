/**
 * wet-grip — wet grip performance: a tyre contact patch above water droplets
 * being channelled away. Registered as `wet-grip`.
 */
import IconBase from './IconBase'

export default function WetGripIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 6h16v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M8 6v6M12 6v6M16 6v6" />
      <path d="M7 16.5c0 1-.7 1.5-1.5 1.5S4 17.5 4 16.5c0-.8 1.5-2.5 1.5-2.5s1.5 1.7 1.5 2.5Z" />
      <path d="M13.5 18c0 1-.7 1.5-1.5 1.5s-1.5-.5-1.5-1.5c0-.8 1.5-2.5 1.5-2.5s1.5 1.7 1.5 2.5Z" />
      <path d="M20 16.5c0 1-.7 1.5-1.5 1.5S17 17.5 17 16.5c0-.8 1.5-2.5 1.5-2.5s1.5 1.7 1.5 2.5Z" />
    </IconBase>
  )
}
