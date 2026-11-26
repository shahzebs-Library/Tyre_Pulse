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
import { useLanguage } from '../../contexts/LanguageContext'
import { useInvQuery, ErrorNote, Note, SectionCard, Field, SearchBox, fmtDate, fmtDateTime, alignNumeric } from '../inventory/InvUi'
import { newIdempotencyKey } from '../../lib/api/inventory'
import { loadLubricantStock, listLubricantConsumption, listDispenses, dispenseLubricant, setLubricantGrade } from '../../lib/api/warehouseAssets'
import { consumptionByAsset, qtyByUnitText, validateDispense } from '../../lib/warehouseClasses/specialClasses'
import { monthsAgoStart } from '../../lib/inventory/warehouseAssets'
import { formatMoney, formatQty } from '../../lib/inventory/inventoryMoney'
import { toUserMessage } from '../../lib/inventory/errorText'

const PERIODS = [3, 6, 12]

export default function LubricantsPanel({ scope, can = () => false }) {
  const { t } = useLanguage()
  const na = t('wmsparts.common.na')
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
        <Kpi icon={Droplets} tone="t-blue" loading={stock.loading && !stock.data} value={stock.data ? stock.data.items.length : null} label={t('wmsparts.lub.kpi.items')} />
        <Kpi icon={ClipboardList} tone="t-amber" loading={stock.loading && !stock.data} value={stock.data ? graded : null} label={t('wmsparts.lub.kpi.graded')} />
        <Kpi icon={Truck} tone="t-green" loading={usage.loading && !usage.data} display={notSetUp ? t('wmsparts.lub.notSetUp') : undefined}
          value={notSetUp ? null : byAsset.length} label={t('wmsparts.lub.kpi.assets')} />
      </div>

      {notSetUp && (
        <Note tone="warn" title={t('wmsparts.lub.notSetUpTitle')}>{t('wmsparts.lub.notSetUpBody')}</Note>
      )}

      <SectionCard title={t('wmsparts.lub.stockTitle')} sub={t('wmsparts.lub.stockSub')}>
        <div className="inv-scroll">
          <KitTable compact loading={stock.loading && !stock.data} rows={lines} empty={t('wmsparts.lub.stockEmpty')}
            columns={alignNumeric([
              { key: 'code', header: t('wmsparts.common.item'), cell: (r) => `${r.item?.item_code || t('wmsparts.common.noCode')}: ${r.item?.item_name || ''}` },
              { key: 'grade', header: t('wmsparts.lub.grade'), cell: (r) => r.item?.lubricant_grade || <span className="cc-na">{t('wmsparts.common.notRecorded')}</span> },
              { key: 'site', header: t('wmsparts.common.site') },
              { key: 'uom', header: t('wmsparts.lub.unit'), cell: (r) => r.uom || r.item?.base_uom || r.item?.uom || <span className="cc-na">{t('wmsparts.common.notRecorded')}</span> },
              { key: 'qty_on_hand', header: t('wmsparts.common.onHand'), numeric: true, cell: (r) => formatQty(r.qty_on_hand) },
              { key: 'act', header: '', sortable: false, cell: (r) => (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {canDispense && <button type="button" className="cc-btn-ghost" onClick={() => setDispenseFor(r)}>{t('wmsparts.lub.dispense')}</button>}
                  {canGrade && <button type="button" className="cc-btn-ghost" onClick={() => setGradeFor(r.item)}>{t('wmsparts.lub.grade')}</button>}
                </div>
              ) },
            ])} />
        </div>
      </SectionCard>

      {!notSetUp && (
        <SectionCard title={t('wmsparts.lub.consTitle')} sub={t('wmsparts.lub.consSub')}
          action={(
            <select className="cc-select" aria-label={t('wmsparts.lub.period')} value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              {PERIODS.map((m) => <option key={m} value={m}>{t('wmsparts.lub.lastMonths', { n: m })}</option>)}
            </select>
          )}>
          {usage.error && <ErrorNote error={usage.error} onRetry={usage.retry} />}
          {usage.data?.truncated && <Note tone="warn">{t('wmsparts.lub.consTruncated')}</Note>}
          <SearchBox value={term} onChange={setTerm} placeholder={t('wmsparts.common.assetNumber')} label={t('wmsparts.lub.searchAssets')} />
          <div className="inv-scroll" style={{ marginTop: 8 }}>
            <KitTable compact loading={usage.loading && !usage.data} rows={shownAssets} empty={t('wmsparts.lub.consEmpty')}
              columns={alignNumeric([
                { key: 'asset_no', header: t('wmsparts.common.asset') },
                { key: 'app', header: t('wmsparts.lub.inApp'), cell: (r) => qtyByUnitText(r.app.qty) },
                { key: 'erp', header: t('wmsparts.lub.erpOil'), cell: (r) => qtyByUnitText(r.erp.qty) },
                ...(showValue ? [{ key: 'value', header: t('wmsparts.lub.knownValue'), numeric: true, cell: (r) => (Object.keys(r.value).length
                  ? Object.entries(r.value).map(([c, v]) => formatMoney(v, c)).join(' | ') : na) }] : []),
                { key: 'unvaluedLines', header: t('wmsparts.lub.unvalued'), numeric: true, cell: (r) => r.unvaluedLines },
                { key: 'lastMonth', header: t('wmsparts.lub.latestMonth'), cell: (r) => (r.lastMonth ? String(r.lastMonth).slice(0, 7) : na) },
              ])} />
          </div>
        </SectionCard>
      )}

      {!notSetUp && (
        <SectionCard title={t('wmsparts.lub.recentTitle')} sub={t('wmsparts.lub.recentSub')}>
          {recent.error && <ErrorNote error={recent.error} onRetry={recent.retry} />}
          <div className="inv-scroll">
            <KitTable compact loading={recent.loading && !recent.data} rows={recent.data?.rows || []} empty={t('wmsparts.lub.recentEmpty')}
              columns={alignNumeric([
                { key: 'dispensed_at', header: t('wmsparts.common.when'), cell: (r) => fmtDateTime(r.dispensed_at) },
                { key: 'asset_no', header: t('wmsparts.common.asset') },
                { key: 'job_card_no', header: t('wmsparts.common.jobCard'), cell: (r) => r.job_card_no || t('wmsparts.common.none') },
                { key: 'item', header: t('wmsparts.common.item'), cell: (r) => itemById.get(r.item_id)?.item_code || na },
                { key: 'qty', header: t('wmsparts.common.quantity'), numeric: true, cell: (r) => `${formatQty(r.qty)}${r.uom ? ` ${r.uom}` : ''}` },
                { key: 'meter', header: t('wmsparts.lub.meter'), cell: (r) => (r.meter_reading === null || r.meter_reading === undefined ? '' : `${formatQty(r.meter_reading)} ${r.meter_type === 'hours' ? t('wmsparts.lub.hours') : r.meter_type || ''}`) },
                { key: 'site', header: t('wmsparts.common.site') },
              ])} />
          </div>
        </SectionCard>
      )}

      {dispenseFor && <DispenseModal line={dispenseFor} onClose={() => setDispenseFor(null)}
        onDone={() => { setDispenseFor(null); stock.retry(); usage.retry(); recent.retry() }} />}
      {gradeFor && <GradeModal item={gradeFor} onClose={() => setGradeFor(null)} onDone={() => { setGradeFor(null); stock.retry() }} />}
      <p className="cc-card-sub">{t('wmsparts.lub.dataFrom', { date: fmtDate(fromMonth) })}</p>
    </div>
  )
}

