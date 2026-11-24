/**
 * Put-away: move received stock from a receiving area (warehouse / zone /
 * rack location) into a bin or shelf of the same site.
 *
 * There is no dedicated put-away RPC, so a put-away is a same-site transfer
 * through the existing ledger functions: inv_transfer_dispatch (receiving area
 * to in-transit) then inv_transfer_receive (in-transit to the bin). Each step
 * has its own idempotency key, minted once and reused on retry, so a timeout
 * never posts twice. If step 2 fails the screen says the stock is in transit
 * and offers to finish it; the transfer is also visible in Movements > Transfers.
 *
 * Needs the inventory "transfer" permission (the server checks it again).
 */
import { useMemo, useState } from 'react'
import { ArrowDownToLine, PackageCheck } from 'lucide-react'
import { newIdempotencyKey } from '../../lib/api/inventory'
import { listPutawayCandidates, startPutaway, finishPutaway } from '../../lib/api/floorWorkflow'
import { putawayTargets, validatePutaway, putawayStage, freeQty, locationIndex, locationPath } from '../../lib/inventory/floorWorkflow'
import { formatQty } from '../../lib/inventory/inventoryMoney'
import { toUserMessage } from '../../lib/inventory/errorText'
import { useInvQuery, PagedTable, Field, ErrorNote, Note, SectionCard, SearchBox } from './InvUi'

const freshAction = () => ({ dispatchKey: newIdempotencyKey(), receiveKey: newIdempotencyKey(), transferId: null, ref: null, done: false })

