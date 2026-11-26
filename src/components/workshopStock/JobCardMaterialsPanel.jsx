/**
 * Job card materials: the whole workshop <-> warehouse flow for one job card.
 *
 *   request  -> check the store first: free stock is RESERVED for the job card,
 *               only the shortage becomes a requisition (no buying what is on the shelf)
 *   issue    -> one material issue slip (MIS) naming the job card, asset and receiver,
 *               posted to the ledger once (idempotent per line on the server)
 *   install  -> the workshop confirms what was fitted (optional note and signature);
 *               the person who issued cannot confirm their own issue
 *   return   -> unused parts go back to the stock line they came from, bounded by
 *               what is issued and not yet installed or returned
 *   reconcile-> issued - installed - returned = unreconciled, shown per line
 *   cost     -> from the issue movements, per currency; unvalued quantity is shown
 *               as unvalued, never as zero
 *
 * Every rule is enforced in the database (migrations 20261124091000 and
 * 20261124131000); this screen only decides what to offer.
 * Props: { scope, can, userId, onNavigate }.
 */
import { useMemo, useState } from 'react'
import {
  AlertTriangle, ClipboardList, Coins, FileDown, FileSpreadsheet, Package, PackageCheck,
  PackageMinus, Search, ShoppingCart, Undo2, Wrench,
} from 'lucide-react'
import { newIdempotencyKey } from '../../lib/api/inventory'
import {
  loadJobCardMaterials, findStockForRequest, reserveForJob, raiseShortageRequisition,
  issueReservedToJob, confirmInstallation, returnUnused,
} from '../../lib/workshopStock/service'
import {
  planRequest, validateInstall, validateReturn, JOB_MATERIAL_EXPORT_COLUMNS,
} from '../../lib/workshopStock/jobMaterials'
import { normaliseJobCard } from '../../lib/inventory/floorWorkflow'
import { formatMoney, formatQty, formatTotals } from '../../lib/inventory/inventoryMoney'
import { toUserMessage } from '../../lib/inventory/errorText'
import { exportToExcel, exportToPdf, reportFileName } from '../../lib/exportUtils'
import { Kpi, KitTable } from '../commandCenter/kit'
import SignaturePad from '../SignaturePad'
import { Field, ErrorNote, Note, NotSetUp, SectionCard, StatusPill, alignNumeric, fmtDateTime } from '../inventory/InvUi'

const costText = (cost) => (cost?.length ? formatTotals(cost) : 'N/A')

