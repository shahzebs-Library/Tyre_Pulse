/**
 * ERP stores ledger upload (Ramco report CSOL-IMS-013-1).
 *
 * The owner exports one Stores Ledger per warehouse from the ERP and drops the
 * files here as they are. For each file the panel shows, before anything is
 * saved: the store it belongs to, new item codes (with a suggested category the
 * owner can change), names that would take the ERP wording, items still
 * unclassified, and every stock quantity that would change. Posting is owner
 * only (enforced in the database by inv_erp_ledger_begin/apply/finish) and needs
 * no second approval, by the owner's decision of 2026-11-26.
 *
 * Rates from the file are kept with the upload record and are not written as
 * stock cost; added units follow the stock-count rule (current average cost, or
 * unvalued). Negative ERP quantities are held back. The same file can never be
 * posted twice.
 */
import { useEffect, useState } from 'react'
import { Upload, Send, FileSpreadsheet, PackagePlus, Tags, ArrowUpDown, AlertTriangle, CheckCircle2 } from 'lucide-react'
import Modal from '../ui/Modal'
import SideDrawer from '../ui/SideDrawer'
import { KitTable, Kpi, Tabs } from '../commandCenter/kit'
import { useAuth } from '../../contexts/AuthContext'
import {
  listLocations, loadMasterForLedger, loadStockAtLocation, listErpLedgerUploads, findErpLedgerUpload, beginErpLedger, runErpLedger,
  cancelErpLedger, countMovementsAfter, newIdempotencyKey,
} from '../../lib/api/inventory'
import {
  parseStoreLedger, postBlockers, resolveLocation, buildLedgerPlan, buildNeighbours, buildPostPayload, sha256Hex,
} from '../../lib/inventory/erpStoreLedger'
import { MATERIAL_CATEGORIES } from '../../lib/materialMaster'
import { formatQty, formatMoney } from '../../lib/inventory/inventoryMoney'
import { toUserMessage } from '../../lib/inventory/errorText'
import { useInvQuery, PagedTable, ErrorNote, Note, StatusPill, SectionCard, fmtDateTime } from './InvUi'

const COUNTRIES = ['KSA', 'UAE', 'Egypt']
const REASON_TEXT = {
  negative_qty: 'Negative quantity in the ERP. A count cannot be below zero; check it in the ERP.',
  below_reserved: 'Below the quantity reserved for job cards.',
  no_item: 'Item code not in the Material Master.',
  serial_tracked: 'Tyres and other serial-tracked items need their serial numbers; count them in Tyre custody.',
  missing_but_reserved: 'Not in the file, but reserved for a job card.',
}
const reasonLabel = (r) => {
  const [kind, note] = String(r || '').split(':')
  if (kind === 'code_range') return `ERP code range (${note || ''})`
  if (kind === 'description') return `Description says ${note}`
  if (kind === 'neighbours') return `Most reviewed items starting ${note} are this`
  return 'No clear signal; spare part'
}
const signed = (n) => (n > 0 ? `+${formatQty(n)}` : formatQty(n))
const heldSummary = (held = []) => {
  const by = {}
  held.forEach((h) => { by[h.reason] = (by[h.reason] || 0) + 1 })
  const parts = Object.entries(by).map(([r, n]) => `${n} ${({ negative_qty: 'negative', below_reserved: 'below reserved', no_item: 'unknown code', serial_tracked: 'serial-tracked', missing_but_reserved: 'reserved' }[r] || r)}`)
  return parts.length ? ` (${parts.join(', ')})` : ''
}

function fileStatus(f) {
  if (f.reading) return { tone: 'info', label: 'Reading' }
  if (f.error) return { tone: 'bad', label: 'Could not read' }
  if (f.stockError) return { tone: 'bad', label: 'Could not check stock' }
  if (!f.parsed?.ok) return { tone: 'bad', label: 'Not a stores ledger' }
  if (f.posted) return { tone: 'good', label: 'Posted' }
  if (f.previous?.status === 'open') return { tone: 'warning', label: 'Not finished' }
  if (f.previous) return { tone: 'muted', label: 'Already posted' }
  if (postBlockers(f.parsed).length) return { tone: 'bad', label: 'Cannot post' }
  if (f.location === null) return { tone: 'warning', label: 'Store not found' }
  if (f.loading || !f.plan) return { tone: 'info', label: 'Checking' }
  return { tone: 'info', label: 'Ready' }
}

