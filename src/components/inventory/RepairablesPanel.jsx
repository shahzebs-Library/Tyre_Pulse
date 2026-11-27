/**
 * Repairable parts: stock that is out for repair or exchange, waiting for
 * repair, held for warranty, in quarantine, damaged or marked scrap.
 *
 * The state is read from the stock balance itself (stock condition and the
 * type of the location it sits in), so it can never disagree with the stock
 * register. Sending a part to a vendor is a stock transfer to a vendor-custody
 * location (Movements); bringing it back is the receiving end of that transfer.
 * Nothing on this screen posts stock. Per-serial installation and repair
 * history is recorded in UnitEventsSection (inventory_unit_events).
 */
import { useMemo, useState } from 'react'
import { Truck, Wrench, ShieldCheck, ShieldAlert, AlertOctagon, Trash2 } from 'lucide-react'
import { Kpi, KitTable } from '../commandCenter/kit'
import { useInvQuery, ErrorNote, Note, NotSetUp, SectionCard, StatusPill, alignNumeric } from './InvUi'
import { loadStockWithLocations } from '../../lib/api/warehouseAssets'
import { repairableRows, summarizeRepairables, repairLocationCoverage, REPAIR_STATES } from '../../lib/inventory/warehouseAssets'
import { formatMoney, formatQty, formatTotals } from '../../lib/inventory/inventoryMoney'
import UnitEventsSection from '../warehouseClasses/UnitEventsSection'
import { useLanguage } from '../../contexts/LanguageContext'

const ICONS = { at_vendor: Truck, awaiting_repair: Wrench, under_warranty: ShieldCheck, quarantine: ShieldAlert, damaged: AlertOctagon, scrap_pending: Trash2 }
const TONES = { at_vendor: 't-blue', awaiting_repair: 't-orange', under_warranty: 't-purple', quarantine: 't-amber', damaged: 't-red', scrap_pending: 't-red' }
const PILL = { at_vendor: 'info', awaiting_repair: 'warn', under_warranty: 'info', quarantine: 'warn', damaged: 'bad', scrap_pending: 'bad' }
const LOC_TYPES = ['supplier_custody', 'repairable', 'warranty', 'quarantine', 'damaged', 'scrap']

export default function RepairablesPanel({ scope, can, onNavigate }) {
  const { t } = useLanguage()
  const p = (k, v) => t(`wmsfloor.repair.${k}`, v)
  const NA = t('wmsfloor.common.na')
  const stateLabel = (k) => (REPAIR_STATES[k] ? t(`wmsfloor.repair.state.${k}`) : k)
  const locLabel = (k) => (LOC_TYPES.includes(k) ? t(`wmsfloor.repair.loc.${k}`) : k)
  const q = useInvQuery(() => loadStockWithLocations(scope), [scope.country, scope.site])
  const [state, setState] = useState('all')
  const rows = useMemo(() => repairableRows(q.data?.valuation, q.data?.locations), [q.data])
  const sum = summarizeRepairables(rows)
  const coverage = repairLocationCoverage(q.data?.locations)
  const shown = state === 'all' ? rows : rows.filter((r) => r.state === state)
  const loading = q.loading && !q.data
  const showValue = can('view_value')

  if (q.error) return <ErrorNote error={q.error} onRetry={q.retry} />
  if (q.data?.status === 'not_provisioned') return <NotSetUp what={p('what')} />

  const missing = coverage.filter((c) => !c.present)

  return (
    <div className="inv-hub" style={{ gap: 14 }}>
      {q.data?.truncated && <Note tone="warn">{p('truncated')}</Note>}
      <div className="inv-kpis">
        {Object.keys(REPAIR_STATES).map((k) => (
          <Kpi key={k} icon={ICONS[k]} tone={TONES[k]} loading={loading} value={q.data ? sum.byState[k].rows : null}
            label={stateLabel(k)} onClick={() => setState(state === k ? 'all' : k)} />
        ))}
      </div>

      {missing.length > 0 && (
        <Note tone="info" title={p('missingTitle')}>
          {p('missingBody', { list: missing.map((m) => locLabel(m.type)).join(', ') })}{' '}
          {onNavigate && <button type="button" className="cc-btn-ghost" onClick={() => onNavigate('locations')}>{p('openLocations')}</button>}
        </Note>
      )}

      <SectionCard title={state === 'all' ? p('title') : stateLabel(state)}
        sub={showValue
          ? p('subValue', { value: formatTotals(sum.totals), qty: formatQty(sum.unvaluedQty) })
          : p('subNoValue', { qty: formatQty(sum.unvaluedQty) })}
        action={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {state !== 'all' && <button type="button" className="cc-btn-ghost" onClick={() => setState('all')}>{p('showAll')}</button>}
            {onNavigate && can('transfer') && <button type="button" className="cc-btn" onClick={() => onNavigate('movements')}>{p('sendToVendor')}</button>}
          </div>
        )}>
        <div className="inv-scroll">
          <KitTable compact loading={loading} rows={shown} empty={p('empty')}
            columns={alignNumeric([
              { key: 'item_code', header: p('colItemCode'), cell: (r) => r.item_code || <span className="cc-na">{p('noCode')}</span> },
              { key: 'description', header: p('colDescription'), cell: (r) => r.description || NA },
              { key: 'site', header: p('colSite') },
              { key: 'location_code', header: p('colLocation'), cell: (r) => r.location_code ? `${r.location_code}${r.location_type ? ` (${locLabel(r.location_type)})` : ''}` : NA },
              { key: 'condition', header: p('colCondition') },
              { key: 'state', header: p('colState'), cell: (r) => <StatusPill value={r.state} tone={PILL[r.state]} label={stateLabel(r.state)} /> },
              { key: 'qty_on_hand', header: p('colOnHand'), numeric: true, cell: (r) => formatQty(r.qty_on_hand) },
              { key: 'unvalued_qty', header: p('colUnvalued'), numeric: true, cell: (r) => formatQty(r.unvalued_qty) },
              ...(showValue ? [{ key: 'valued_amount', header: p('colKnownValue'), numeric: true, cell: (r) => (r.valued_amount === null ? NA : formatMoney(r.valued_amount, r.currency)) }] : []),
            ])} />
        </div>
      </SectionCard>

      <SectionCard title={p('howTitle')} sub={p('howSub')}>
        <ul className="inv-tree">
          <li className="inv-tree-row"><span className="inv-tree-name">{p('step1')}</span></li>
          <li className="inv-tree-row"><span className="inv-tree-name">{p('step2')}</span></li>
          <li className="inv-tree-row"><span className="inv-tree-name">{p('step3')}</span></li>
          <li className="inv-tree-row"><span className="inv-tree-name">{p('step4')}</span></li>
        </ul>
      </SectionCard>

      <UnitEventsSection scope={scope} can={can} />
    </div>
  )
}