export default function JobCardMaterialsPanel({ scope, can, onNavigate, initialJobCard = '' }) {
  const canIssue = typeof can === 'function' && can('issue')
  const canExport = typeof can === 'function' && can('export')
  const [jobCard, setJobCard] = useState(initialJobCard)
  const [state, setState] = useState({ loading: false, error: '', data: null })
  const [flash, setFlash] = useState(null)

  const load = async (jc = jobCard) => {
    const j = normaliseJobCard(jc)
    if (!j) { setState({ loading: false, error: 'Enter a job card number.', data: null }); return }
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      setState({ loading: false, error: '', data: await loadJobCardMaterials(j) })
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e), data: null })
    }
  }
  const reload = () => load(state.data?.lookupJobCard || jobCard)
  const data = state.data
  const wo = data?.workOrder
  const site = wo?.site || (scope?.site && scope.site !== 'all' ? scope.site : '')
  const country = wo?.country || scope?.country

  return (
    <>
      <SectionCard title="Job card materials" sub="Reserve from the store before buying, issue once, confirm what was fitted, return what was not, and see the cost.">
        <form className="inv-form" onSubmit={(e) => { e.preventDefault(); load() }}>
          <Field label="Job card number">
            <input className="inv-input" maxLength={80} value={jobCard} onChange={(e) => setJobCard(e.target.value)} placeholder="e.g. GCKR/JC/0082/0323" />
          </Field>
          <div className="inv-actions">
            <button type="submit" className="cc-btn-primary" disabled={state.loading}>
              <Search size={14} aria-hidden="true" /> {state.loading ? 'Loading...' : 'Open job card'}
            </button>
          </div>
        </form>
        {state.error && <ErrorNote error={state.error} onRetry={jobCard ? () => load() : undefined} />}
        {flash && <Note tone={flash.tone}>{flash.text}</Note>}
      </SectionCard>

      {state.loading && !data && <Note>Loading the job card materials...</Note>}
      {data?.status === 'not_provisioned' && <NotSetUp what="Job card materials" />}

      {data?.status === 'ok' && (
        <>
          <SectionCard
            title={`Job card ${data.jobCard}`}
            sub={wo ? `Asset ${wo.asset_no || 'N/A'} at ${wo.site || 'N/A'}, status ${wo.status || 'N/A'}` : 'No job card with this number in Work Orders. Stock recorded under this number is still shown.'}
            action={canExport && data.rows.length ? <ExportButtons data={data} /> : null}>
            <Summary summary={data.summary} />
            {data.truncated && <Note tone="warn">This job card has more records than one screen reads. The first {data.rows.length} lines are shown.</Note>}
            {!data.installationsAvailable && <Note tone="warn">Installation confirmation is not set up on this database yet, so every issued part shows as unreconciled.</Note>}
          </SectionCard>

          {canIssue && (
            <RequestParts data={data} site={site} country={country} onDone={(f) => { setFlash(f); reload() }} />
          )}

          <MaterialLines data={data} canIssue={canIssue} site={site} country={country} onDone={(f) => { setFlash(f); reload() }} />

          {(data.requisitions?.length > 0 || !data.requisitionLinkAvailable) && (
            <SectionCard title="Purchase requests for this job card" sub="Raised for what the store could not cover.">
              {!data.requisitionLinkAvailable && <Note tone="warn">Requisitions are not linked to job cards on this database yet; a shortage request names the job card in its notes.</Note>}
              {data.requisitions?.length > 0 && (
                <div className="inv-scroll">
                  <KitTable compact rows={data.requisitions} columns={alignNumeric([
                    { key: 'requisition_no', header: 'Number', cell: (r) => r.requisition_no || <span className="cc-na">Pending</span> },
                    { key: 'item', header: 'Item' },
                    { key: 'quantity', header: 'Qty', numeric: true, cell: (r) => formatQty(r.quantity) },
                    { key: 'status', header: 'Status', cell: (r) => <StatusPill value={r.status} tone="info" label={r.status} /> },
                    { key: 'created_at', header: 'Raised', cell: (r) => fmtDateTime(r.created_at) },
                  ])} />
                </div>
              )}
              {typeof onNavigate === 'function' && (
                <div className="inv-actions"><button type="button" className="cc-btn-ghost" onClick={() => onNavigate('procurement')}><ShoppingCart size={14} aria-hidden="true" /> Open procurement</button></div>
              )}
            </SectionCard>
          )}
        </>
      )}
    </>
  )
}

function Summary({ summary: s }) {
  return (
    <>
      <div className="cc-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        <Kpi icon={ClipboardList} tone="blue" value={s.requested} display={formatQty(s.requested)} label="Requested" />
        <Kpi icon={Package} tone="blue" value={s.reserved} display={formatQty(s.reserved)} label="Reserved, not issued" />
        <Kpi icon={PackageMinus} tone="amber" value={s.issued} display={formatQty(s.issued)} label="Issued" />
        <Kpi icon={Wrench} tone="green" value={s.installed} display={formatQty(s.installed)} label="Installed" />
        <Kpi icon={Undo2} tone="muted" value={s.returned} display={formatQty(s.returned)} label="Returned" />
        <Kpi icon={AlertTriangle} tone={s.unreconciled > 0 ? 'red' : 'green'} danger={s.unreconciled > 0} value={s.unreconciled} display={formatQty(s.unreconciled)} label="Unreconciled" />
        <Kpi icon={Coins} tone="green" display={costText(s.cost)} label="Net material cost" />
        <Kpi icon={ShoppingCart} tone="amber" value={s.openRequisitions} display={`${s.openRequisitions} (${formatQty(s.onOrderQty)})`} label="Open purchase requests" />
      </div>
      {s.unvaluedQty > 0 && <Note tone="warn">{formatQty(s.unvaluedQty)} issued unit(s) have no cost yet. They are left out of the cost, not counted as zero.</Note>}
      {s.mixedCurrency && <Note>Costs are in more than one currency and are shown separately, never added together.</Note>}
      {s.reconciled && <Note tone="good">Every issued part is accounted for as installed or returned.</Note>}
    </>
  )
}

