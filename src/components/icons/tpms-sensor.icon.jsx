/**
 * tpms-sensor — tyre pressure monitoring sensor: a valve-mounted sensor emitting
 * wireless signal waves. Registered as `tpms-sensor`.
 */
import IconBase from './IconBase'

export default function TpmsSensorIcon(props) {
  return (
    <IconBase {...props}>
      <rect x="7" y="13" width="7" height="6" rx="1.5" />
      <path d="M10.5 13v-2.5" />
      <path d="M9.2 10.5h2.6" />
      <path d="M15.5 6.5a7 7 0 0 1 0 9" />
      <path d="M17.8 4.5a10 10 0 0 1 0 13" />
    </IconBase>
  )
}
