/** Small shared pieces for the Rotation Schedule page and its panels. */
import { formatDate } from '../../lib/formatters'

export function fmt(n, dec = 0) {
  if (n == null || !Number.isFinite(Number(n))) return 'N/A'
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
export function fmtDate(d) {
  if (!d) return 'N/A'
  return formatDate(d, 'All', { day: '2-digit', month: 'short', year: 'numeric' })
}
export const fmtKm = (n) => (n == null ? 'N/A' : `${fmt(n)} km`)

// Vehicle rotation status (from the compliance engine). The word is always
// shown, so colour is never the only signal.
export const VEHICLE_STATUS_TONE = {
  'On Schedule': 'good', 'Due Soon': 'warn', Overdue: 'bad', Unmeasured: 'info', 'No History': 'muted',
}
export function StatusBadge({ status }) {
  return <span className={`cc-pill ${VEHICLE_STATUS_TONE[status] || 'muted'}`}>{status}</span>
}