function ExportButtons({ data }) {
  const rows = () => data.rows.map((r) => ({ ...r, costText: costText(r.cost) }))
  const name = reportFileName('Job card materials', data.jobCard)
  return (
    <div className="inv-actions">
      <button type="button" className="cc-btn-ghost" onClick={() => exportToPdf(rows(), JOB_MATERIAL_EXPORT_COLUMNS, `Job card materials: ${data.jobCard}`, name, 'landscape')}>
        <FileDown size={14} aria-hidden="true" /> PDF
      </button>
      <button type="button" className="cc-btn-ghost" onClick={() => exportToExcel(rows(), JOB_MATERIAL_EXPORT_COLUMNS.map((c) => c.key), JOB_MATERIAL_EXPORT_COLUMNS.map((c) => c.header), name)}>
        <FileSpreadsheet size={14} aria-hidden="true" /> Excel
      </button>
    </div>
  )
}

/** Request parts: look in the store first, reserve what is free, requisition the rest. */
function RequestParts({ data, site, country, onDone }) {
  const [search, setSearch] = useState('')
  const [found, setFound] = useState({ loading: false, error: '', rows: null })
  const [pick, setPick] = useState('')
  const [qty, setQty] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const items = useMemo(() => {
    const m = new Map()
    for (const b of found.rows || []) {
      const k = b.item_code || b.description || b.id
      if (!m.has(k)) m.set(k, { key: k, itemId: b.item_id, itemCode: b.item_code, description: b.description, lines: [] })
      m.get(k).lines.push(b)
    }
    return [...m.values()]
  }, [found.rows])
  const chosen = items.find((i) => i.key === pick) || null
  const plan = chosen && qty !== '' ? planRequest({ qty, balances: chosen.lines, site }) : null

  const look = async () => {
    setErr(''); setPick('')
    if (!search.trim()) { setFound({ loading: false, error: 'Type an item code or description.', rows: null }); return }
    setFound({ loading: true, error: '', rows: null })
    try {
      setFound({ loading: false, error: '', rows: await findStockForRequest({ search, country, site }) })
    } catch (e) {
      setFound({ loading: false, error: toUserMessage(e), rows: null })
    }
  }

  const reserve = async () => {
    if (!plan?.allocations.length) return
    setBusy(true); setErr('')
    try {
      for (const a of plan.allocations) {
        const res = await reserveForJob({ stockId: a.stockId, qty: a.qty, jobCard: data.jobCard }, newIdempotencyKey())
        if (res?.status === 'refused_shortage') throw new Error('The free stock changed while you were working. Check the stock again.')
      }
      onDone({ tone: 'good', text: `Reserved ${formatQty(plan.covered)} from the store for job card ${data.jobCard}.` })
      setQty(''); setFound({ loading: false, error: '', rows: null })
    } catch (e) {
      setErr(toUserMessage(e))
    } finally { setBusy(false) }
  }

  const requisition = async () => {
    const shortage = plan ? plan.shortage : Number(qty)
    if (!(shortage > 0)) return
    setBusy(true); setErr('')
    try {
      await raiseShortageRequisition({ jobCard: data.jobCard, itemId: chosen?.itemId, itemCode: chosen?.itemCode, description: chosen?.description, qty: shortage, site, country })
      onDone({ tone: 'good', text: `Purchase request raised for ${formatQty(shortage)} (the store could not cover it).` })
    } catch (e) {
      setErr(toUserMessage(e))
    } finally { setBusy(false) }
  }

  return (
    <SectionCard title="Request parts" sub={`The store is checked first${site ? ` at ${site}` : ''}. Only what it cannot cover becomes a purchase request.`}>
      <form className="inv-form" onSubmit={(e) => { e.preventDefault(); look() }}>
        <Field label="Item code or description">
          <input className="inv-input" maxLength={80} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. oil filter" />
        </Field>
        <div className="inv-actions">
          <button type="submit" className="cc-btn-ghost" disabled={found.loading}><Search size={14} aria-hidden="true" /> {found.loading ? 'Checking...' : 'Check the store'}</button>
        </div>
      </form>
      {found.error && <ErrorNote error={found.error} onRetry={look} />}
      {found.rows && !items.length && <Note>No stock line matches this at {site || 'your sites'}. Raise a purchase request instead, naming the item in the request.</Note>}
      {items.length > 0 && (
        <div className="inv-form">
          <Field label="Item">
            <select className="inv-input" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose the item</option>
              {items.map((i) => {
                const free = i.lines.reduce((n, b) => n + Math.max(0, (Number(b.qty_on_hand) || 0) - (Number(b.qty_reserved) || 0)), 0)
                return <option key={i.key} value={i.key}>{`${i.itemCode || 'No code'} ${i.description || ''} (free ${formatQty(free)})`.trim()}</option>
              })}
            </select>
          </Field>
          <Field label="Quantity needed">
            <input className="inv-input inv-num" type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
        </div>
      )}
      {plan && !plan.error && (
        <Note tone={plan.shortage > 0 ? 'warn' : 'good'}>
          {plan.covered > 0 ? `${formatQty(plan.covered)} can be reserved from ${plan.allocations.map((a) => a.location || 'the store').join(', ')}. ` : 'Nothing is free in the store. '}
          {plan.shortage > 0 ? `${formatQty(plan.shortage)} is short and needs a purchase request.` : 'Nothing needs to be bought.'}
        </Note>
      )}
      {plan?.error && <p className="inv-err" role="alert">{plan.error}</p>}
      {err && <p className="inv-err" role="alert">{err}</p>}
      {plan && !plan.error && (
        <div className="inv-actions">
          {plan.covered > 0 && (
            <button type="button" className="cc-btn-primary" disabled={busy} onClick={reserve}><Package size={14} aria-hidden="true" /> {busy ? 'Saving...' : `Reserve ${formatQty(plan.covered)}`}</button>
          )}
          {plan.shortage > 0 && (
            <button type="button" className="cc-btn-ghost" disabled={busy} onClick={requisition}><ShoppingCart size={14} aria-hidden="true" /> Request purchase of {formatQty(plan.shortage)}</button>
          )}
        </div>
      )}
    </SectionCard>
  )
}

