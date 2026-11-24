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
import { useInvQuery, ErrorNote, Note, SectionCard, StatusPill, Field, SearchBox, fmtDate, fmtDateTime } from '../inventory/InvUi'
import { newIdempotencyKey } from '../../lib/api/inventory'
import { listUnitLatest, listUnitHistory, recordUnitEvent, listRepairVendors, searchItems } from '../../lib/api/warehouseAssets'
import { allowedUnitEvents, validateUnitEvent, unitEventLabel, UNIT_STATE_LABEL, UNIT_EVENTS } from '../../lib/warehouseClasses/specialClasses'
import { toUserMessage } from '../../lib/inventory/errorText'

const STATE_TONE = { installed: 'info', at_vendor: 'warn', beyond_repair: 'bad', in_store: 'good' }

export default function UnitEventsSection({ scope, can = () => false }) {
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
    <SectionCard title="Serialised units: installation and repair history"
      sub="One line per serial. Overdue means the vendor's promised return date has passed."
      action={canRecord && !notSetUp ? <button type="button" className="cc-btn" onClick={() => setEventFor({})}>Record an event</button> : null}>
      {latest.error && <ErrorNote error={latest.error} onRetry={latest.retry} />}
      {notSetUp && (
        <Note tone="warn" title="Unit history is not set up yet">
          Per-serial installation and repair history needs migration 20261124133000 (not applied). Until then, repair state is
          read from stock condition and location only (above).
        </Note>
      )}
      {!notSetUp && (
        <>
          <div className="inv-toolbar" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <SearchBox value={term} onChange={setTerm} placeholder="Serial, item code or asset" label="Search units" />
            <select className="cc-select" aria-label="Unit state" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
              <option value="all">All states</option>
              {Object.entries(UNIT_STATE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          {latest.data?.truncated && <Note tone="warn">Only the newest units were read. Choose a site to see all of them.</Note>}
          <div className="inv-scroll">
            <KitTable compact loading={latest.loading && !latest.data} rows={rows} empty="No serialised unit has an event recorded."
              columns={[
                { key: 'serial', header: 'Serial' },
                { key: 'item_code', header: 'Item', cell: (r) => `${r.item_code || 'No code'}${r.item_name ? `: ${r.item_name}` : ''}` },
                { key: 'unit_state', header: 'Now', cell: (r) => <StatusPill value={r.unit_state} tone={STATE_TONE[r.unit_state]} label={UNIT_STATE_LABEL[r.unit_state]} /> },
                { key: 'where', header: 'Where', cell: (r) => (r.unit_state === 'installed' ? r.asset_no
                  : r.unit_state === 'at_vendor' ? (vendorName.get(r.supplier_id) || 'Vendor') : (r.site || 'N/A')) },
                { key: 'expected_back', header: 'Back by', cell: (r) => (r.unit_state === 'at_vendor'
                  ? (r.expected_back ? <span className={r.overdue_from_vendor ? 'inv-err' : ''}>{fmtDate(r.expected_back)}{r.overdue_from_vendor ? ' (overdue)' : ''}</span> : 'Not promised')
                  : '') },
                { key: 'event_at', header: 'Last event', cell: (r) => fmtDate(r.event_at) },
                { key: 'act', header: '', sortable: false, cell: (r) => (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="cc-btn-ghost" onClick={() => setHistoryFor(r)}>History</button>
                    {allowedUnitEvents(r, can).length > 0 && <button type="button" className="cc-btn-ghost" onClick={() => setEventFor(r)}>Record</button>}
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
    const t = setTimeout(() => {
      searchItems({ country: scope.country, term: itemTerm }).then((r) => { if (live) setItems(r) }).catch(() => { if (live) setItems([]) })
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [itemTerm, known, scope.country])

  async function submit() {
    const v = validateUnitEvent(form)
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
      setError(toUserMessage(err, 'The event could not be saved.'))
    } finally { setBusy(false) }
  }

  const t = form.event_type
  return (
    <Modal className="cc inv-panel" open onClose={() => !busy && onClose()} size="md" title="Record a unit event"
      subtitle={known ? `Serial ${unit.serial} (${unit.item_code || 'No code'})` : 'A serialised part'}
      footer={(
        <div className="inv-actions">
          <button type="button" className="cc-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="cc-btn" onClick={submit} disabled={busy || !options.length}>{busy ? 'Saving...' : 'Save event'}</button>
        </div>
      )}>
      <div className="inv-form">
        {error && <p className="inv-err" role="alert">{error}</p>}
        {!options.length && <p className="cc-card-sub">You do not have a permission for any event on this unit.</p>}
        {!known && (
          <>
            <Field label="Find the item" id="ue-item" full>
              <input id="ue-item" className="cc-input" value={itemTerm} onChange={(e) => setItemTerm(e.target.value)} placeholder="Item code or name" />
            </Field>
            {items.length > 0 && (
              <Field label="Item" id="ue-item-pick" full>
                <select id="ue-item-pick" className="cc-select" value={form.item_id} onChange={set('item_id')}>
                  <option value="">Choose</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.item_code}: {i.item_name}{i.country ? ` (${i.country})` : ''}</option>)}
                </select>
              </Field>
            )}
            <Field label="Serial number" id="ue-serial">
              <input id="ue-serial" className="cc-input" value={form.serial} onChange={set('serial')} maxLength={100} />
            </Field>
            <Field label="Site" id="ue-site">
              <input id="ue-site" className="cc-input" value={form.site} onChange={set('site')} maxLength={60} />
            </Field>
          </>
        )}
        <Field label="What happened" id="ue-type" full>
          <select id="ue-type" className="cc-select" value={t} onChange={set('event_type')}>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        {(t === 'installed_on_asset' || t === 'removed_from_asset') && (
          <>
            <Field label="Asset number" id="ue-asset">
              <input id="ue-asset" className="cc-input" value={form.asset_no} onChange={set('asset_no')} maxLength={60} />
            </Field>
            <Field label="Job card (optional)" id="ue-jc">
              <input id="ue-jc" className="cc-input" value={form.job_card_no} onChange={set('job_card_no')} maxLength={80} />
            </Field>
          </>
        )}
        {t === 'sent_for_repair' && (
          <>
            <Field label="Repair vendor" id="ue-vendor" full>
              <select id="ue-vendor" className="cc-select" value={form.supplier_id} onChange={set('supplier_id')}>
                <option value="">Choose</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.supplier_name}</option>)}
              </select>
            </Field>
            {!vendors.length && <p className="cc-card-sub">No supplier is registered. Add the repair vendor under Suppliers first.</p>}
            <Field label="Vendor reference (RMA)" id="ue-rma">
              <input id="ue-rma" className="cc-input" value={form.rma_ref} onChange={set('rma_ref')} maxLength={120} />
            </Field>
            <Field label="Promised back by" id="ue-back">
              <input id="ue-back" className="cc-input" type="date" value={form.expected_back} onChange={set('expected_back')} />
            </Field>
          </>
        )}
        {(t === 'returned_from_repair' || t === 'removed_from_asset' || t === 'evaluated') && (
          <Field label="Condition" id="ue-cond">
            <select id="ue-cond" className="cc-select" value={form.condition} onChange={set('condition')}>
              <option value="">Not stated</option>
              <option value="serviceable">Serviceable</option>
              <option value="repairable">Repairable</option>
              <option value="damaged">Damaged</option>
              <option value="scrap">Scrap</option>
            </select>
          </Field>
        )}
        <Field label="Note" id="ue-note" full>
          <textarea id="ue-note" className="cc-input" rows={2} value={form.note} onChange={set('note')} maxLength={1000} />
        </Field>
      </div>
    </Modal>
  )
}

function UnitHistoryModal({ unit, vendorName, onClose }) {
  const h = useInvQuery(() => listUnitHistory({ itemId: unit.item_id, serial: unit.serial }), [unit.item_id, unit.serial])
  return (
    <Modal className="cc inv-panel" open onClose={onClose} size="lg" title={`History of serial ${unit.serial}`}
      subtitle={`${unit.item_code || 'No code'}${unit.item_name ? `: ${unit.item_name}` : ''}`}>
      {h.error && <ErrorNote error={h.error} onRetry={h.retry} />}
      <div className="inv-scroll">
        <KitTable compact loading={h.loading && !h.data} rows={h.data?.rows || []} empty="No events recorded."
          columns={[
            { key: 'event_at', header: 'When', cell: (r) => fmtDateTime(r.event_at) },
            { key: 'event_type', header: 'Event', cell: (r) => unitEventLabel(r.event_type) },
            { key: 'asset_no', header: 'Asset', cell: (r) => r.asset_no || '' },
            { key: 'job_card_no', header: 'Job card', cell: (r) => r.job_card_no || '' },
            { key: 'vendor', header: 'Vendor', cell: (r) => (r.supplier_id ? vendorName.get(r.supplier_id) || 'Vendor' : '') },
            { key: 'rma_ref', header: 'RMA', cell: (r) => r.rma_ref || '' },
            { key: 'condition', header: 'Condition', cell: (r) => r.condition || '' },
            { key: 'note', header: 'Note', cell: (r) => r.note || '' },
          ]} />
      </div>
    </Modal>
  )
}
