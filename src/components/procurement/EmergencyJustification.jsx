/**
 * Emergency purchase justification form + read-only view (owner decision C,
 * 2026-11-24). The database checks every rule again (trg_po_controls); these
 * components only collect and show the fields.
 */
import { EMERGENCY_CATEGORIES, ROUTE_REASON_MIN, justificationFields } from '../../lib/procurement/emergencyJustification'

const L = ({ htmlFor, children }) => <label htmlFor={htmlFor} className="text-[var(--text-secondary)] text-xs mb-1 block">{children}</label>
const Err = ({ children }) => (children ? <p className="text-xs text-amber-300 mt-1">{children}</p> : null)

/**
 * @param {object} props
 * @param {object} props.value     EMPTY_EMERGENCY shape
 * @param {Function} props.onChange (next) => void
 * @param {object} props.errors    from validateEmergency (shown once showErrors is true)
 * @param {boolean} props.showErrors
 * @param {string} props.currency  the PO currency (estimate must match it)
 */
export function EmergencyJustificationFields({ value, onChange, errors = {}, showErrors = false, currency }) {
  const v = value || {}
  const set = (k) => (e) => onChange({ ...v, [k]: e.target.value })
  const e = showErrors ? errors : {}
  const routeLen = String(v.routeReason || '').trim().length
  return (
    <div className="space-y-3" role="group" aria-label="Emergency justification">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <L htmlFor="em-category">Reason category</L>
          <select id="em-category" className="input w-full" value={v.category || ''} onChange={set('category')} aria-invalid={!!e.category}>
            <option value="">Choose...</option>
            {EMERGENCY_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <Err>{e.category}</Err>
        </div>
        {v.category === 'other' && (
          <div>
            <L htmlFor="em-category-note">Describe the emergency</L>
            <input id="em-category-note" className="input w-full" maxLength={200} value={v.categoryNote || ''} onChange={set('categoryNote')} />
            <Err>{e.categoryNote}</Err>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <L htmlFor="em-asset">Affected asset number</L>
          <input id="em-asset" className="input w-full" maxLength={40} value={v.assetNo || ''} onChange={set('assetNo')} placeholder="e.g. TM514" autoCapitalize="characters" />
        </div>
        <div>
          <L htmlFor="em-jobcard">Job card</L>
          <input id="em-jobcard" className="input w-full" maxLength={60} value={v.jobCardNo || ''} onChange={set('jobCardNo')} placeholder="e.g. GCKR/JC/1324/0526" />
        </div>
      </div>
      <p className="text-xs text-[var(--text-muted)]">Give the asset, the job card, or both. They are checked against the asset register and job cards of the order's country.</p>
      <Err>{e.asset || e.country}</Err>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <L htmlFor="em-hours">Downtime if we wait (hours)</L>
          <input id="em-hours" className="input w-full" type="number" min="0" step="0.5" inputMode="decimal" value={v.downtimeHours ?? ''} onChange={set('downtimeHours')} />
          <Err>{e.downtimeHours}</Err>
        </div>
        <div className="sm:col-span-2">
          <L htmlFor="em-impact">Impact of waiting</L>
          <input id="em-impact" className="input w-full" maxLength={300} value={v.impact || ''} onChange={set('impact')} placeholder="e.g. pour at Diriyah stops, 3 trucks idle" />
          <Err>{e.impact}</Err>
        </div>
      </div>
      <div>
        <L htmlFor="em-route">Why the normal approval route could not be used</L>
        <textarea id="em-route" className="input w-full" rows={3} maxLength={1000} value={v.routeReason || ''} onChange={set('routeReason')} />
        <p className={`text-xs mt-1 ${routeLen >= ROUTE_REASON_MIN ? 'text-[var(--text-muted)]' : 'text-amber-300'}`}>{routeLen} of at least {ROUTE_REASON_MIN} characters</p>
        <Err>{e.routeReason}</Err>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <L htmlFor="em-est">Estimated value</L>
          <input id="em-est" className="input w-full" type="number" min="0" step="0.01" inputMode="decimal" value={v.estValue ?? ''} onChange={set('estValue')} />
          <Err>{e.estValue}</Err>
        </div>
        <div>
          <L htmlFor="em-cur">Currency</L>
          <input id="em-cur" className="input w-full" value={currency || v.estCurrency || ''} readOnly aria-readonly="true"
            title="The estimate uses the order's currency. Currencies are not converted." />
          <Err>{e.estCurrency}</Err>
        </div>
        <div>
          <L htmlFor="em-attach">Attachment path (optional)</L>
          <input id="em-attach" className="input w-full" maxLength={500} value={v.attachmentPath || ''} onChange={set('attachmentPath')} placeholder="e.g. quotes/po-evidence.pdf" />
        </div>
      </div>
      <Err>{e.supplier}</Err>
      <p className="text-xs text-[var(--text-muted)]">Requested by is recorded automatically from your sign-in. Another buyer must approve this order after it is placed, within their approval limit.</p>
    </div>
  )
}

/** Read-only full justification for a purchase order row. */
export function EmergencyJustificationView({ po, compact = false }) {
  if (!po?.is_emergency) return null
  return (
    <dl className={`grid gap-x-3 gap-y-1 text-xs ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
      {justificationFields(po).map(([k, val]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[var(--text-muted)]">{k}</dt>
          <dd className="text-[var(--text-primary)] break-words">{val}</dd>
        </div>
      ))}
    </dl>
  )
}
