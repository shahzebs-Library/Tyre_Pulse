/**
 * siping — tread siping: a tread block with fine zig-zag sipe slits for grip.
 * Registered as `siping`.
 */
import IconBase from './IconBase'

export default function SipingIcon(props) {
  return (
    <IconBase {...props}>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M9 6v12M15 6v12" />
      <path d="M6.5 8l0 2M12.5 8l0 2M17.5 8l0 2M6.5 13l0 2M12.5 13l0 2M17.5 13l0 2" />
    </IconBase>
  )
}
