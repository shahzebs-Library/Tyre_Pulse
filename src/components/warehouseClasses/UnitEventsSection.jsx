/**
 * Serialised repairable units: where each serial is now (installed on an asset,
 * at a repair vendor, in store, beyond repair) and its full installation and
 * repair history. Recording an event is one server RPC (inv_unit_event_record,
 * migration 20261124133000) that enforces the order: a unit must be removed
 * before it goes to a vendor, can only come back if it went, and cannot be on
 * two assets. Stock quantities still move through transfers and put-away.
 */
import { useEffect, useMemo, useState } from 'react'
import { KitTable } from '../commandCenter/kit'
import Modal from '../ui/Modal'
import { useLanguage } from '../../contexts/LanguageContext'
import { useInvQuery, ErrorNote, Note, SectionCard, StatusPill, Field, SearchBox, fmtDate, fmtDateTime } from '../inventory/InvUi'
import { newIdempotencyKey } from '../../lib/api/inventory'
import { listUnitLatest, listUnitHistory, recordUnitEvent, listRepairVendors, searchItems } from '../../lib/api/warehouseAssets'
import { allowedUnitEvents, validateUnitEvent, UNIT_STATE_LABEL, UNIT_EVENTS } from '../../lib/warehouseClasses/specialClasses'
import { toUserMessage } from '../../lib/inventory/errorText'

const STATE_TONE = { installed: 'info', at_vendor: 'warn', beyond_repair: 'bad', in_store: 'good' }
const EVENT_KEYS = new Set(UNIT_EVENTS.map((e) => e.value))
const CONDITIONS = ['serviceable', 'repairable', 'damaged', 'scrap']
const stateText = (t, s) => (UNIT_STATE_LABEL[s] ? t(`wmsparts.units.state.${s}`) : s)
const eventText = (t, v) => (EVENT_KEYS.has(v) ? t(`wmsparts.units.event.${v}`) : v)
const conditionText = (t, c) => (CONDITIONS.includes(c) ? t(`wmsparts.units.cond.${c}`) : c)

