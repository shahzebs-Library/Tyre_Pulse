/**
 * Picking: the pick list for a job card, built from the stock reserved for it,
 * grouped by site and by location / bin in walking order. Printable (PDF) and
 * downloadable (Excel).
 *
 * Confirming a pick calls the existing inv_issue against the reservation, so
 * the issue consumes the reservation and is recorded with the job card as its
 * source document. The person the parts were handed to is written into the
 * issue note, which is what the Workshop handover screen reads back.
 *
 * Work-order reservation lines (work_order_stock_reservations) are listed for
 * information only: inv_issue cannot consume them.
 */
import { useState } from 'react'
import { ClipboardList, FileDown, FileSpreadsheet, PackageMinus, Search } from 'lucide-react'
import { newIdempotencyKey } from '../../lib/api/inventory'
import { loadPickList, confirmPick } from '../../lib/api/floorWorkflow'
import {
  groupPickList, pickIssueArgs, pickExportRows, PICK_EXPORT_COLUMNS, normaliseJobCard,
} from '../../lib/inventory/floorWorkflow'
import { formatQty } from '../../lib/inventory/inventoryMoney'
import { toUserMessage } from '../../lib/inventory/errorText'
import { exportToExcel, exportToPdf, reportFileName } from '../../lib/exportUtils'
import { KitTable } from '../commandCenter/kit'
import { Field, ErrorNote, Note, NotSetUp, SectionCard, StatusPill, alignNumeric } from './InvUi'