/** The per-line table plus issue, install and return actions. */
function MaterialLines({ data, canIssue, site, country, onDone }) {
  const rows = data.rows
  const reservedLines = rows.flatMap((r) => r.reservations.map((res) => ({
    key: `r:${res.id}`, stockId: r.stockId, reservationId: res.id, qty: res.open,
    itemCode: r.itemCode, description: r.description, uom: r.uom, location: r.location,
  })))
  const [issuedTo, setIssuedTo] = useState('')
  const [note, setNote] = useState('')
  const [keys] = useState(() => new Map())
  const [slip, setSlip] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [action, setAction] = useState(null)

  const keyFor = (k) => { if (!keys.has(k)) keys.set(k, newIdempotencyKey()); return keys.get(k) }

  const issueAll = async () => {
    setBusy('issue'); setErr('')
    try {
      const res = await issueReservedToJob({
        jobCard: data.jobCard, workOrder: data.workOrder, site, country, lines: reservedLines,
        issuedTo, note, retrySlipId: slip?.slipId,
      }, Object.fromEntries(reservedLines.map((l) => [l.key, keyFor(l.key)])))
      if (!res.ok) {
        if (res.slipId) setSlip({ slipId: res.slipId, issueNumber: res.issueNumber })
        setErr(res.message || 'The parts were not issued.')
        return
      }
      setSlip(null); keys.clear()
      onDone({ tone: 'good', text: res.mode === 'slip'
        ? `Issued on slip ${res.issueNumber || ''} to ${issuedTo}. ${res.already ? `${res.already} line(s) were already posted and did not move again.` : ''}`.trim()
        : `Issued ${res.posted} line(s) to ${issuedTo}.` })
    } catch (e) {
      setErr(toUserMessage(e))
    } finally { setBusy('') }
  }

  const columns = alignNumeric([
    { key: 'itemCode', header: 'Item', cell: (r) => <><strong>{r.itemCode || 'No code'}</strong><br /><span className="cc-card-sub">{r.description || ''}</span></> },
    { key: 'location', header: 'From', cell: (r) => r.location || <span className="cc-na">N/A</span> },
    { key: 'requested', header: 'Requested', numeric: true, cell: (r) => formatQty(r.requested) },
    { key: 'reserved', header: 'Reserved', numeric: true, cell: (r) => formatQty(r.reserved) },
    { key: 'issued', header: 'Issued', numeric: true, cell: (r) => formatQty(r.issued) },
    { key: 'installed', header: 'Installed', numeric: true, cell: (r) => formatQty(r.installed) },
    { key: 'returned', header: 'Returned', numeric: true, cell: (r) => formatQty(r.returned) },
    { key: 'unreconciled', header: 'Unreconciled', numeric: true, cell: (r) => (r.unreconciled > 0
      ? <StatusPill value="open" tone="warn" label={formatQty(r.unreconciled)} /> : formatQty(0)) },
    { key: 'cost', header: 'Net cost', cell: (r) => (r.cost.length ? r.cost.map((c) => formatMoney(c.amount, c.currency)).join(' | ') : (r.unvaluedQty > 0 ? <StatusPill value="unvalued" tone="warn" label="Unvalued" /> : <span className="cc-na">N/A</span>)) },
    { key: 'act', header: 'Actions', sortable: false, cell: (r) => (
      <div className="inv-actions">
        {r.unreconciled > 0 && r.issues.some((i) => i.open > 0) && (
          <button type="button" className="cc-btn-ghost" onClick={() => setAction({ kind: 'install', row: r })}><Wrench size={14} aria-hidden="true" /> Confirm installed</button>
        )}
        {canIssue && r.unreconciled > 0 && (
          <button type="button" className="cc-btn-ghost" onClick={() => setAction({ kind: 'return', row: r })}><Undo2 size={14} aria-hidden="true" /> Return unused</button>
        )}
      </div>
    ) },
  ])

  return (
    <SectionCard title="Materials on this job card" sub="Issued minus installed minus returned must reach zero before the job card is reconciled.">
      {!rows.length && <Note icon={ClipboardList}>Nothing is reserved or issued for this job card yet. Use Request parts to check the store.</Note>}
      {rows.length > 0 && <div className="inv-scroll"><KitTable compact rows={rows} columns={columns} empty="No materials" /></div>}

      {canIssue && reservedLines.length > 0 && (
        <div className="inv-form" style={{ marginTop: 12 }}>
          <Field label="Received by (technician)">
            <input className="inv-input" maxLength={120} value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} placeholder="Name of the person receiving the parts" />
          </Field>
          <Field label="Note (optional)">
            <input className="inv-input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="inv-actions">
            <button type="button" className="cc-btn-primary" disabled={!!busy || !issuedTo.trim()} onClick={issueAll}>
              <PackageCheck size={14} aria-hidden="true" /> {busy === 'issue' ? 'Posting...' : slip ? `Post slip ${slip.issueNumber || ''} again` : `Issue ${reservedLines.length} reserved line(s)`}
            </button>
          </div>
        </div>
      )}
      {slip && <Note tone="warn">Slip {slip.issueNumber || ''} is saved but did not post. Posting it again cannot move stock twice.</Note>}
      {err && <p className="inv-err" role="alert">{err}</p>}

      {action?.kind === 'install' && <InstallForm data={data} row={action.row} onClose={() => setAction(null)} onDone={onDone} />}
      {action?.kind === 'return' && <ReturnForm data={data} row={action.row} onClose={() => setAction(null)} onDone={onDone} />}
    </SectionCard>
  )
}