export default function ErpLedgerPanel({ scope }) {
  const { isSuperAdmin } = useAuth()
  const [country, setCountry] = useState(scope?.country && scope.country !== 'all' ? scope.country : 'KSA')
  const [files, setFiles] = useState([])
  const [open, setOpen] = useState(null)
  const [tab, setTab] = useState('stock')
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [ref, setRef] = useState({ status: 'idle', locations: [], master: [], neighbours: new Map(), truncated: false })
  const [refNonce, setRefNonce] = useState(0)
  const [histCancel, setHistCancel] = useState(null)
  const history = useInvQuery(() => listErpLedgerUploads({ page, pageSize, country }), [page, pageSize, country])

  // Locations and the Material Master for the chosen country, read once per country
  // (and again after a post). Only the owner uploads, so nobody else loads them.
  useEffect(() => {
    if (!isSuperAdmin) return undefined
    let live = true
    setRef((r) => ({ ...r, status: 'loading' }))
    Promise.all([listLocations({ country }), loadMasterForLedger(country)])
      .then(([loc, mm]) => {
        if (!live) return
        setRef({ status: 'ok', locations: loc.rows || [], master: mm.rows, neighbours: buildNeighbours(mm.rows), truncated: mm.truncated || loc.truncated })
      })
      .catch((e) => { if (live) setRef((r) => ({ ...r, status: 'error', error: toUserMessage(e) })) })
    return () => { live = false }
  }, [country, refNonce, isSuperAdmin])

  const patch = (id, change) => setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, ...(typeof change === 'function' ? change(f) : change) } : f)))

  // Compare each readable file with live stock at its store.
  useEffect(() => {
    if (ref.status !== 'ok') return
    files.forEach((f) => {
      if (!f.parsed?.ok || f.plan || f.loading || f.posted || f.location === null || f.error || f.stockError) return
      const location = f.location === undefined ? resolveLocation(f.parsed.meta.warehouses[0], ref.locations) : f.location
      if (!location) { patch(f.id, { location: null }); return }
      patch(f.id, { location, loading: true })
      loadStockAtLocation(location.id)
        .then((st) => {
          // Re-planned after an earlier post: keep the owner's choices.
          const base = buildLedgerPlan({ lines: f.parsed.lines, master: ref.master, stock: st.rows, neighbours: ref.neighbours })
          const categories = { ...Object.fromEntries([...base.newItems, ...base.reclassify].map((x) => [x.code, x.category])), ...(f.categories || {}) }
          const plan = buildLedgerPlan({ lines: f.parsed.lines, master: ref.master, stock: st.rows, neighbours: ref.neighbours, categories })
          countMovementsAfter(location.id, f.parsed.meta.to, country).then((n) => patch(f.id, { movesAfter: n })).catch(() => {})
          patch(f.id, {
            loading: false, plan, stockRows: st.rows, stockTruncated: st.truncated, categories,
            skipRenames: f.skipRenames || new Set(), skipReclass: f.skipReclass || new Set(), zeroMissing: Boolean(f.zeroMissing),
          })
        })
        .catch((e) => patch(f.id, { loading: false, stockError: toUserMessage(e) }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, ref.status])

  // A changed category can change what is held (a tyre needs serials), so re-plan.
  const setCategory = (fid, code, value) => setFiles((fs) => fs.map((g) => {
    if (g.id !== fid) return g
    const categories = { ...g.categories, [code]: value }
    const plan = g.stockRows ? buildLedgerPlan({ lines: g.parsed.lines, master: ref.master, stock: g.stockRows, neighbours: ref.neighbours, categories }) : g.plan
    return { ...g, categories, plan }
  }))

  const readFiles = async (list) => {
    setErr('')
    const { parseWorkbookRaw } = await import('../../lib/import/parseWorkbook')
    for (const file of list) {
      const id = newIdempotencyKey()
      setFiles((fs) => [...fs, { id, filename: file.name, reading: true }])
      try {
        const buf = await file.arrayBuffer()
        const sha = await sha256Hex(buf)
        const { sheets } = await parseWorkbookRaw(buf, { fileName: file.name })
        const sheet = (sheets || []).find((s) => s.aoa?.length) || sheets?.[0]
        const parsed = parseStoreLedger(sheet?.aoa || [], { filename: file.name })
        const previous = await findErpLedgerUpload(sha).catch(() => null)
        patch(id, { reading: false, sha, parsed, previous, key: newIdempotencyKey() })
      } catch (e) {
        patch(id, { reading: false, error: toUserMessage(e, 'This file could not be read.') })
      }
    }
  }

  const runUpload = async (f, uploadId) => {
    patch(f.id, { progress: 'Posting stock...' })
    const res = await runErpLedger(uploadId, {
      onProgress: ({ phase, remaining }) => patch(f.id, { progress: phase === 'stock' ? `Posting stock, ${remaining} codes left...` : `Finishing, ${remaining} left...` }),
    })
    patch(f.id, { posted: res, progress: null, previous: null })
    setConfirm(null)
    history.retry()
    // Codes added and stock changed: re-plan the other files against the new state.
    setFiles((fs) => fs.map((g) => (g.id !== f.id && !g.posted && g.plan ? { ...g, plan: null, location: undefined } : g)))
    setRefNonce((n) => n + 1)
  }

  // Continue an upload that stopped part way (it is safe to run again).
  const resume = async (f) => {
    setBusy(true); setErr('')
    try { await runUpload(f, f.previous.id) } catch (e) { setErr(toUserMessage(e)); patch(f.id, { progress: null }) } finally { setBusy(false) }
  }
  const cancelOpen = async (f) => {
    setBusy(true); setErr('')
    // A fresh request key: the old one would replay the cancelled upload.
    try { await cancelErpLedger(f.previous.id, newIdempotencyKey()); patch(f.id, { previous: null, key: newIdempotencyKey() }); history.retry() }
    catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false) }
  }

  const post = async (f) => {
    setBusy(true); setErr('')
    try {
      const plan = f.plan
      const withCats = {
        ...plan,
        newItems: plan.newItems.map((n) => ({ ...n, category: f.categories[n.code] || n.category })),
        reclassify: plan.reclassify.map((n) => ({ ...n, category: f.categories[n.code] || n.category })).filter((n) => n.category !== 'unclassified'),
      }
      const keep = (list, skip) => new Set(list.map((x) => x.code).filter((c) => !skip.has(c)))
      const payload = buildPostPayload({
        meta: f.parsed.meta, location: f.location, country, lines: f.parsed.lines, plan: withCats, sha256: f.sha,
        idempotencyKey: f.key,
        choices: { zeroMissing: f.zeroMissing, renames: keep(plan.renames, f.skipRenames), reclassify: keep(withCats.reclassify, f.skipReclass) },
      })
      payload.movements_after = f.movesAfter ?? null
      payload.movements_after_ack = Boolean(f.ackMoves)
      const begun = await beginErpLedger(payload, f.key)
      patch(f.id, { previous: { id: begun.upload_id, status: 'open', created_at: new Date().toISOString(), filename: f.filename } })
      await runUpload(f, begun.upload_id)
    } catch (e) {
      setErr(toUserMessage(e))
      // If the upload started on the server, show it so it can be continued.
      const prev = await findErpLedgerUpload(f.sha).catch(() => null)
      patch(f.id, { progress: null, previous: prev || f.previous || null })
    } finally { setBusy(false) }
  }

  // Continue or cancel an unfinished upload from the history list (no file needed).
  const runFromHistory = async (u, action) => {
    setBusy(true); setErr('')
    try {
      const same = (g) => g.previous?.id === u.id
      if (action === 'cancel') {
        await cancelErpLedger(u.id, newIdempotencyKey())
        setFiles((fs) => fs.map((g) => (same(g) ? { ...g, previous: null, key: newIdempotencyKey() } : g)))
      } else {
        const res = await runErpLedger(u.id)
        setFiles((fs) => fs.map((g) => (same(g) ? { ...g, previous: null, posted: res } : g)))
        setRefNonce((n) => n + 1)
      }
      setHistCancel(null)
      history.retry()
    } catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false) }
  }

  // A file with the same content as one earlier in the list is marked, so only one is posted.
  const rows = files.map((f, i) => ({ ...f, status: fileStatus(f), duplicateOf: f.sha ? files.slice(0, i).find((g) => g.sha === f.sha)?.filename || null : null }))
  const columns = [
    { key: 'filename', header: 'File', cell: (f) => <span className="inv-mono">{f.filename}</span> },
    { key: 'warehouse', header: 'ERP store', cell: (f) => f.parsed?.meta?.warehouses?.join(', ') || <span className="cc-na">N/A</span> },
    { key: 'location', header: 'Tyre Pulse location', cell: (f) => (f.location ? `${f.location.code} (${f.location.site})${f.location.via === 'alias' ? ' *' : ''}` : <span className="cc-na">N/A</span>) },
    { key: 'lines', header: 'Lines', numeric: true, cell: (f) => formatQty(f.parsed?.lines?.length) },
    { key: 'new', header: 'New items', numeric: true, cell: (f) => formatQty(f.plan?.newItems?.length) },
    { key: 'qty', header: 'Quantity changes', numeric: true, cell: (f) => formatQty(f.plan?.changes?.length) },
    { key: 'held', header: 'Held back', numeric: true, cell: (f) => formatQty(f.plan?.held?.length) },
    { key: 'status', header: 'Status', cell: (f) => <StatusPill value={f.status.label} tone={f.status.tone} label={f.status.label} /> },
  ]

  const cur = open ? files.find((f) => f.id === open) : null
  const isDuplicate = (f) => rows.find((r) => r.id === f?.id)?.duplicateOf
  const canPost = (f) => Boolean(isSuperAdmin && f?.plan && !f.previous && !f.posted && f.location && !f.loading && !isDuplicate(f) && !postBlockers(f.parsed).length)

  return (
    <div className="inv-hub">
      <Note>
        Upload the ERP Stores Ledger export (report CSOL-IMS-013-1), one file per store, exactly as the ERP saves it.
        Nothing is saved until you post a file. Rates are kept with the upload and are not used as stock cost.
      </Note>
      {!isSuperAdmin && <Note tone="warn">Only the owner can post an ERP stores ledger. You can see earlier uploads below.</Note>}

      {isSuperAdmin && (
        <div className="inv-actions" style={{ alignItems: 'flex-end' }}>
          <label className="cc-field" style={{ maxWidth: 160 }}>
            <span>Country</span>
            <select className="cc-select" value={country} disabled={files.length > 0} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="cc-btn-primary focus-within:ring-2 focus-within:ring-offset-2" style={{ cursor: ref.status === 'ok' ? 'pointer' : 'wait', position: 'relative', opacity: ref.status === 'ok' ? 1 : 0.6 }}>
            <Upload size={14} aria-hidden="true" /> Upload ledger files
            <input type="file" multiple accept=".xls,.xlsx,.csv" disabled={ref.status !== 'ok'} className="sr-only"
              aria-label="Upload ERP stores ledger files"
              onChange={(e) => { const l = [...(e.target.files || [])]; e.target.value = ''; if (l.length) readFiles(l) }} />
          </label>
          {files.length > 0 && <button type="button" className="cc-btn-ghost" disabled={busy} onClick={() => setFiles([])}>Clear list</button>}
        </div>
      )}
      {ref.status === 'loading' && isSuperAdmin && <p className="cc-card-sub">Loading the Material Master and store locations for {country}...</p>}
      {ref.status === 'error' && <ErrorNote error={ref.error} />}
      {ref.truncated && <Note tone="warn">The Material Master for {country} is larger than this screen reads at once; some codes may show as new.</Note>}
      {err && !confirm && <ErrorNote error={err} />}

      {files.length > 0 && (
        <SectionCard title="Files" sub="Open a file to check every change before you post it. * = the ERP spells the store differently.">
          <KitTable compact scroll rows={rows} columns={columns} empty="No files yet."
            onRowClick={(f) => { if (!f.reading && !f.loading) { setOpen(f.id); setTab('stock') } }} />
          {rows.some((f) => f.duplicateOf) && <Note tone="warn">Some files have the same content as another file in this list ({rows.filter((f) => f.duplicateOf).map((f) => f.filename).join(', ')}). Only the first of each can be posted.</Note>}
        </SectionCard>
      )}

      <SectionCard title="Earlier uploads">
        <PagedTable query={history} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(0) }}
          empty="No ERP stores ledger has been posted yet." what="ERP stores ledger uploads" noun="uploads"
          columns={[
            { key: 'posted_at', header: 'Posted', cell: (u) => fmtDateTime(u.posted_at || u.created_at) },
            { key: 'status', header: 'Status', cell: (u) => (u.status === 'open'
              ? (
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <StatusPill value="open" tone="warning" label="Not finished" />
                  {isSuperAdmin && <button type="button" className="cc-btn-ghost" disabled={busy} onClick={(e) => { e.stopPropagation(); runFromHistory(u, 'continue') }}>Continue</button>}
                  {isSuperAdmin && <button type="button" className="cc-btn-ghost" disabled={busy} onClick={(e) => { e.stopPropagation(); setHistCancel(u) }}>Cancel</button>}
                </span>
              )
              : <StatusPill value={u.status} tone="good" label="Posted" />) },
            { key: 'filename', header: 'File', cell: (u) => <span className="inv-mono">{u.filename}</span> },
            { key: 'warehouse_code', header: 'ERP store' },
            { key: 'site', header: 'Site' },
            { key: 'period_to', header: 'Balance as at', cell: (u) => u.period_to || <span className="cc-na">N/A</span> },
            { key: 'changed', header: 'Quantities changed', numeric: true, cell: (u) => formatQty(u.summary?.quantities_changed) },
            { key: 'added', header: 'Items added', numeric: true, cell: (u) => formatQty(u.summary?.items_added) },
            { key: 'held', header: 'Held back', numeric: true, cell: (u) => formatQty(u.summary?.held_back?.length) },
          ]} />
      </SectionCard>

      <SideDrawer className="cc inv-panel" open={!!cur} onClose={() => !busy && setOpen(null)} busy={busy} size="xl"
        title={cur ? cur.filename : ''} closeLabel="Close">
        {cur && <FileDetail f={cur} tab={tab} setTab={setTab} patch={patch} onCategory={setCategory} canPost={canPost(cur)} onPost={() => setConfirm(cur.id)}
          isOwner={isSuperAdmin} busy={busy} onResume={() => resume(cur)} onCancelOpen={() => cancelOpen(cur)} err={err} />}
      </SideDrawer>

      <Modal className="cc inv-panel" open={!!confirm} onClose={() => !busy && setConfirm(null)} size="md" title="Post this ledger?"
        footer={(
          <div className="inv-actions">
            <button type="button" className="cc-btn-ghost" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
            <button type="button" className="cc-btn-primary" disabled={busy || (files.find((f) => f.id === confirm)?.movesAfter !== 0 && !files.find((f) => f.id === confirm)?.ackMoves)}
              onClick={() => post(files.find((f) => f.id === confirm))}>
              <Send size={14} aria-hidden="true" /> {busy ? 'Posting...' : 'Post'}
            </button>
          </div>
        )}>
        {confirm && (() => {
          const f = files.find((x) => x.id === confirm)
          const p = f.plan
          const cats = (list) => list.filter((n) => (f.categories[n.code] || n.category) !== 'unclassified')
          return (
            <div className="inv-hub" style={{ gap: 8 }}>
              <p>Store {f.location.code} ({f.location.site}), balance as at {f.parsed.meta.to || 'N/A'}.</p>
              <ul style={{ margin: 0, paddingInlineStart: 18, display: 'grid', gap: 4 }}>
                <li>{p.changes.length} quantities set to the ERP figure ({signed(p.totals.increase)} / {signed(p.totals.decrease)})</li>
                <li>{p.newItems.length} new item codes added to the Material Master</li>
                <li>{p.renames.length - f.skipRenames.size} item names changed to the ERP wording</li>
                <li>{cats(p.reclassify).filter((n) => !f.skipReclass.has(n.code)).length} unclassified items given a category</li>
                <li>{p.held.length} lines held back</li>
                <li>{f.zeroMissing ? `${p.missing.length} items not in the file set to zero` : `${p.missing.length} items not in the file left as they are`}</li>
              </ul>
              {f.movesAfter !== 0 && (
                <label className="inv-check">
                  <input type="checkbox" checked={Boolean(f.ackMoves)} onChange={() => patch(f.id, (c) => ({ ackMoves: !c.ackMoves }))} />
                  <span>{f.movesAfter > 0
                    ? `${f.movesAfter} stock movements were recorded at this store on or after ${f.parsed.meta.to}. Posting sets the ERP figures and replaces their effect. I understand.`
                    : `Tyre Pulse could not check for stock movements at this store since ${f.parsed.meta.to}. Posting sets the ERP figures. I understand.`}</span>
                </label>
              )}
              {f.progress && <p className="cc-card-sub" role="status">{f.progress}</p>}
              <Note>Each change is logged with this file. Added units take the store's current average cost when it has one, otherwise they stay unvalued; ERP rates are not used. Large stores post in parts; if it stops, open the file again and continue.</Note>
              {err && <ErrorNote error={err} />}
            </div>
          )
        })()}
      </Modal>

      <Modal className="cc inv-panel" open={!!histCancel} onClose={() => !busy && setHistCancel(null)} size="sm" title="Cancel this upload?"
        footer={(
          <div className="inv-actions">
            <button type="button" className="cc-btn-ghost" disabled={busy} onClick={() => setHistCancel(null)}>Keep it</button>
            <button type="button" className="cc-btn-primary" disabled={busy} onClick={() => runFromHistory(histCancel, 'cancel')}>{busy ? 'Cancelling...' : 'Cancel upload'}</button>
          </div>
        )}>
        {histCancel && <p>{histCancel.filename}: no stock has been posted from it yet. The new item codes, names and categories it saved stay.</p>}
        {err && histCancel && <ErrorNote error={err} />}
      </Modal>
    </div>
  )
}

