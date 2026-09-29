/**
 * Detail view for one exchange, opened by clicking a register row. Everything
 * shown comes from the derived exchange (tyreExchangeView.deriveExchanges); a
 * value the tyre register does not carry reads "Not recorded".
 */
import { ArrowRight, History } from 'lucide-react'
import Modal from '../ui/Modal'
import { Stop } from './ExchangeInsights'
import { TYPE_TONE, STATUS_TONE, movementFlow } from '../../lib/tyreExchangeView'

function Tyre({ label, tyre }) {
  return (
    <div className="tx-dd">
      <dt>{label}</dt>
      <dd>
        {tyre
          ? (
            <>
              <b title={tyre.serial || undefined}>{tyre.serial || 'Serial not recorded'}</b>
              <small>{[tyre.brand, tyre.size].filter(Boolean).join(', ') || 'Brand and size not recorded'}{tyre.retread ? ', retread' : ''}</small>
            </>
          )
          : <span className="cc-na">None</span>}
      </dd>
    </div>
  )
}

export default function ExchangeDetailModal({ open, exchange, onClose, onOpenCustody }) {
  if (!exchange) return null
  const e = exchange
  const flow = movementFlow(e)
  const serial = e.installed?.serial || e.removed?.serial
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${e.type} on ${e.asset || 'an unrecorded vehicle'}`}
      subtitle={`${e.date || 'Date not recorded'}. Time of day and technician are not recorded on tyre records.`}
      size="lg"
      footer={(
        <div className="cc tx-modal-foot">
          {serial && (
            <button type="button" className="cc-btn-ghost" onClick={() => onOpenCustody(serial)}>
              <History size={14} aria-hidden="true" /> Chain of custody for {serial}
            </button>
          )}
          <button type="button" className="cc-btn-primary" onClick={onClose}>Close</button>
        </div>
      )}
    >
      <div className="cc tx-detail">
        <div className="tx-flow">
          {flow.from
            ? <Stop title={e.type === 'Replacement' ? 'Removed from' : 'From'} spot={flow.from} tyre={flow.fromTyre} />
            : <div className="tx-stop"><small>From</small><b>Stock</b><span>No earlier record on this position</span></div>}
          <span className={`tx-flow-arrow cc-pill ${TYPE_TONE[e.type]}`}><ArrowRight size={14} aria-hidden="true" /> {e.type}</span>
          {flow.to
            ? <Stop title="Installed on" spot={flow.to} tyre={flow.toTyre} />
            : <div className="tx-stop"><small>To</small><b>Off the vehicle</b><span>No later tyre recorded on this position</span></div>}
        </div>
        <dl className="tx-dl">
          <div className="tx-dd"><dt>Vehicle / asset</dt><dd><b title={e.asset || undefined}>{e.asset || 'N/A'}</b><small>{e.vehicleType || 'Type not recorded'}</small></dd></div>
          <div className="tx-dd"><dt>Position</dt><dd>{e.position || 'Not recorded'}</dd></div>
          <div className="tx-dd"><dt>Site</dt><dd>{e.site || 'Not recorded'}</dd></div>
          <div className="tx-dd"><dt>Country</dt><dd>{e.country || 'Not recorded'}</dd></div>
          <Tyre label="Removed tyre" tyre={e.removed} />
          <Tyre label="Installed tyre" tyre={e.installed} />
          <div className="tx-dd"><dt>Installed as</dt><dd>{e.installedKind || 'N/A'}</dd></div>
          <div className="tx-dd"><dt>Tyre status now</dt><dd>{e.status ? <span className={`cc-pill ${STATUS_TONE[e.status] || 'muted'}`}>{e.status}</span> : 'Not recorded'}</dd></div>
          <div className="tx-dd"><dt>Photos</dt><dd>{e.photos.length ? `${e.photos.length} on the tyre record` : 'None recorded'}</dd></div>
        </dl>
      </div>
    </Modal>
  )
}