function DispenseModal({ line, onClose, onDone }) {
  const { t } = useLanguage()
  const [form, setForm] = useState({ qty: '', asset_no: '', job_card_no: '', meter_reading: '', meter_type: 'km', note: '' })
  // One key per request: an identical retry after a network error reuses it, so
  // the dispense is never posted twice. A changed form, or a refusal for lack of
  // stock, makes the next press a new request with a new key; reusing the old
  // key would only replay the stored refusal.
  const [key, setKey] = useState(() => newIdempotencyKey())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // After an error whose outcome is unknown (a lost response), the form is held:
  // the retry must send the same request under the same key, or a changed form
  // under a new key could post a second dispense.
  const [held, setHeld] = useState(false)
  const set = (k) => (e) => { if (held) return; setKey(newIdempotencyKey()); setForm((f) => ({ ...f, [k]: e.target.value })) }
  const unit = line.uom || line.item?.base_uom || line.item?.uom || t('wmsparts.lub.unitsAsStocked')

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
      if (r?.status === 'refused_shortage') { setKey(newIdempotencyKey()); setError(t('wmsparts.lub.shortage')); return }
      onDone()
    } catch (err) {
      setHeld(true)
      setError(`${toUserMessage(err, t('wmsparts.lub.dispenseFailed'))} ${t('wmsparts.lub.retryHeld')}`)
    } finally { setBusy(false) }
  }

  return (
    <Modal className="cc inv-panel" open onClose={() => !busy && onClose()} size="md" title={t('wmsparts.lub.dispenseTitle')}
      subtitle={`${line.item?.item_code || t('wmsparts.common.noCode')}: ${line.item?.item_name || ''} (${t('wmsparts.lub.onHandAt', { qty: formatQty(line.qty_on_hand), site: line.site })})`}
      footer={(
        <div className="inv-actions">
          <button type="button" className="cc-btn-ghost" onClick={onClose} disabled={busy}>{t('wmsparts.common.cancel')}</button>
          <button type="button" className="cc-btn" onClick={submit} disabled={busy}>{busy ? t('wmsparts.common.saving') : t('wmsparts.lub.dispense')}</button>
        </div>
      )}>
      <div className="inv-form">
        {error && <p className="inv-err" role="alert">{error}</p>}
        <Field label={t('wmsparts.lub.qtyUnit', { unit })} id="ld-qty">
          <input id="ld-qty" className="cc-input" type="number" min="0" step="any" value={form.qty} onChange={set('qty')} />
        </Field>
        <Field label={t('wmsparts.common.assetNumber')} id="ld-asset">
          <input id="ld-asset" className="cc-input" value={form.asset_no} onChange={set('asset_no')} maxLength={60} />
        </Field>
        <Field label={t('wmsparts.lub.jobCardOwn')} id="ld-jc" full>
          <input id="ld-jc" className="cc-input" value={form.job_card_no} onChange={set('job_card_no')} maxLength={80} />
        </Field>
        <Field label={t('wmsparts.lub.meterOptional')} id="ld-meter">
          <input id="ld-meter" className="cc-input" type="number" min="0" step="any" value={form.meter_reading} onChange={set('meter_reading')} />
        </Field>
        <Field label={t('wmsparts.lub.readingIn')} id="ld-mtype">
          <select id="ld-mtype" className="cc-select" value={form.meter_type} onChange={set('meter_type')}>
            <option value="km">km</option>
            <option value="hours">{t('wmsparts.lub.hours')}</option>
          </select>
        </Field>
        <Field label={t('wmsparts.common.note')} id="ld-note" full>
          <input id="ld-note" className="cc-input" value={form.note} onChange={set('note')} maxLength={400} />
        </Field>
      </div>
    </Modal>
  )
}