export default function UnitEventsSection({ scope, can = () => false }) {
  const { t } = useLanguage()
  const latest = useInvQuery(() => listUnitLatest(scope), [scope.country, scope.site])
  const vendors = useInvQuery(() => listRepairVendors(), [])
  const [term, setTerm] = useState('')
  const [stateFilter, setStateFilter] = useState('all')
  const [eventFor, setEventFor] = useState(null)
  const [historyFor, setHistoryFor] = useState(null)
  const vendorName = useMemo(() => new Map((vendors.data?.rows || []).map((v) => [v.id, v.supplier_name])), [vendors.data])

  const rows = useMemo(() => {
    const s = term.trim().toUpperCase()
    return (latest.data?.rows || []).filter((r) => (stateFilter === 'all' || r.unit_state === stateFilter)
      && (!s || String(r.serial).includes(s) || String(r.item_code || '').toUpperCase().includes(s) || String(r.asset_no || '').includes(s)))
  }, [latest.data, term, stateFilter])

  const notSetUp = latest.data?.status === 'not_provisioned'
  const canRecord = UNIT_EVENTS.some((e) => can(e.cap))

  return (
    <SectionCard title={t('wmsparts.units.title')}
      sub={t('wmsparts.units.sub')}
      action={canRecord && !notSetUp ? <button type="button" className="cc-btn" onClick={() => setEventFor({})}>{t('wmsparts.units.recordEvent')}</button> : null}>
      {latest.error && <ErrorNote error={latest.error} onRetry={latest.retry} />}
      {notSetUp && (
        <Note tone="warn" title={t('wmsparts.units.notSetUpTitle')}>{t('wmsparts.units.notSetUpBody')}</Note>
      )}
      {!notSetUp && (
        <>
          <div className="inv-toolbar" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <SearchBox value={term} onChange={setTerm} placeholder={t('wmsparts.units.searchPh')} label={t('wmsparts.units.search')} />
            <select className="cc-select" aria-label={t('wmsparts.units.stateLabel')} value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
              <option value="all">{t('wmsparts.units.allStates')}</option>
              {Object.keys(UNIT_STATE_LABEL).map((k) => <option key={k} value={k}>{stateText(t, k)}</option>)}
            </select>
          </div>
          {latest.data?.truncated && <Note tone="warn">{t('wmsparts.units.truncated')}</Note>}
          <div className="inv-scroll">
            <KitTable compact loading={latest.loading && !latest.data} rows={rows} empty={t('wmsparts.units.empty')}
              columns={[
                { key: 'serial', header: t('wmsparts.units.serial'), cell: (r) => <span dir="ltr">{r.serial}</span> },
                { key: 'item_code', header: t('wmsparts.common.item'), cell: (r) => `${r.item_code || t('wmsparts.common.noCode')}${r.item_name ? `: ${r.item_name}` : ''}` },
                { key: 'unit_state', header: t('wmsparts.units.now'), cell: (r) => <StatusPill value={r.unit_state} tone={STATE_TONE[r.unit_state]} label={stateText(t, r.unit_state)} /> },
                { key: 'where', header: t('wmsparts.units.where'), cell: (r) => (r.unit_state === 'installed' ? r.asset_no
                  : r.unit_state === 'at_vendor' ? (vendorName.get(r.supplier_id) || t('wmsparts.common.vendor')) : (r.site || t('wmsparts.common.na'))) },
                { key: 'expected_back', header: t('wmsparts.units.backBy'), cell: (r) => (r.unit_state === 'at_vendor'
                  ? (r.expected_back ? <span className={r.overdue_from_vendor ? 'inv-err' : ''}>{fmtDate(r.expected_back)}{r.overdue_from_vendor ? ` ${t('wmsparts.units.overdue')}` : ''}</span> : t('wmsparts.units.notPromised'))
                  : '') },
                { key: 'event_at', header: t('wmsparts.units.lastEvent'), cell: (r) => fmtDate(r.event_at) },
                { key: 'act', header: '', sortable: false, cell: (r) => (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="cc-btn-ghost" onClick={() => setHistoryFor(r)}>{t('wmsparts.units.history')}</button>
                    {allowedUnitEvents(r, can).length > 0 && <button type="button" className="cc-btn-ghost" onClick={() => setEventFor(r)}>{t('wmsparts.units.record')}</button>}
                  </div>
                ) },
              ]} />
          </div>
        </>
      )}
      {eventFor && <UnitEventModal unit={eventFor} can={can} scope={scope} vendors={vendors.data?.rows || []}
        onClose={() => setEventFor(null)} onDone={() => { setEventFor(null); latest.retry() }} />}
      {historyFor && <UnitHistoryModal unit={historyFor} vendorName={vendorName} onClose={() => setHistoryFor(null)} />}
    </SectionCard>
  )
}

