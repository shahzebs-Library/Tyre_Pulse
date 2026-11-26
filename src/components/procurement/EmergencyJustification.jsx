/**
 * Emergency purchase justification form + read-only view (owner decision C,
 * 2026-11-24). The database checks every rule again (trg_po_controls); these
 * components only collect and show the fields.
 */
import { EMERGENCY_CATEGORIES, ROUTE_REASON_MIN, IMPACT_TEXT_MIN, OTHER_NOTE_MIN, justificationFields } from '../../lib/procurement/emergencyJustification'
import { useLanguage } from '../../contexts/LanguageContext'

// Field order matches justificationFields() in the lib.
const FIELD_KEYS = ['category', 'asset', 'jobCard', 'impact', 'route', 'estimate', 'supplier', 'requestedBy', 'attachment']
const VALUE_KEYS = { 'N/A': 'na', None: 'none', 'No estimate': 'noEstimate' }

/** Translate a validateEmergency() message by its field (the lib returns English). */
function errText(t, field, msg, currency) {
  if (!msg) return msg
  const min = { categoryNote: OTHER_NOTE_MIN, impact: IMPACT_TEXT_MIN, routeReason: ROUTE_REASON_MIN }[field]
  if (field === 'estCurrency' && /^The order is in/.test(msg)) {
    return t('wmsprocure.emergency.err.estCurrencyMismatch', { currency: String(currency || '').toUpperCase() })
  }
  return t(`wmsprocure.emergency.err.${field}`, min != null ? { min } : undefined)
}

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
  const { t } = useLanguage()
  const er = (f) => errText(t, f, e[f], currency)
  return (
    <div className="space-y-3" role="group" aria-label={t('wmsprocure.emergency.aria')}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <L htmlFor="em-category">{t('wmsprocure.emergency.reasonCategory')}</L>
          <select id="em-category" className="input w-full" value={v.category || ''} onChange={set('category')} aria-invalid={!!e.category}>
            <option value="">{t('wmsprocure.emergency.choose')}</option>
            {EMERGENCY_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{t(`wmsprocure.emergency.cat.${c.value}`)}</option>)}
          </select>
          <Err>{er('category')}</Err>
        </div>
        {v.category === 'other' && (
          <div>
            <L htmlFor="em-category-note">{t('wmsprocure.emergency.describe')}</L>
            <input id="em-category-note" className="input w-full" maxLength={200} value={v.categoryNote || ''} onChange={set('categoryNote')} />
            <Err>{er('categoryNote')}</Err>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <L htmlFor="em-asset">{t('wmsprocure.emergency.assetNo')}</L>
          <input id="em-asset" className="input w-full" maxLength={40} value={v.assetNo || ''} onChange={set('assetNo')} placeholder="e.g. TM514" autoCapitalize="characters" />
        </div>
        <div>
          <L htmlFor="em-jobcard">{t('wmsprocure.emergency.jobCard')}</L>
          <input id="em-jobcard" className="input w-full" maxLength={60} value={v.jobCardNo || ''} onChange={set('jobCardNo')} placeholder="e.g. GCKR/JC/1324/0526" />
        </div>
      </div>
      <p className="text-xs text-[var(--text-muted)]">{t('wmsprocure.emergency.assetHelp')}</p>
      <Err>{er('asset') || er('country')}</Err>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <L htmlFor="em-hours">{t('wmsprocure.emergency.downtime')}</L>
          <input id="em-hours" className="input w-full" type="number" min="0" step="0.5" inputMode="decimal" value={v.downtimeHours ?? ''} onChange={set('downtimeHours')} />
          <Err>{er('downtimeHours')}</Err>
        </div>
        <div className="sm:col-span-2">
          <L htmlFor="em-impact">{t('wmsprocure.emergency.impact')}</L>
          <input id="em-impact" className="input w-full" maxLength={300} value={v.impact || ''} onChange={set('impact')} placeholder={t('wmsprocure.emergency.impactPlaceholder')} />
          <Err>{er('impact')}</Err>
        </div>
      </div>
      <div>
        <L htmlFor="em-route">{t('wmsprocure.emergency.routeReason')}</L>
        <textarea id="em-route" className="input w-full" rows={3} maxLength={1000} value={v.routeReason || ''} onChange={set('routeReason')} />
        <p className={`text-xs mt-1 ${routeLen >= ROUTE_REASON_MIN ? 'text-[var(--text-muted)]' : 'text-amber-300'}`}>{t('wmsprocure.emergency.charCount', { count: routeLen, min: ROUTE_REASON_MIN })}</p>
        <Err>{er('routeReason')}</Err>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <L htmlFor="em-est">{t('wmsprocure.emergency.estValue')}</L>
          <input id="em-est" className="input w-full" type="number" min="0" step="0.01" inputMode="decimal" value={v.estValue ?? ''} onChange={set('estValue')} />
          <Err>{er('estValue')}</Err>
        </div>
        <div>
          <L htmlFor="em-cur">{t('wmsprocure.emergency.currency')}</L>
          <input id="em-cur" className="input w-full" value={currency || v.estCurrency || ''} readOnly aria-readonly="true"
            title={t('wmsprocure.emergency.currencyTitle')} />
          <Err>{er('estCurrency')}</Err>
        </div>
        <div>
          <L htmlFor="em-attach">{t('wmsprocure.emergency.attachment')}</L>
          <input id="em-attach" className="input w-full" maxLength={500} value={v.attachmentPath || ''} onChange={set('attachmentPath')} placeholder="e.g. quotes/po-evidence.pdf" />
        </div>
      </div>
      <Err>{er('supplier')}</Err>
      <p className="text-xs text-[var(--text-muted)]">{t('wmsprocure.emergency.requestedByHelp')}</p>
    </div>
  )
}

/** Read-only full justification for a purchase order row. */
export function EmergencyJustificationView({ po, compact = false }) {
  const { t } = useLanguage()
  if (!po?.is_emergency) return null
  return (
    <dl className={`grid gap-x-3 gap-y-1 text-xs ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
      {justificationFields(po).map(([k, val], i) => (
        <div key={k} className="min-w-0">
          <dt className="text-[var(--text-muted)]">{FIELD_KEYS[i] ? t(`wmsprocure.emergency.f.${FIELD_KEYS[i]}`) : k}</dt>
          <dd className="text-[var(--text-primary)] break-words">{VALUE_KEYS[val] ? t(`wmsprocure.emergency.v.${VALUE_KEYS[val]}`) : i === 0 && po.emergency_category !== 'other' && EMERGENCY_CATEGORIES.some((c) => c.value === po.emergency_category) ? t(`wmsprocure.emergency.cat.${po.emergency_category}`) : val}</dd>
        </div>
      ))}
    </dl>
  )
}