function FileDetail({ f, tab, setTab, patch, onCategory, canPost, onPost, isOwner, busy, onResume, onCancelOpen, err }) {
  const p = f.plan
  const toggle = (field, code) => patch(f.id, (cur) => {
    const s = new Set(cur[field]); if (s.has(code)) s.delete(code); else s.add(code); return { [field]: s }
  })
  const setCat = (code, value) => onCategory(f.id, code, value)
  const catSelect = (r) => (
    <select className="cc-select" aria-label={`Category for ${r.code}`} value={f.categories?.[r.code] || r.category} onChange={(e) => setCat(r.code, e.target.value)}>
      {MATERIAL_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
    </select>
  )
  const meta = f.parsed?.meta
  const blockers = f.parsed?.ok ? postBlockers(f.parsed) : []

  if (f.error) return <ErrorNote error={f.error} />
  if (f.stockError) {
    return (
      <div className="inv-hub" style={{ gap: 8 }}>
        <ErrorNote error={`The stock at this store could not be read: ${f.stockError}`} />
        <div className="inv-actions"><button type="button" className="cc-btn-ghost" onClick={() => patch(f.id, { stockError: null, location: undefined })}>Try again</button></div>
      </div>
    )
  }
  if (!f.parsed?.ok) return <Note tone="bad">This file is not an ERP Stores Ledger (report CSOL-IMS-013-1). Export the Stores Ledger from the ERP and upload that file.</Note>

  return (
    <div className="inv-hub" style={{ gap: 12 }}>
      <dl className="inv-dl">
        <dt>Report</dt><dd>{meta.reportId || 'N/A'}{meta.reportId && meta.reportId !== 'CSOL-IMS-013-1' ? ' (not the Stores Ledger report)' : ''}</dd>
        <dt>Balance as at</dt><dd>{meta.to || 'N/A'}</dd>
        <dt>Currency</dt><dd>{meta.currency || 'N/A'}</dd>
        <dt>Store</dt><dd>{f.location ? `${f.location.code} (${f.location.site})` : `${meta.warehouses.join(', ')}: no matching location`}</dd>
      </dl>
      {blockers.length > 0 && <Note tone="bad" title="This file cannot be posted"><ul style={{ margin: 0, paddingInlineStart: 18 }}>{blockers.map((b) => <li key={b}>{b}</li>)}</ul></Note>}
      {f.parsed.rejected.length > 0 && (
        <KitTable compact rows={f.parsed.rejected.map((r, i) => ({ ...r, i }))} empty="" columns={[
          { key: 'row', header: 'Row', numeric: true },
          { key: 'code', header: 'Item', cell: (r) => r.code || <span className="cc-na">N/A</span> },
          { key: 'reason', header: 'Problem', cell: (r) => ({ bad_qty: 'Quantity is not a number', no_code: 'No item code', no_warehouse: 'No store on the row' }[r.reason] || r.reason) },
        ]} />
      )}
      {f.previous?.status === 'posted' && <Note tone="warn">This exact file was already posted on {fmtDateTime(f.previous.posted_at)}. It cannot be posted again.</Note>}
      {f.previous?.status === 'open' && (
        <Note tone="warn" title="This upload stopped part way">
          It started on {fmtDateTime(f.previous.created_at)}. Continue it to post the rest; every part is safe to run again.
          {isOwner && (
            <div className="inv-actions" style={{ marginTop: 8 }}>
              <button type="button" className="cc-btn-primary" disabled={busy} onClick={onResume}><Send size={14} aria-hidden="true" /> {busy ? 'Posting...' : 'Continue'}</button>
              <button type="button" className="cc-btn-ghost" disabled={busy} onClick={onCancelOpen}>Cancel upload</button>
              <span className="cc-card-sub">Cancelling keeps the new item codes, names and categories already saved; only unposted stock is dropped.</span>
            </div>
          )}
        </Note>
      )}
      {f.progress && <p className="cc-card-sub" role="status">{f.progress}</p>}
      {err && !canPost && <ErrorNote error={err} />}
      {f.location === null && <Note tone="warn">No Tyre Pulse warehouse location has the code {meta.warehouses.join(', ')}. Add the location, or ask for the spelling to be linked, then upload again.</Note>}
      {f.posted && <Note tone="good" icon={CheckCircle2}>Posted: {f.posted.quantities_changed} quantities changed, {f.posted.set_to_zero || 0} set to zero, {f.posted.items_added} items added, {f.posted.names_updated} names updated, {f.posted.categories_set} categories set, {f.posted.held_back?.length || 0} held back{heldSummary(f.posted.held_back)}.</Note>}

      {p && (
        <>
          <div className="inv-kpis">
            <Kpi icon={ArrowUpDown} tone="t-blue" value={p.changes.length} label="Quantities to change" />
            <Kpi icon={PackagePlus} tone="t-green" value={p.newItems.length} label="New item codes" />
            <Kpi icon={Tags} tone="t-amber" value={p.renames.length + p.reclassify.length} label="Names and categories" />
            <Kpi icon={AlertTriangle} tone="t-red" value={p.held.length} label="Held back" />
          </div>
          <Tabs label="Changes" value={tab} onChange={setTab} tabs={[
            { key: 'stock', label: `Quantities (${p.changes.length})` },
            { key: 'new', label: `New items (${p.newItems.length})` },
            { key: 'names', label: `Names (${p.renames.length})` },
            { key: 'cats', label: `Categories (${p.reclassify.length})` },
            { key: 'held', label: `Held back (${p.held.length})` },
            { key: 'missing', label: `Not in file (${p.missing.length})` },
          ]} />
          {tab === 'stock' && (
            <KitTable compact scroll rows={p.changes} empty="Every quantity already matches the ERP." columns={[
              { key: 'code', header: 'Item', cell: (r) => <span className="inv-mono">{r.code}</span> },
              { key: 'description', header: 'Description' },
              { key: 'on_hand', header: 'Tyre Pulse', numeric: true, cell: (r) => (r.on_hand === null ? <span className="cc-na">none</span> : formatQty(r.on_hand)) },
              { key: 'erp_qty', header: 'ERP', numeric: true, cell: (r) => formatQty(r.erp_qty) },
              { key: 'delta', header: 'Change', numeric: true, cell: (r) => signed(r.delta) },
              { key: 'rate', header: 'ERP rate', numeric: true, cell: (r) => (r.rate === null ? <span className="cc-na">unvalued</span> : formatMoney(r.rate, meta.currency)) },
            ]} />
          )}
          {tab === 'new' && (
            <KitTable compact scroll rows={p.newItems} empty="Every code is already in the Material Master." columns={[
              { key: 'code', header: 'Item', cell: (r) => <span className="inv-mono">{r.code}</span> },
              { key: 'item_name', header: 'Name' },
              { key: 'category', header: 'Category', sortable: false, cell: catSelect },
              { key: 'subcategory', header: 'Group', cell: (r) => r.subcategory || <span className="cc-na">N/A</span> },
              { key: 'reason', header: 'Why', cell: (r) => reasonLabel(r.reason) },
            ]} />
          )}
          {tab === 'names' && (
            <KitTable compact scroll rows={p.renames} empty="Every name already matches the ERP wording." columns={[
              { key: 'use', header: 'Use', sortable: false, cell: (r) => <input type="checkbox" aria-label={`Use the ERP name for ${r.code}`} checked={!f.skipRenames.has(r.code)} onChange={() => toggle('skipRenames', r.code)} /> },
              { key: 'code', header: 'Item', cell: (r) => <span className="inv-mono">{r.code}</span> },
              { key: 'from', header: 'Tyre Pulse name', cell: (r) => r.from || <span className="cc-na">none</span> },
              { key: 'to', header: 'ERP name' },
            ]} />
          )}
          {tab === 'cats' && (
            <KitTable compact scroll rows={p.reclassify} empty="No item in this file is unclassified." columns={[
              { key: 'use', header: 'Use', sortable: false, cell: (r) => <input type="checkbox" aria-label={`Set the category for ${r.code}`} checked={!f.skipReclass.has(r.code)} onChange={() => toggle('skipReclass', r.code)} /> },
              { key: 'code', header: 'Item', cell: (r) => <span className="inv-mono">{r.code}</span> },
              { key: 'name', header: 'Name' },
              { key: 'category', header: 'Category', sortable: false, cell: catSelect },
              { key: 'subcategory', header: 'Group', cell: (r) => r.subcategory || <span className="cc-na">N/A</span> },
              { key: 'reason', header: 'Why', cell: (r) => reasonLabel(r.reason) },
            ]} />
          )}
          {tab === 'held' && (
            <KitTable compact scroll rows={p.held} empty="Nothing held back." columns={[
              { key: 'code', header: 'Item', cell: (r) => <span className="inv-mono">{r.code}</span> },
              { key: 'description', header: 'Description' },
              { key: 'qty', header: 'ERP', numeric: true, cell: (r) => formatQty(r.qty) },
              { key: 'reason', header: 'Why', cell: (r) => REASON_TEXT[r.reason] || r.reason },
            ]} />
          )}
          {tab === 'missing' && (
            <>
              <label className="inv-check">
                <input type="checkbox" checked={f.zeroMissing} onChange={() => patch(f.id, (cur) => ({ zeroMissing: !cur.zeroMissing }))} />
                <span>Set these to zero when posting (the ERP shows no stock for them at this store)</span>
              </label>
              <KitTable compact scroll rows={p.missing} empty="Tyre Pulse holds nothing here that the file leaves out." columns={[
                { key: 'code', header: 'Item', cell: (r) => <span className="inv-mono">{r.code || 'N/A'}</span> },
                { key: 'description', header: 'Description' },
                { key: 'on_hand', header: 'Tyre Pulse', numeric: true, cell: (r) => formatQty(r.on_hand) },
                { key: 'keep', header: 'If set to zero', cell: (r) => (r.keep === 'reserved' ? 'Kept: reserved for a job card' : r.keep === 'serial_tracked' ? 'Kept: tyre, needs serials' : 'Set to 0') },
              ]} />
            </>
          )}
          {f.stockTruncated && <Note tone="warn">This store has more stock lines than the screen reads at once; the server still uses every line.</Note>}
          {canPost && (
            <div className="inv-actions">
              <button type="button" className="cc-btn-primary" onClick={onPost}><FileSpreadsheet size={14} aria-hidden="true" /> Review and post</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