function UnitEventModal({ unit, can, scope, vendors, onClose, onDone }) {
  const { t } = useLanguage()
  const known = !!unit.serial
  const options = allowedUnitEvents(known ? unit : null, can)
  const [form, setForm] = useState({
    item_id: unit.item_id || '', serial: unit.serial || '', event_type: options[0]?.value || '', asset_no: unit.unit_state === 'installed' ? unit.asset_no || '' : '',
    job_card_no: '', supplier_id: '', rma_ref: '', expected_back: '', condition: '', note: '',
    site: scope.site && scope.site !== 'all' ? scope.site : (unit.site || ''),
  })
  const [items, setItems] = useState([])
  const [itemTerm, setItemTerm] = useState('')
  const [key] = useState(() => newIdempotencyKey())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  useEffect(() => {
    if (known || itemTerm.trim().length < 2) { setItems([]); return undefined }
    let live = true
    const timer = setTimeout(() => {
      searchItems({ country: scope.country, term: itemTerm }).then((r) => { if (live) setItems(r) }).catch(() => { if (live) setItems([]) })
    }, 250)
    return () => { live = false; clearTimeout(timer) }
  }, [itemTerm, known, scope.country])

  async function submit() {
    const v = validateUnitEvent(form, t)
    if (v.error) { setError(v.error); return }
    setBusy(true); setError(null)
    try {
      await recordUnitEvent({
        item_id: form.item_id, serial: form.serial, event_type: form.event_type,
        asset_no: form.asset_no.trim().toUpperCase() || null, job_card_no: form.job_card_no.trim() || null,
        supplier_id: form.supplier_id || null, rma_ref: form.rma_ref.trim() || null, expected_back: form.expected_back || null,
        condition: form.condition || null, note: form.note.trim() || null,
        country: unit.country || (scope.country !== 'All' ? scope.country : null), site: form.site || null,
      }, key)
      onDone()
    } catch (err) {
      setError(toUserMessage(err, t('wmsparts.units.saveFailed')))
    } finally { setBusy(false) }
  }

  const ev = form.event_type
  return (
    <Modal className="cc inv-panel" open onClose={() => !busy && onClose()} size="md" title={t('wmsparts.units.eventTitle')}
      subtitle={known ? t('wmsparts.units.eventSub', { serial: unit.serial, code: unit.item_code || t('wmsparts.common.noCode') }) : t('wmsparts.units.aSerialPart')}
      footer={(
        <div className="inv-actions">
          <button type="button" className="cc-btn-ghost" onClick={onClose} disabled={busy}>{t('wmsparts.common.cancel')}</button>
          <button type="button" className="cc-btn" onClick={submit} disabled={busy || !options.length}>{busy ? t('wmsparts.common.saving') : t('wmsparts.units.saveEvent')}</button>
        </div>
      )}>
      <div className="inv-form">
        {error && <p className="inv-err" role="alert">{error}</p>}
        {!options.length && <p className="cc-card-sub">{t('wmsparts.units.noPermission')}</p>}
        {!known && (
          <>
            <Field label={t('wmsparts.units.findItem')} id="ue-item" full>
              <input id="ue-item" className="cc-input" value={itemTerm} onChange={(e) => setItemTerm(e.target.value)} placeholder={t('wmsparts.units.findItemPh')} />
            </Field>
            {items.length > 0 && (
              <Field label={t('wmsparts.common.item')} id="ue-item-pick" full>
                <select id="ue-item-pick" className="cc-select" value={form.item_id} onChange={set('item_id')}>
                  <option value="">{t('wmsparts.common.choose')}</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.item_code}: {i.item_name}{i.country ? ` (${i.country})` : ''}</option>)}
                </select>
              </Field>
            )}
            <Field label={t('wmsparts.units.serialNumber')} id="ue-serial">
              <input id="ue-serial" className="cc-input" value={form.serial} onChange={set('serial')} maxLength={100} />
            </Field>
            <Field label={t('wmsparts.common.site')} id="ue-site">
              <input id="ue-site" className="cc-input" value={form.site} onChange={set('site')} maxLength={60} />
            </Field>
          </>
        )}
        <Field label={t('wmsparts.units.whatHappened')} id="ue-type" full>
          <select id="ue-type" className="cc-select" value={ev} onChange={set('event_type')}>
            {options.map((o) => <option key={o.value} value={o.value}>{eventText(t, o.value)}</option>)}
          </select>
        </Field>
        {(ev === 'installed_on_asset' || ev === 'removed_from_asset') && (
          <>
            <Field label={t('wmsparts.common.assetNumber')} id="ue-asset">
              <input id="ue-asset" className="cc-input" value={form.asset_no} onChange={set('asset_no')} maxLength={60} />
            </Field>
            <Field label={t('wmsparts.units.jobCardOptional')} id="ue-jc">
              <input id="ue-jc" className="cc-input" value={form.job_card_no} onChange={set('job_card_no')} maxLength={80} />
            </Field>
          </>
        )}
        {ev === 'sent_for_repair' && (
          <>
            <Field label={t('wmsparts.units.repairVendor')} id="ue-vendor" full>
              <select id="ue-vendor" className="cc-select" value={form.supplier_id} onChange={set('supplier_id')}>
                <option value="">{t('wmsparts.common.choose')}</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.supplier_name}</option>)}
              </select>
            </Field>
            {!vendors.length && <p className="cc-card-sub">{t('wmsparts.units.noVendor')}</p>}
            <Field label={t('wmsparts.units.rmaRef')} id="ue-rma">
              <input id="ue-rma" className="cc-input" value={form.rma_ref} onChange={set('rma_ref')} maxLength={120} />
            </Field>
            <Field label={t('wmsparts.units.promisedBack')} id="ue-back">
              <input id="ue-back" className="cc-input" type="date" value={form.expected_back} onChange={set('expected_back')} />
            </Field>
          </>
        )}
        {(ev === 'returned_from_repair' || ev === 'removed_from_asset' || ev === 'evaluated') && (
          <Field label={t('wmsparts.common.condition')} id="ue-cond">
            <select id="ue-cond" className="cc-select" value={form.condition} onChange={set('condition')}>
              <option value="">{t('wmsparts.units.notStated')}</option>
              <option value="serviceable">{t('wmsparts.units.cond.serviceable')}</option>
              <option value="repairable">{t('wmsparts.units.cond.repairable')}</option>
              <option value="damaged">{t('wmsparts.units.cond.damaged')}</option>
              <option value="scrap">{t('wmsparts.units.cond.scrap')}</option>
            </select>
          </Field>
        )}
        <Field label={t('wmsparts.common.note')} id="ue-note" full>
          <textarea id="ue-note" className="cc-input" rows={2} value={form.note} onChange={set('note')} maxLength={1000} />
        </Field>
      </div>
    </Modal>
  )
}

