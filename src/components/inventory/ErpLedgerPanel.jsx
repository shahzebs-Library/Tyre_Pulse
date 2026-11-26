/**
 * ERP stores ledger upload (Ramco report CSOL-IMS-013-1).
 *
 * The owner exports one Stores Ledger per warehouse from the ERP and drops the
 * files here as they are. For each file the panel shows, before anything is
 * saved: the store it belongs to, new item codes (with a suggested category the
 * owner can change), names that would take the ERP wording, items still
 * unclassified, and every stock quantity that would change. Posting is owner
 * only (enforced in the database by inv_erp_ledger_post) and needs no second
 * approval, by the owner's decision of 2026-11-26.
 *
 * Rates from the file are kept with the upload record and are not written as
 * stock cost. Negative ERP quantities are held back. The same file can never be
 * posted twice.
 */
import { useEffect, useMemo, useState } from 'react'
import { Upload, Send, FileSpreadsheet, PackagePlus, Tags, ArrowUpDown, AlertTriangle, CheckCircle2 } from 'lucide-react'
import Modal from '../ui/Modal'
import SideDrawer from '../ui/SideDrawer'
import { KitTable, Kpi, Tabs } from '../commandCenter/kit'
import { useAuth } from '../../contexts/AuthContext'
import {
  listLocations, loadMasterForLedger, loadStockAtLocation, listErpLedgerUploads, findErpLedgerUpload, postErpLedger, newIdempotencyKey,
} from '../../lib/api/inventory'
import {
  parseStoreLedger, resolveLocation, buildLedgerPlan, buildNeighbours, buildPostPayload, sha256Hex,
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
}
const reasonLabel = (r) => {
  const [kind, note] = String(r || '').split(':')
  if (kind === 'code_range') return `ERP code range (${note || ''})`
  if (kind === 'description') return `Description says ${note}`
  if (kind === 'neighbours') return `Most reviewed items starting ${note} are this`
  return 'No clear signal; spare part'
}
const signed = (n) => (n > 0 ? `+${formatQty(n)}` : formatQty(n))