export default function PutawayPanel({ scope, can }) {
  const allowed = typeof can === 'function' && can('transfer')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [search, setSearch] = useState('')
  const [reload, setReload] = useState(0)
  const [stock, setStock] = useState(null)
  const [form, setForm] = useState({ targetId: '', qty: '', note: '' })
  const [action, setAction] = useState(freshAction)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')

  const query = useInvQuery(
    // No read at all without the permission: the screen shows only the notice.
    () => (allowed
      ? listPutawayCandidates({ country: scope?.country, site: scope?.site, search, page, pageSize })
      : Promise.resolve({ status: 'ok', rows: [], total: 0, locations: [] })),
    [allowed, scope?.country, scope?.site, search, page, pageSize, reload],
  )
  const locations = useMemo(() => query.data?.locations || [], [query.data])
  const index = useMemo(() => locationIndex(locations), [locations])
  const targets = useMemo(() => putawayTargets(stock, locations), [stock, locations])
  const target = targets.find((l) => l.id === form.targetId) || null
  const stage = putawayStage(action)

  if (!allowed) {
    return (
      <SectionCard title="Put-away">
        <Note tone="warn" title="Permission needed">Putting stock away needs the inventory transfer permission. Ask an administrator.</Note>
      </SectionCard>
    )
  }

  const pick = (row) => {
    if (stage === 'receive') return // finish the open put-away first
    setStock(row)
    setForm({ targetId: '', qty: String(freeQty(row) ?? ''), note: '' })
    setAction(freshAction())
    setErr(''); setDone('')
  }

  const submit = async () => {
    setErr(''); setDone('')
    let state = action
    try {
      setBusy(true)
      if (putawayStage(state) === 'start') {
        const v = validatePutaway({ stock, target, qty: form.qty })
        if (!v.ok) { setErr(v.error); return }
        const res = await startPutaway({ stock, targetId: target.id, qty: v.qty, note: form.note }, state.dispatchKey)
        if (res.refused) { setErr('Not enough free stock on this line. Refresh and try a smaller quantity.'); return }
        state = { ...state, transferId: res.transferId, ref: res.ref }
        setAction(state)
      }
      await finishPutaway(state.transferId, state.receiveKey)
      setAction({ ...state, done: true })
      setDone(`Put away into ${target?.path || 'the bin'}${state.ref ? ` (${state.ref})` : ''}.`)
      setStock(null)
      setReload((n) => n + 1)
    } catch (e) {
      setErr(putawayStage(state) === 'receive'
        ? `The stock left the receiving area${state.ref ? ` (${state.ref})` : ''} but was not yet received into the bin: ${toUserMessage(e)} Press "Finish put-away" to try again.`
        : toUserMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const columns = [
    { key: 'item_code', header: 'Item', cell: (r) => r.item_code || <span className="cc-na">N/A</span> },
    { key: 'description', header: 'Description', cell: (r) => r.description || <span className="cc-na">N/A</span> },
    { key: 'site', header: 'Site' },
    { key: 'location_code', header: 'Receiving area', cell: (r) => locationPath(r.location_id, index, r.location_code) },
    { key: 'qty_on_hand', header: 'On hand', numeric: true, cell: (r) => formatQty(r.qty_on_hand) },
    { key: 'free', header: 'Free to move', numeric: true, sortable: false, cell: (r) => formatQty(freeQty(r)) },
  ]

  return (
    <>
      <SectionCard title="Put-away" sub="Received stock waiting in a receiving area (warehouse, zone or rack). Choose a line, then the bin or shelf it goes into.">
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0) }} placeholder="Search item, description or location" label="Search stock to put away" />
        {query.data?.status === 'ok' && !query.loading && !(query.data.rows || []).length && !search && (
          <Note>Nothing is waiting in a receiving area for this scope. Received goods show here until they are put into a bin.</Note>
        )}
        <PagedTable
          query={query} columns={columns} page={page} pageSize={pageSize}
          onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(0) }}
          empty="No stock waiting to be put away" what="Put-away" noun="lines"
          onRowClick={pick}
        />
        {query.data?.locationsTruncated && <Note tone="warn">Not every location could be loaded for this scope. Narrow the site to see all bins.</Note>}
      </SectionCard>

      {(stock || stage === 'receive') && (
        <SectionCard title={stage === 'receive' ? 'Finish put-away' : `Put away ${stock?.item_code || ''}`}
          sub={stock ? `${stock.description || ''} at ${locationPath(stock.location_id, index, stock.location_code)}, ${formatQty(freeQty(stock))} free` : undefined}>
          {stage === 'start' && (
            <div className="inv-form">
              <Field label="Bin or shelf">
                <select className="cc-select" value={form.targetId} onChange={(e) => setForm((f) => ({ ...f, targetId: e.target.value }))}>
                  <option value="">Choose a location</option>
                  {targets.map((l) => <option key={l.id} value={l.id}>{l.nearby ? '* ' : ''}{l.path}</option>)}
                </select>
              </Field>
              <Field label="Quantity">
                <input className="inv-input inv-num" type="number" min="0" step="any" value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))} />
              </Field>
              <Field label="Note (optional)" full>
                <input className="inv-input" maxLength={200} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
              </Field>
            </div>
          )}
          {stage === 'start' && !targets.length && (
            <Note tone="warn">This site has no active bin or shelf. Add one in Locations first.</Note>
          )}
          {stage === 'start' && targets.some((l) => l.nearby) && <p className="cc-card-sub">* inside the same warehouse or zone as the stock.</p>}
          <div className="inv-actions">
            {stage === 'start' && (
              <button type="button" className="cc-btn-ghost" disabled={busy} onClick={() => { setStock(null); setErr('') }}>Cancel</button>
            )}
            <button type="button" className="cc-btn-primary" disabled={busy || (stage === 'start' && !form.targetId)} onClick={submit}>
              {stage === 'receive' ? <PackageCheck size={14} aria-hidden="true" /> : <ArrowDownToLine size={14} aria-hidden="true" />}
              {' '}{busy ? 'Saving...' : stage === 'receive' ? 'Finish put-away' : 'Put away'}
            </button>
          </div>
          {err && <ErrorNote error={err} />}
        </SectionCard>
      )}
      {done && <Note tone="good">{done}</Note>}
    </>
  )
}