function UnitHistoryModal({ unit, vendorName, onClose }) {
  const { t } = useLanguage()
  const h = useInvQuery(() => listUnitHistory({ itemId: unit.item_id, serial: unit.serial }), [unit.item_id, unit.serial])
  return (
    <Modal className="cc inv-panel" open onClose={onClose} size="lg" title={t('wmsparts.units.historyTitle', { serial: unit.serial })}
      subtitle={`${unit.item_code || t('wmsparts.common.noCode')}${unit.item_name ? `: ${unit.item_name}` : ''}`}>
      {h.error && <ErrorNote error={h.error} onRetry={h.retry} />}
      <div className="inv-scroll">
        <KitTable compact loading={h.loading && !h.data} rows={h.data?.rows || []} empty={t('wmsparts.units.noEvents')}
          columns={[
            { key: 'event_at', header: t('wmsparts.common.when'), cell: (r) => fmtDateTime(r.event_at) },
            { key: 'event_type', header: t('wmsparts.units.eventCol'), cell: (r) => eventText(t, r.event_type) },
            { key: 'asset_no', header: t('wmsparts.common.asset'), cell: (r) => r.asset_no || '' },
            { key: 'job_card_no', header: t('wmsparts.common.jobCard'), cell: (r) => r.job_card_no || '' },
            { key: 'vendor', header: t('wmsparts.common.vendor'), cell: (r) => (r.supplier_id ? vendorName.get(r.supplier_id) || t('wmsparts.common.vendor') : '') },
            { key: 'rma_ref', header: t('wmsparts.units.rma'), cell: (r) => r.rma_ref || '' },
            { key: 'condition', header: t('wmsparts.common.condition'), cell: (r) => (r.condition ? conditionText(t, r.condition) : '') },
            { key: 'note', header: t('wmsparts.common.note'), cell: (r) => r.note || '' },
          ]} />
      </div>
    </Modal>
  )
}