function fileStatus(f) {
  if (f.reading) return { tone: 'info', label: 'Reading' }
  if (f.error) return { tone: 'bad', label: 'Could not read' }
  if (!f.parsed?.ok) return { tone: 'bad', label: 'Not a stores ledger' }
  if (f.posted) return { tone: 'good', label: 'Posted' }
  if (f.previous) return { tone: 'muted', label: 'Already posted' }
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
  const history = useInvQuery(() => listErpLedgerUploads({ page, pageSize, country }), [page, pageSize, country])

  // Locations and the Material Master for the chosen country, read once per country.
  useEffect(() => {
    let live = true
    setRef((r) => ({ ...r, status: 'loading' }))
    Promise.all([listLocations({ country }), loadMasterForLedger(country)])
      .then(([loc, mm]) => {
        if (!live) return
        setRef({ status: 'ok', locations: loc.rows || [], master: mm.rows, neighbours: buildNeighbours(mm.rows), truncated: mm.truncated || loc.truncated })
      })
      .catch((e) => { if (live) setRef((r) => ({ ...r, status: 'error', error: toUserMessage(e) })) })
    return () => { live = false }
  }, [country])

  const patch = (id, change) => setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, ...(typeof change === 'function' ? change(f) : change) } : f)))

  // Compare each readable file with live stock at its store.
  useEffect(() => {
    if (ref.status !== 'ok') return
    files.forEach((f) => {
      if (!f.parsed?.ok || f.plan || f.loading || f.posted || f.location === null || f.error) return
      const location = f.location === undefined ? resolveLocation(f.parsed.meta.warehouses[0], ref.locations) : f.location
      if (!location) { patch(f.id, { location: null }); return }
      patch(f.id, { location, loading: true })
      loadStockAtLocation(location.id)
        .then((st) => {
          const plan = buildLedgerPlan({ lines: f.parsed.lines, master: ref.master, stock: st.rows, neighbours: ref.neighbours })
          patch(f.id, {
            loading: false, plan, stockTruncated: st.truncated,
            categories: Object.fromEntries([...plan.newItems, ...plan.reclassify].map((x) => [x.code, x.category])),
            skipRenames: new Set(), skipReclass: new Set(), zeroMissing: false,
          })
        })
        .catch((e) => patch(f.id, { loading: false, error: toUserMessage(e) }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, ref.status])

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
      const res = await postErpLedger(payload, f.key)
      patch(f.id, { posted: res })
      setConfirm(null)
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
  const canPost = (f) => Boolean(isSuperAdmin && f?.plan && !f.previous && !f.posted && f.location && !f.loading && !isDuplicate(f))

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
          <label className="cc-btn-primary" style={{ cursor: ref.status === 'ok' ? 'pointer' : 'wait', position: 'relative' }} aria-disabled={ref.status !== 'ok'}>
            <Upload size={14} aria-hidden="true" /> Upload ledger files
            <input type="file" multiple accept=".xls,.xlsx,.csv" disabled={ref.status !== 'ok'}
              style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
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
            onRowClick={(f) => { if (f.plan || f.error || !f.parsed?.ok) { setOpen(f.id); setTab('stock') } }} />
          {rows.some((f) => f.duplicateOf) && <Note tone="warn">Some files have the same content as another file in this list ({rows.filter((f) => f.duplicateOf).map((f) => f.filename).join(', ')}). Only the first of each can be posted.</Note>}
        </SectionCard>
      )}

      <SectionCard title="Earlier uploads">
        <PagedTable query={history} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(0) }}
          empty="No ERP stores ledger has been posted yet." what="ERP stores ledger uploads" noun="uploads"
          columns={[
            { key: 'posted_at', header: 'Posted', cell: (u) => fmtDateTime(u.posted_at) },
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
        {cur && <FileDetail f={cur} tab={tab} setTab={setTab} patch={patch} canPost={canPost(cur)} onPost={() => setConfirm(cur.id)} />}
      </SideDrawer>

      <Modal className="cc inv-panel" open={!!confirm} onClose={() => !busy && setConfirm(null)} size="md" title="Post this ledger?"
        footer={(
          <div className="inv-actions">
            <button type="button" className="cc-btn-ghost" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
            <button type="button" className="cc-btn-primary" disabled={busy} onClick={() => post(files.find((f) => f.id === confirm))}>
              <Send size={14} aria-hidden="true" /> {busy ? 'Posting...' : 'Post'}
            </button>
          </div>
        )}>
        {confirm && (() => {
          const f = files.find((x) => x.id === confirm)
          const p = f.plan
          return (
            <div className="inv-hub" style={{ gap: 8 }}>
              <p>Store {f.location.code} ({f.location.site}), balance as at {f.parsed.meta.to || 'N/A'}.</p>
              <ul style={{ margin: 0, paddingInlineStart: 18, display: 'grid', gap: 4 }}>
                <li>{p.changes.length} quantities set to the ERP figure ({signed(p.totals.increase)} / {signed(p.totals.decrease)})</li>
                <li>{p.newItems.length} new item codes added to the Material Master</li>
                <li>{p.renames.length - f.skipRenames.size} item names changed to the ERP wording</li>
                <li>{p.reclassify.length - f.skipReclass.size} unclassified items given a category</li>
                <li>{p.held.length} lines held back</li>
                <li>{f.zeroMissing ? `${p.missing.length} items not in the file set to zero` : `${p.missing.length} items not in the file left as they are`}</li>
              </ul>
              <Note>Each change is logged with this file. A quantity change can be reversed from the stock movement history.</Note>
              {err && <ErrorNote error={err} />}
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}

function FileDetail({ f, tab, setTab, patch, canPost, onPost }) {
  const p = f.plan
  const toggle = (field, code) => patch(f.id, (cur) => {
    const s = new Set(cur[field]); if (s.has(code)) s.delete(code); else s.add(code); return { [field]: s }
  })
  const setCat = (code, value) => patch(f.id, (cur) => ({ categories: { ...cur.categories, [code]: value } }))
  const catSelect = (r) => (
    <select className="cc-select" aria-label={`Category for ${r.code}`} value={f.categories?.[r.code] || r.category} onChange={(e) => setCat(r.code, e.target.value)}>
      {MATERIAL_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
    </select>
  )
  const meta = f.parsed?.meta

  if (f.error) return <ErrorNote error={f.error} />
  if (!f.parsed?.ok) return <Note tone="bad">This file is not an ERP Stores Ledger (report CSOL-IMS-013-1). Export the Stores Ledger from the ERP and upload that file.</Note>

  return (
    <div className="inv-hub" style={{ gap: 12 }}>
      <dl className="inv-dl">
        <dt>Report</dt><dd>{meta.reportId || 'N/A'}{meta.reportId && meta.reportId !== 'CSOL-IMS-013-1' ? ' (not the Stores Ledger report)' : ''}</dd>
        <dt>Balance as at</dt><dd>{meta.to || 'N/A'}</dd>
        <dt>Currency</dt><dd>{meta.currency || 'N/A'}</dd>
        <dt>Store</dt><dd>{f.location ? `${f.location.code} (${f.location.site})` : `${meta.warehouses.join(', ')}: no matching location`}</dd>
      </dl>
      {f.previous && <Note tone="warn">This exact file was already posted on {fmtDateTime(f.previous.posted_at)}. It cannot be posted again.</Note>}
      {!f.location && <Note tone="warn">No Tyre Pulse store location has the code {meta.warehouses.join(', ')}. Add the location, or ask for the spelling to be linked, then upload again.</Note>}
      {f.parsed.rejected.length > 0 && <Note tone="warn">{f.parsed.rejected.length} rows could not be read and are left out.</Note>}
      {f.posted && <Note tone="good" icon={CheckCircle2}>Posted: {f.posted.quantities_changed} quantities changed, {f.posted.items_added} items added, {f.posted.names_updated} names updated, {f.posted.categories_set} categories set, {f.posted.held_back?.length || 0} held back.</Note>}

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
