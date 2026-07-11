/**
 * dual-tyre — dual/twin tyre assembly: two side-by-side tyres viewed head-on on
 * a shared axle. Registered as `dual-tyre`.
 */
import IconBase from './IconBase'

export default function DualTyreIcon(props) {
  return (
    <IconBase {...props}>
      <rect x="4" y="5" width="6" height="14" rx="2" />
      <rect x="14" y="5" width="6" height="14" rx="2" />
      <path d="M7 8v8M17 8v8" />
    </IconBase>
  )
}
