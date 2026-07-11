/**
 * dot-code — DOT tyre identification stamp: an oval sidewall stamp with a row of
 * code marks. Registered as `dot-code`.
 */
import IconBase from './IconBase'

export default function DotCodeIcon(props) {
  return (
    <IconBase {...props}>
      <rect x="3" y="7" width="18" height="10" rx="5" />
      <path d="M7 12h.01M10 12h.01M13 12h3M18 12h.01" />
    </IconBase>
  )
}