function GradeModal({ item, onClose, onDone }) {
  const { t } = useLanguage()
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
      setError(toUserMessage(err, t('wmsparts.lub.gradeFailed')))
    } finally { setBusy(false) }
  }

  return (
    <Modal className="cc inv-panel" open onClose={() => !busy && onClose()} size="sm" title={t('wmsparts.lub.gradeTitle')}
      subtitle={`${item.item_code}: ${item.item_name || ''}`}
      footer={(
        <div className="inv-actions">
          <button type="button" className="cc-btn-ghost" onClick={onClose} disabled={busy}>{t('wmsparts.common.cancel')}</button>
          <button type="button" className="cc-btn" onClick={submit} disabled={busy}>{busy ? t('wmsparts.common.saving') : t('wmsparts.common.save')}</button>
        </div>
      )}>
      <div className="inv-form">
        {error && <p className="inv-err" role="alert">{error}</p>}
        <Field label={t('wmsparts.lub.gradeLabel')} id="lg-grade" full>
          <input id="lg-grade" className="cc-input" value={grade} onChange={(e) => setGrade(e.target.value)} maxLength={60} />
        </Field>
        <Field label={t('wmsparts.lub.stockUnit')} id="lg-uom" full>
          <select id="lg-uom" className="cc-select" value={uom} onChange={(e) => setUom(e.target.value)}>
            <option value="">{t('wmsparts.common.notRecorded')}</option>
            <option value="L">{t('wmsparts.lub.uom.L')}</option>
            <option value="ML">{t('wmsparts.lub.uom.ML')}</option>
            <option value="KG">{t('wmsparts.lub.uom.KG')}</option>
            <option value="PAIL">{t('wmsparts.lub.uom.PAIL')}</option>
            <option value="DRUM">{t('wmsparts.lub.uom.DRUM')}</option>
            <option value="EA">{t('wmsparts.lub.uom.EA')}</option>
          </select>
        </Field>
      </div>
    </Modal>
  )
}