function InstallForm({ data, row, onClose, onDone }) {
  const open = row.issues.filter((i) => i.open > 0)
  const [issueId, setIssueId] = useState(open[0]?.id || '')
  const [qty, setQty] = useState(String(Math.min(open[0]?.open || 0, row.unreconciled)))
  const [note, setNote] = useState('')
  const [signature, setSignature] = useState(null)
  const [padOpen, setPadOpen] = useState(false)
  const [key] = useState(() => newIdempotencyKey())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const issue = open.find((i) => i.id === issueId)

  const save = async () => {
    const v = validateInstall({ issue, row, qty })
    if (!v.ok) { setErr(v.error); return }
    setBusy(true); setErr('')
    const res = await confirmInstallation({ movementId: issue.id, qty: v.qty, note, signatureImage: signature }, key)
    setBusy(false)
    if (!res.ok) { setErr(res.message); return }
    onDone({ tone: 'good', text: `${formatQty(v.qty)} x ${row.itemCode || 'part'} confirmed installed on job card ${data.jobCard}.` })
    onClose()
  }

  return (
    <div className="cc-card" style={{ marginTop: 12, padding: 12 }}>
      <p className="cc-card-title">Confirm installed: {row.itemCode || 'part'}</p>
      <div className="inv-form">
        <Field label="Issue">
          <select className="inv-input" value={issueId} onChange={(e) => setIssueId(e.target.value)}>
            {open.map((i) => <option key={i.id} value={i.id}>{`${fmtDateTime(i.postedAt)}: ${formatQty(i.open)} not yet confirmed${i.reference ? ` (${i.reference})` : ''}`}</option>)}
          </select>
        </Field>
        <Field label="Quantity fitted">
          <input className="inv-input inv-num" type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Note (optional)">
          <input className="inv-input" maxLength={400} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="inv-actions">
        <button type="button" className="cc-btn-ghost" onClick={() => setPadOpen(true)}>{signature ? 'Signature added, sign again' : 'Add signature (optional)'}</button>
      </div>
      <Note>The person who issued the parts cannot confirm their own issue.</Note>
      {err && <p className="inv-err" role="alert">{err}</p>}
      <div className="inv-actions">
        <button type="button" className="cc-btn-primary" disabled={busy} onClick={save}><Wrench size={14} aria-hidden="true" /> {busy ? 'Saving...' : 'Confirm installed'}</button>
        <button type="button" className="cc-btn-ghost" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
      {padOpen && <SignaturePad label="Technician signature" onSave={(d) => { setSignature(d); setPadOpen(false) }} onClose={() => setPadOpen(false)} />}
    </div>
  )
}