export default function PickingPanel({ scope, can }) {
  const canIssue = typeof can === 'function' && can('issue')
  const canExport = typeof can === 'function' && can('export')
  const [jobCard, setJobCard] = useState('')
  const [state, setState] = useState({ loading: false, error: '', data: null })
  const [receivedBy, setReceivedBy] = useState('')
  const [note, setNote] = useState('')
  const [qtys, setQtys] = useState({})
  const [keys, setKeys] = useState({})
  const [busy, setBusy] = useState('')
  const [lineErr, setLineErr] = useState({})
  const [picked, setPicked] = useState([])

  const load = async (jc = jobCard) => {
    const j = normaliseJobCard(jc)
    if (!j) { setState({ loading: false, error: 'Enter a job card number.', data: null }); return }
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const data = await loadPickList(j, { country: scope?.country })
      setState({ loading: false, error: '', data })
      setQtys({}); setLineErr({})
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e), data: null })
    }
  }

  const data = state.data
  const lines = data?.lines || []
  const groups = groupPickList(lines)
  const pickable = lines.filter((l) => l.source === 'reservation')

  const keyFor = (l) => keys[l.key] || null
  const confirm = async (l) => {
    const built = pickIssueArgs({ line: l, qty: qtys[l.key], jobCard: data.jobCard, receivedBy, note })
    if (!built.ok) { setLineErr((m) => ({ ...m, [l.key]: built.error })); return false }
    const key = keyFor(l) || newIdempotencyKey()
    if (!keyFor(l)) setKeys((m) => ({ ...m, [l.key]: key }))
    setBusy(l.key); setLineErr((m) => ({ ...m, [l.key]: '' }))
    try {
      const res = await confirmPick(built.args, key)
      if (res?.status === 'refused_shortage') {
        setLineErr((m) => ({ ...m, [l.key]: 'Not enough stock on this line to issue. Nothing was posted.' }))
        return false
      }
      setPicked((p) => [...p, { item: l.itemCode, qty: built.args.qty, location: l.locationPath }])
      // A new pick on the same line needs a new key (the old one is spent).
      setKeys((m) => { const n = { ...m }; delete n[l.key]; return n })
      return true
    } catch (e) {
      setLineErr((m) => ({ ...m, [l.key]: toUserMessage(e) }))
      return false
    } finally {
      setBusy('')
    }
  }

  const confirmAll = async () => {
    for (const l of pickable) {
      const ok = await confirm(l)
      if (!ok) break
    }
    await load(data.jobCard)
  }

  const pickColumns = [
    { key: 'itemCode', header: 'Item', cell: (l) => l.itemCode || <span className="cc-na">N/A</span> },
    { key: 'description', header: 'Description', cell: (l) => l.description || <span className="cc-na">N/A</span> },
    { key: 'qty', header: 'Reserved', numeric: true, cell: (l) => `${formatQty(l.qty)} ${l.uom || ''}`.trim() },
    { key: 'onHand', header: 'On hand', numeric: true, cell: (l) => formatQty(l.onHand) },
    { key: 'source', header: 'Source', cell: (l) => (l.source === 'reservation'
      ? <StatusPill value="reservation" tone="info" label="Reservation" />
      : <StatusPill value="hold" tone="muted" label="Job card hold" />) },
    ...(canIssue ? [{
      key: 'pick', header: 'Pick', sortable: false, cell: (l) => (
        <>
          {l.source === 'reservation' ? (
            <div className="inv-actions">
              <input className="inv-input inv-num" type="number" min="0" step="any" style={{ width: 90 }}
                aria-label={`Quantity to pick for ${l.itemCode || 'this line'}`}
                value={qtys[l.key] ?? String(l.qty)} onChange={(e) => setQtys((m) => ({ ...m, [l.key]: e.target.value }))} />
              <button type="button" className="cc-btn-primary" disabled={!!busy} onClick={async () => { if (await confirm(l)) load(data.jobCard) }}>
                <PackageMinus size={14} aria-hidden="true" /> {busy === l.key ? 'Saving...' : 'Confirm pick'}
              </button>
            </div>
          ) : <span className="cc-na">Reserve first</span>}
          {lineErr[l.key] && <p className="inv-err" role="alert">{lineErr[l.key]}</p>}
        </>
      ),
    }] : []),
  ]

  const exportRows = () => pickExportRows(lines, data?.jobCard)
  const exportExcel = () => exportToExcel(
    exportRows(), PICK_EXPORT_COLUMNS.map((c) => c.key), PICK_EXPORT_COLUMNS.map((c) => c.header),
    reportFileName('Pick list', data.jobCard),
  )
  const exportPdf = () => exportToPdf(
    exportRows(), PICK_EXPORT_COLUMNS, `Pick list: job card ${data.jobCard}`, reportFileName('Pick list', data.jobCard), 'landscape',
  )

  return (
    <>
      <SectionCard title="Pick list for a job card" sub="Stock reserved for the job card, grouped by site and location so the store keeper walks the store once.">
        <form className="inv-form" onSubmit={(e) => { e.preventDefault(); load() }}>
          <Field label="Job card number">
            <input className="inv-input" maxLength={80} value={jobCard} onChange={(e) => setJobCard(e.target.value)} placeholder="e.g. GCKR/JC/0082/0323" />
          </Field>
          <div className="inv-actions">
            <button type="submit" className="cc-btn-primary" disabled={state.loading}>
              <Search size={14} aria-hidden="true" /> {state.loading ? 'Loading...' : 'Build pick list'}
            </button>
          </div>
        </form>
        {state.error && <ErrorNote error={state.error} onRetry={data || jobCard ? () => load() : undefined} />}
      </SectionCard>

      {data?.status === 'not_provisioned' && <NotSetUp what="Picking" />}

      {data?.status === 'ok' && (
        <SectionCard
          title={`Job card ${data.jobCard}`}
          sub={data.workOrder
            ? `Asset ${data.workOrder.asset_no || 'N/A'} at ${data.workOrder.site || 'N/A'}, status ${data.workOrder.status || 'N/A'}`
            : 'No job card with this number was found in Work Orders; the list shows stock reserved under this number.'}
          action={canExport && lines.length ? (
            <div className="inv-actions">
              <button type="button" className="cc-btn-ghost" onClick={exportPdf}><FileDown size={14} aria-hidden="true" /> PDF</button>
              <button type="button" className="cc-btn-ghost" onClick={exportExcel}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
            </div>
          ) : null}>
          {!lines.length && (
            <Note icon={ClipboardList}>Nothing is reserved for this job card. Reserve the parts first (Stock movements, Reserve and issue), then build the pick list.</Note>
          )}
          {data.truncated && <Note tone="warn">This job card has more reservations than one list can show. The first {lines.length} are listed.</Note>}

          {canIssue && pickable.length > 0 && (
            <div className="inv-form">
              <Field label="Handed to (technician or workshop)">
                <input className="inv-input" maxLength={120} value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="Name of the person receiving the parts" />
              </Field>
              <Field label="Note (optional)">
                <input className="inv-input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
          )}
          {canIssue && pickable.length > 0 && !receivedBy.trim() && (
            <Note tone="warn">No receiver named. The pick will post, but the handover will show "not recorded".</Note>
          )}
          {!canIssue && lines.length > 0 && (
            <Note tone="warn">You can view and print this list. Confirming a pick needs the inventory issue permission.</Note>
          )}

          {groups.map((g) => (
            <div key={g.site} className="inv-pick-site">
              <h4 className="cc-card-title">{g.site} <span className="cc-card-sub">({g.lineCount} lines)</span></h4>
              {g.locations.map((loc) => (
                <div key={loc.path} className="inv-pick-loc">
                  <p className="cc-card-sub"><strong>{loc.path}</strong></p>
                  <div className="inv-scroll">
                    <KitTable compact columns={alignNumeric(pickColumns)} rows={loc.lines} empty="No lines" />
                  </div>
                </div>
              ))}
            </div>
          ))}

          {canIssue && pickable.length > 1 && (
            <div className="inv-actions">
              <button type="button" className="cc-btn-primary" disabled={!!busy} onClick={confirmAll}>
                <PackageMinus size={14} aria-hidden="true" /> Confirm all picks
              </button>
            </div>
          )}
          {picked.length > 0 && (
            <Note tone="good">Picked and issued: {picked.map((p) => `${formatQty(p.qty)} x ${p.item || 'item'}`).join(', ')}.</Note>
          )}
        </SectionCard>
      )}
    </>
  )
}
