/**
 * Lubricants: grade, bulk stock, dispensing to an asset (with its job card) and
 * consumption per asset.
 *
 * Dispensing is one server RPC (inv_lubricant_dispense, migration
 * 20261124133000, NOT APPLIED) that issues the stock through the normal ledger
 * and records the asset and job card. Quantity stays in the stock's own unit;
 * nothing is converted or invented. Consumption combines in-app dispenses and
 * the ERP's oil lines (parts_consumption); money per currency, unknown cost
 * stays unvalued.
 *
 * Props: { scope, can, userId, onNavigate }.
 */
import { useMemo, useState } from 'react'
import { Droplets, Truck, ClipboardList } from 'lucide-react'
import { Kpi, KitTable } from '../commandCenter/kit'
import Modal from '../ui/Modal'
import { useInvQuery, ErrorNote, Note, SectionCard, Field, SearchBox, fmtDate, fmtDateTime, alignNumeric } from '../inventory/InvUi'
import { newIdempotencyKey } from '../../lib/api/inventory'
import { loadLubricantStock, listLubricantConsumption, listDispenses, dispenseLubricant, setLubricantGrade } from '../../lib/api/warehouseAssets'
import { consumptionByAsset, qtyByUnitText, validateDispense } from '../../lib/warehouseClasses/specialClasses'
import { monthsAgoStart } from '../../lib/inventory/warehouseAssets'
import { formatMoney, formatQty } from '../../lib/inventory/inventoryMoney'
import { toUserMessage } from '../../lib/inventory/errorText'

const PERIODS = [{ v: 3, l: 'Last 3 months' }, { v: 6, l: 'Last 6 months' }, { v: 12, l: 'Last 12 months' }]

