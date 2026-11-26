import { useEffect, useState, useCallback } from 'react'
import { ExternalLink, AlertTriangle } from 'lucide-react'
import { Link } from 'react-router-dom'
import HandoverSignOffPanel from './HandoverSignOffPanel'
import HandoverAuthorizationPanel from './HandoverAuthorizationPanel'
import { getHandoverReport } from '../../lib/api/handoverReports'
import { toUserMessage } from '../../lib/safeError'
import { isFrozen } from '../../lib/handoverAuthorization'

function fmtWhen(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}

/**
 * A vehicle handover opened from the unified Approvals queue. It reads the full
 * row, shows both driver signatures, the location and the lock state, and
 * offers the supervisor / fleet incharge decision through the same
 * HandoverSignOffPanel the handover page uses (decide_handover_approval). No
 * second decision path.
 *
 * @param {{ item: object, onClose: Function, onActed?: Function, DrawerShell: Function }} props
 */
export default function HandoverApprovalDrawer({ item, onClose, onActed, DrawerShell }) {
  const [row, setRow] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try { setRow((await getHandoverReport(item.id)) || null) } catch (err) { setError(toUserMessage(err, 'Could not load the handover.')) }
  }, [item.id])
  useEffect(() => { load() }, [load])

  const h = row || item.raw || {}
  const details = [
    ['Document no', h.document_no],
    ['Asset', h.asset_no],
    ['Type', h.handover_type === 'checkin' ? 'Check-in' : 'Check-out'],
    ['Handover at', fmtWhen(h.handover_at)],
    ['Handing over', h.from_signed_name || h.from_driver],
    ['Receiving', h.to_signed_name || h.to_driver],
    ['Odometer', h.odometer_km != null ? `${Number(h.odometer_km).toLocaleString('en-US')} km` : null],
    ['Site', h.site],
    ['Country', h.country],
  ]

  return (
    <DrawerShell title={item.title} subtitle={item.subtitle} onClose={onClose}>
      {error && (
        <p className="text-sm text-red-400" role="alert"><AlertTriangle size={14} className="inline" aria-hidden="true" /> {error}</p>
      )}
      <dl className="grid grid-cols-2 gap-3 text-sm">
        {details.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[var(--text-muted)] text-xs">{k}</dt>
            <dd className="font-medium">{v || 'N/A'}</dd>
          </div>
        ))}
      </dl>
      {row && !isFrozen(row) && (
        <p className="text-sm text-amber-400">
          <AlertTriangle size={14} className="inline" aria-hidden="true" /> The drivers have not both signed this handover, so it cannot be approved yet.
        </p>
      )}
      <div className="cc">
        {row && <HandoverAuthorizationPanel handover={row} onSigned={load} />}
        {row && <HandoverSignOffPanel handover={row} onDecided={() => { load(); onActed?.({ keepOpen: true }) }} />}
      </div>
      <Link to={`/handovers?view=${encodeURIComponent(item.id)}`} className="inline-flex items-center gap-1 text-sm">
        Open in Vehicle Handover <ExternalLink size={13} aria-hidden="true" />
      </Link>
    </DrawerShell>
  )
}