function ReturnForm({ data, row, onClose, onDone }) {
  const [qty, setQty] = useState(String(row.unreconciled))
  const [reason, setReason] = useState('Not used on the job')
  const [key] = useState(() => newIdempotencyKey())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    const v = validateReturn({ row, qty, reason })
    if (!v.ok) { setErr(v.error); return }
    setBusy(true); setErr('')
    try {
      await returnUnused({ stockId: row.stockId, qty: v.qty, jobCard: data.jobCard, reason }, key)
      onDone({ tone: 'good', text: `${formatQty(v.qty)} x ${row.itemCode || 'part'} returned to ${row.location || 'the store'}.` })
      onClose()
    } catch (e) {
      setErr(toUserMessage(e))
    } finally { setBusy(false) }
  }

  return (
    <div className="cc-card" style={{ marginTop: 12, padding: 12 }}>
      <p className="cc-card-title">Return unused: {row.itemCode || 'part'}</p>
      <div className="inv-form">
        <Field label={`Quantity (up to ${formatQty(row.unreconciled)})`}>
          <input className="inv-input inv-num" type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Reason">
          <input className="inv-input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      <Note>It goes back to the stock line it was issued from, at the cost it was issued at. Parts confirmed installed cannot be returned.</Note>
      {err && <p className="inv-err" role="alert">{err}</p>}
      <div className="inv-actions">
        <button type="button" className="cc-btn-primary" disabled={busy} onClick={save}><Undo2 size={14} aria-hidden="true" /> {busy ? 'Saving...' : 'Return to store'}</button>
        <button type="button" className="cc-btn-ghost" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}