export default function LubricantsPanel({ scope, can = () => false }) {
  const [months, setMonths] = useState(6)
  const [term, setTerm] = useState('')
  const [dispenseFor, setDispenseFor] = useState(null)
  const [gradeFor, setGradeFor] = useState(null)
  const fromMonth = monthsAgoStart(months)
  const stock = useInvQuery(() => loadLubricantStock(scope), [scope.country, scope.site])
  const usage = useInvQuery(() => listLubricantConsumption({ ...scope, fromMonth }), [scope.country, scope.site, fromMonth])
  const recent = useInvQuery(() => listDispenses(scope), [scope.country, scope.site])

  const itemById = useMemo(() => new Map((stock.data?.items || []).map((i) => [i.id, i])), [stock.data])
  const lines = useMemo(() => (stock.data?.stock || []).map((s) => ({ ...s, item: itemById.get(s.item_id) })), [stock.data, itemById])
  const byAsset = useMemo(() => consumptionByAsset(usage.data?.rows), [usage.data])
  const shownAssets = useMemo(() => {
    const s = term.trim().toUpperCase()
    return s ? byAsset.filter((r) => r.asset_no.includes(s)) : byAsset
  }, [byAsset, term])

  const notSetUp = usage.data?.status === 'not_provisioned'
  const showValue = can('view_value')
  const canDispense = can('issue') && !notSetUp
  const canGrade = can('engineering_approve') && !notSetUp
  const graded = (stock.data?.items || []).filter((i) => i.lubricant_grade).length

  if (stock.error) return <ErrorNote error={stock.error} onRetry={stock.retry} />

  return (
    <div className="inv-hub" style={{ gap: 14 }}>
      <div className="inv-kpis">
        <Kpi icon={Droplets} tone="t-blue" loading={stock.loading && !stock.data} value={stock.data ? stock.data.items.length : null} label="Lubricant items" />
        <Kpi icon={ClipboardList} tone="t-amber" loading={stock.loading && !stock.data} value={stock.data ? graded : null} label="With a grade recorded" />
        <Kpi icon={Truck} tone="t-green" loading={usage.loading && !usage.data} display={notSetUp ? 'Not set up' : undefined}
          value={notSetUp ? null : byAsset.length} label="Assets that received lubricant" />
      </div>

      {notSetUp && (
        <Note tone="warn" title="Dispensing to an asset is not set up yet">
          Lubricant grade, dispensing with asset and job card, and the consumption report need migration 20261124133000
          (not applied). Stock below is read from the register as it is today.
        </Note>
      )}

      <SectionCard title="Lubricant stock" sub="Quantities are in the unit each line is stocked in. A missing unit is shown as Not recorded.">
        <div className="inv-scroll">
          <KitTable compact loading={stock.loading && !stock.data} rows={lines} empty="No lubricant is in stock for this scope."
            columns={alignNumeric([
              { key: 'code', header: 'Item', cell: (r) => `${r.item?.item_code || 'No code'}: ${r.item?.item_name || ''}` },
              { key: 'grade', header: 'Grade', cell: (r) => r.item?.lubricant_grade || <span className="cc-na">Not recorded</span> },
              { key: 'site', header: 'Site' },
              { key: 'uom', header: 'Unit', cell: (r) => r.uom || r.item?.base_uom || r.item?.uom || <span className="cc-na">Not recorded</span> },
              { key: 'qty_on_hand', header: 'On hand', numeric: true, cell: (r) => formatQty(r.qty_on_hand) },
              { key: 'act', header: '', sortable: false, cell: (r) => (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {canDispense && <button type="button" className="cc-btn-ghost" onClick={() => setDispenseFor(r)}>Dispense</button>}
                  {canGrade && <button type="button" className="cc-btn-ghost" onClick={() => setGradeFor(r.item)}>Grade</button>}
                </div>
              ) },
            ])} />
        </div>
      </SectionCard>

      {!notSetUp && (
        <SectionCard title="Consumption per asset" sub="In-app dispenses and ERP oil issues. Values per currency; lines with no cost are counted as unvalued."
          action={(
            <select className="cc-select" aria-label="Period" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              {PERIODS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
            </select>
          )}>
          {usage.error && <ErrorNote error={usage.error} onRetry={usage.retry} />}
          {usage.data?.truncated && <Note tone="warn">Only part of the period was read. Choose a site or a shorter period.</Note>}
          <SearchBox value={term} onChange={setTerm} placeholder="Asset number" label="Search assets" />
          <div className="inv-scroll" style={{ marginTop: 8 }}>
            <KitTable compact loading={usage.loading && !usage.data} rows={shownAssets} empty="No lubricant was issued to an asset in this period."
              columns={alignNumeric([
                { key: 'asset_no', header: 'Asset' },
                { key: 'app', header: 'Dispensed in app', cell: (r) => qtyByUnitText(r.app.qty) },
                { key: 'erp', header: 'ERP oil issues', cell: (r) => qtyByUnitText(r.erp.qty) },
                ...(showValue ? [{ key: 'value', header: 'Known value', numeric: true, cell: (r) => (Object.keys(r.value).length
                  ? Object.entries(r.value).map(([c, v]) => formatMoney(v, c)).join(' | ') : 'N/A') }] : []),
                { key: 'unvaluedLines', header: 'Unvalued lines', numeric: true, cell: (r) => r.unvaluedLines },
                { key: 'lastMonth', header: 'Latest month', cell: (r) => (r.lastMonth ? String(r.lastMonth).slice(0, 7) : 'N/A') },
              ])} />
          </div>
        </SectionCard>
      )}

      {!notSetUp && (
        <SectionCard title="Recent dispenses" sub="Newest first.">
          {recent.error && <ErrorNote error={recent.error} onRetry={recent.retry} />}
          <div className="inv-scroll">
            <KitTable compact loading={recent.loading && !recent.data} rows={recent.data?.rows || []} empty="Nothing dispensed in the app yet."
              columns={alignNumeric([
                { key: 'dispensed_at', header: 'When', cell: (r) => fmtDateTime(r.dispensed_at) },
                { key: 'asset_no', header: 'Asset' },
                { key: 'job_card_no', header: 'Job card', cell: (r) => r.job_card_no || 'None' },
                { key: 'item', header: 'Item', cell: (r) => itemById.get(r.item_id)?.item_code || 'N/A' },
                { key: 'qty', header: 'Quantity', numeric: true, cell: (r) => `${formatQty(r.qty)}${r.uom ? ` ${r.uom}` : ''}` },
                { key: 'meter', header: 'Meter', cell: (r) => (r.meter_reading === null || r.meter_reading === undefined ? '' : `${formatQty(r.meter_reading)} ${r.meter_type || ''}`) },
                { key: 'site', header: 'Site' },
              ])} />
          </div>
        </SectionCard>
      )}

      {dispenseFor && <DispenseModal line={dispenseFor} onClose={() => setDispenseFor(null)}
        onDone={() => { setDispenseFor(null); stock.retry(); usage.retry(); recent.retry() }} />}
      {gradeFor && <GradeModal item={gradeFor} onClose={() => setGradeFor(null)} onDone={() => { setGradeFor(null); stock.retry() }} />}
      <p className="cc-card-sub">Data from {fmtDate(fromMonth)}.</p>
    </div>
  )
}

function DispenseModal({ line, onClose, onDone }) {
  const [form, setForm] = useState({ qty: '', asset_no: '', job_card_no: '', meter_reading: '', meter_type: 'km', note: '' })
  // One key per request: an identical retry after a network error reuses it, so
  // the dispense is never posted twice. A changed form, or a refusal for lack of
  // stock, makes the next press a new request with a new key; reusing the old
  // key would only replay the stored refusal.
  const [key, setKey] = useState(() => newIdempotencyKey())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => { setKey(newIdempotencyKey()); setForm((f) => ({ ...f, [k]: e.target.value })) }
  const unit = line.uom || line.item?.base_uom || line.item?.uom || 'units as stocked'

  async function submit() {
    const v = validateDispense(line, form)
    if (v.error) { setError(v.error); return }
    setBusy(true); setError(null)
    try {
      const r = await dispenseLubricant({
        stock_id: line.id, qty: Number(form.qty), asset_no: form.asset_no.trim().toUpperCase(),
        job_card_no: form.job_card_no.trim() || null,
        meter_reading: form.meter_reading === '' ? null : Number(form.meter_reading),
        meter_type: form.meter_reading === '' ? null : form.meter_type, note: form.note.trim() || null,
      }, key)
      if (r?.status === 'refused_shortage') { setKey(newIdempotencyKey()); setError('Not enough free stock on this line.'); return }
      onDone()
    } catch (err) {
      setError(toUserMessage(err, 'The dispense could not be saved.'))
    } finally { setBusy(false) }
  }

  return (
    <Modal className="cc inv-panel" open onClose={() => !busy && onClose()} size="md" title="Dispense lubricant"
      subtitle={`${line.item?.item_code || 'No code'}: ${line.item?.item_name || ''} (${formatQty(line.qty_on_hand)} on hand at ${line.site})`}
      footer={(
        <div className="inv-actions">
          <button type="button" className="cc-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="cc-btn" onClick={submit} disabled={busy}>{busy ? 'Saving...' : 'Dispense'}</button>
        </div>
      )}>
      <div className="inv-form">
        {error && <p className="inv-err" role="alert">{error}</p>}
        <Field label={`Quantity (${unit})`} id="ld-qty">
          <input id="ld-qty" className="cc-input" type="number" min="0" step="any" value={form.qty} onChange={set('qty')} />
        </Field>
        <Field label="Asset number" id="ld-asset">
          <input id="ld-asset" className="cc-input" value={form.asset_no} onChange={set('asset_no')} maxLength={60} />
        </Field>
        <Field label="Job card (must be this asset's)" id="ld-jc" full>
          <input id="ld-jc" className="cc-input" value={form.job_card_no} onChange={set('job_card_no')} maxLength={80} />
        </Field>
        <Field label="Meter reading (optional)" id="ld-meter">
          <input id="ld-meter" className="cc-input" type="number" min="0" step="any" value={form.meter_reading} onChange={set('meter_reading')} />
        </Field>
        <Field label="Reading in" id="ld-mtype">
          <select id="ld-mtype" className="cc-select" value={form.meter_type} onChange={set('meter_type')}>
            <option value="km">km</option>
            <option value="hours">hours</option>
          </select>
        </Field>
        <Field label="Note" id="ld-note" full>
          <input id="ld-note" className="cc-input" value={form.note} onChange={set('note')} maxLength={400} />
        </Field>
      </div>
    </Modal>
  )
}

function GradeModal({ item, onClose, onDone }) {
  const [grade, setGrade] = useState(item.lubricant_grade || '')
  const [uom, setUom] = useState(item.base_uom || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit() {
    setBusy(true); setError(null)
    try {
      await setLubricantGrade({ item_id: item.id, lubricant_grade: grade.trim() || null, base_uom: uom || null })
      onDone()
    } catch (err) {
      setError(toUserMessage(err, 'The grade could not be saved.'))
    } finally { setBusy(false) }
  }

  return (
    <Modal className="cc inv-panel" open onClose={() => !busy && onClose()} size="sm" title="Lubricant grade"
      subtitle={`${item.item_code}: ${item.item_name || ''}`}
      footer={(
        <div className="inv-actions">
          <button type="button" className="cc-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="cc-btn" onClick={submit} disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
        </div>
      )}>
      <div className="inv-form">
        {error && <p className="inv-err" role="alert">{error}</p>}
        <Field label="Grade (for example SAE 15W-40)" id="lg-grade" full>
          <input id="lg-grade" className="cc-input" value={grade} onChange={(e) => setGrade(e.target.value)} maxLength={60} />
        </Field>
        <Field label="Stock unit" id="lg-uom" full>
          <select id="lg-uom" className="cc-select" value={uom} onChange={(e) => setUom(e.target.value)}>
            <option value="">Not recorded</option>
            <option value="L">Litre (L)</option>
            <option value="ML">Millilitre (ML)</option>
            <option value="KG">Kilogram (KG)</option>
            <option value="PAIL">Pail</option>
            <option value="DRUM">Drum</option>
            <option value="EA">Each</option>
          </select>
        </Field>
      </div>
    </Modal>
  )
}
