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

const ICONS = { at_vendor: Truck, awaiting_repair: Wrench, under_warranty: ShieldCheck, quarantine: ShieldAlert, damaged: AlertOctagon, scrap_pending: Trash2 }
const TONES = { at_vendor: 't-blue', awaiting_repair: 't-orange', under_warranty: 't-purple', quarantine: 't-amber', damaged: 't-red', scrap_pending: 't-red' }
const PILL = { at_vendor: 'info', awaiting_repair: 'warn', under_warranty: 'info', quarantine: 'warn', damaged: 'bad', scrap_pending: 'bad' }
const LOC_LABEL = { supplier_custody: 'Vendor custody', repairable: 'Repairable', warranty: 'Warranty', quarantine: 'Quarantine', damaged: 'Damaged', scrap: 'Scrap' }

export default function RepairablesPanel({ scope, can, onNavigate }) {
  const q = useInvQuery(() => loadStockWithLocations(scope), [scope.country, scope.site])
  const [state, setState] = useState('all')
  const rows = useMemo(() => repairableRows(q.data?.valuation, q.data?.locations), [q.data])
  const sum = summarizeRepairables(rows)
  const coverage = repairLocationCoverage(q.data?.locations)
  const shown = state === 'all' ? rows : rows.filter((r) => r.state === state)
  const loading = q.loading && !q.data
  const showValue = can('view_value')

  if (q.error) return <ErrorNote error={q.error} onRetry={q.retry} />
  if (q.data?.status === 'not_provisioned') return <NotSetUp what="Stock valuation" />

  const missing = coverage.filter((c) => !c.present)

  return (
    <div className="inv-hub" style={{ gap: 14 }}>
      {q.data?.truncated && <Note tone="warn">Only part of the stock was read. Choose a site to see all of it.</Note>}
      <div className="inv-kpis">
        {Object.keys(REPAIR_STATES).map((k) => (
          <Kpi key={k} icon={ICONS[k]} tone={TONES[k]} loading={loading} value={q.data ? sum.byState[k].rows : null}
            label={REPAIR_STATES[k]} onClick={() => setState(state === k ? 'all' : k)} />
        ))}
      </div>

      {missing.length > 0 && (
        <Note tone="info" title="Some repair locations are not set up">
          A part is tracked as out for repair when it sits in a location of that type. Missing for this scope:{' '}
          {missing.map((m) => LOC_LABEL[m.type]).join(', ')}. Add them under Locations; a vendor-custody location per repair
          vendor lets you see what each vendor holds.{' '}
          {onNavigate && <button type="button" className="cc-btn-ghost" onClick={() => onNavigate('locations')}>Open Locations</button>}
        </Note>
      )}

      <SectionCard title={state === 'all' ? 'Parts out of normal use' : REPAIR_STATES[state]}
        sub={showValue
          ? `Known value ${formatTotals(sum.totals)}. Unvalued quantity ${formatQty(sum.unvaluedQty)} (cost unknown, not zero).`
          : `Unvalued quantity ${formatQty(sum.unvaluedQty)}. Values need the view-value permission.`}
        action={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {state !== 'all' && <button type="button" className="cc-btn-ghost" onClick={() => setState('all')}>Show all states</button>}
            {onNavigate && can('transfer') && <button type="button" className="cc-btn" onClick={() => onNavigate('movements')}>Send to vendor (transfer)</button>}
          </div>
        )}>
        <div className="inv-scroll">
          <KitTable compact loading={loading} rows={shown} empty="No parts are out for repair, held, damaged or marked scrap."
            columns={alignNumeric([
              { key: 'item_code', header: 'Item code', cell: (r) => r.item_code || <span className="cc-na">No code</span> },
              { key: 'description', header: 'Description', cell: (r) => r.description || 'N/A' },
              { key: 'site', header: 'Site' },
              { key: 'location_code', header: 'Location', cell: (r) => r.location_code ? `${r.location_code}${r.location_type ? ` (${LOC_LABEL[r.location_type] || r.location_type})` : ''}` : 'N/A' },
              { key: 'condition', header: 'Condition' },
              { key: 'state', header: 'State', cell: (r) => <StatusPill value={r.state} tone={PILL[r.state]} label={REPAIR_STATES[r.state]} /> },
              { key: 'qty_on_hand', header: 'On hand', numeric: true, cell: (r) => formatQty(r.qty_on_hand) },
              { key: 'unvalued_qty', header: 'Unvalued qty', numeric: true, cell: (r) => formatQty(r.unvalued_qty) },
              ...(showValue ? [{ key: 'valued_amount', header: 'Known value', numeric: true, cell: (r) => (r.valued_amount === null ? 'N/A' : formatMoney(r.valued_amount, r.currency)) }] : []),
            ])} />
        </div>
      </SectionCard>

      <SectionCard title="How a repair is tracked" sub="Each step is an existing stock movement, so the ledger keeps the history.">
        <ul className="inv-tree">
          <li className="inv-tree-row"><span className="inv-tree-name">Removed part comes in: receive it with condition Damaged or Quarantine (Receiving).</span></li>
          <li className="inv-tree-row"><span className="inv-tree-name">Out to the vendor: transfer it to that vendor&apos;s custody location (Movements).</span></li>
          <li className="inv-tree-row"><span className="inv-tree-name">Back from the vendor: receive the transfer into a normal bin.</span></li>
          <li className="inv-tree-row"><span className="inv-tree-name">Cannot be repaired: propose scrap with a reason; it posts only after approval (Warranty and scrap).</span></li>
        </ul>
      </SectionCard>

      <UnitEventsSection scope={scope} can={can} />
    </div>
  )
}
