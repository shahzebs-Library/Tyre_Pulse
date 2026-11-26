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
import { useLanguage } from '../../contexts/LanguageContext'

const COUNTRIES = ['KSA', 'UAE', 'Egypt']
const HELD_REASONS = ['negative_qty', 'below_reserved', 'no_item', 'serial_tracked', 'missing_but_reserved']
const REJECT_REASONS = ['bad_qty', 'no_code', 'no_warehouse']
const useErpText = () => {
  const { t } = useLanguage()
  const p = (k, v) => t(`wmsfloor.erp.${k}`, v)
  return {
    p,
    NA: t('wmsfloor.common.na'),
    reasonText: (r) => (HELD_REASONS.includes(r) ? t(`wmsfloor.erp.held.${r}`) : r),
    rejectText: (r) => (REJECT_REASONS.includes(r) ? t(`wmsfloor.erp.reject.${r}`) : r),
    reasonLabel: (r) => {
      const [kind, note] = String(r || '').split(':')
      if (kind === 'code_range') return p('whyCodeRange', { note: note || '' })
      if (kind === 'description') return p('whyDescription', { note })
      if (kind === 'neighbours') return p('whyNeighbours', { note })
      return p('whyNone')
    },
    heldSummary: (held = []) => {
      const by = {}
      held.forEach((h) => { by[h.reason] = (by[h.reason] || 0) + 1 })
      const parts = Object.entries(by).map(([r, n]) => `${n} ${HELD_REASONS.includes(r) ? t(`wmsfloor.erp.heldShort.${r}`) : r}`)
      return parts.length ? ` (${parts.join(', ')})` : ''
    },
  }
}
const signed = (n) => (n > 0 ? `+${formatQty(n)}` : formatQty(n))

// Returns a status key; the label is translated at render (wmsfloor.erp.status.<key>).
function fileStatus(f) {
  if (f.reading) return { tone: 'info', key: 'reading' }
  if (f.error) return { tone: 'bad', key: 'readError' }
  if (f.stockError) return { tone: 'bad', key: 'stockError' }
  if (!f.parsed?.ok) return { tone: 'bad', key: 'notLedger' }
  if (f.posted) return { tone: 'good', key: 'posted' }
  if (f.previous?.status === 'open') return { tone: 'warning', key: 'notFinished' }
  if (f.previous) return { tone: 'muted', key: 'alreadyPosted' }
  if (postBlockers(f.parsed).length) return { tone: 'bad', key: 'cannotPost' }
  if (f.location === null) return { tone: 'warning', key: 'storeNotFound' }
  if (f.loading || !f.plan) return { tone: 'info', key: 'checking' }
  return { tone: 'info', key: 'ready' }
}

export default function ErpLedgerPanel({ scope }) {
  const { p, NA } = useErpText()
  const statusLabel = (k) => p(`status.${k}`)
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
        patch(id, { reading: false, error: toUserMessage(e, p('readFailed')) })
      }
    }
  }

  const runUpload = async (f, uploadId) => {
    patch(f.id, { progress: p('postingStock') })
    const res = await runErpLedger(uploadId, {
      onProgress: ({ phase, remaining }) => patch(f.id, { progress: phase === 'stock' ? p('postingLeft', { n: remaining }) : p('finishingLeft', { n: remaining }) }),
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
    { key: 'filename', header: p('colFile'), cell: (f) => <span className="inv-mono" dir="ltr">{f.filename}</span> },
    { key: 'warehouse', header: p('colErpStore'), cell: (f) => f.parsed?.meta?.warehouses?.join(', ') || <span className="cc-na">{NA}</span> },
    { key: 'location', header: p('colLocation'), cell: (f) => (f.location ? `${f.location.code} (${f.location.site})${f.location.via === 'alias' ? ' *' : ''}` : <span className="cc-na">{NA}</span>) },
    { key: 'lines', header: p('colLines'), numeric: true, cell: (f) => formatQty(f.parsed?.lines?.length) },
    { key: 'new', header: p('colNewItems'), numeric: true, cell: (f) => formatQty(f.plan?.newItems?.length) },
    { key: 'qty', header: p('colQtyChanges'), numeric: true, cell: (f) => formatQty(f.plan?.changes?.length) },
    { key: 'held', header: p('colHeld'), numeric: true, cell: (f) => formatQty(f.plan?.held?.length) },
    { key: 'status', header: p('colStatus'), cell: (f) => <StatusPill value={f.status.key} tone={f.status.tone} label={statusLabel(f.status.key)} /> },
  ]

  const cur = open ? files.find((f) => f.id === open) : null
  const isDuplicate = (f) => rows.find((r) => r.id === f?.id)?.duplicateOf
  const canPost = (f) => Boolean(isSuperAdmin && f?.plan && !f.previous && !f.posted && f.location && !f.loading && !isDuplicate(f) && !postBlockers(f.parsed).length)

  return (
    <div className="inv-hub">
      <Note>
        {p('intro')}
      </Note>
      {!isSuperAdmin && <Note tone="warn">{p('ownerOnly')}</Note>}

      {isSuperAdmin && (
        <div className="inv-actions" style={{ alignItems: 'flex-end' }}>
          <label className="cc-field" style={{ maxWidth: 160 }}>
            <span>{p('country')}</span>
            <select className="cc-select" value={country} disabled={files.length > 0} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="cc-btn-primary focus-within:ring-2 focus-within:ring-offset-2" style={{ cursor: ref.status === 'ok' ? 'pointer' : 'wait', position: 'relative', opacity: ref.status === 'ok' ? 1 : 0.6 }}>
            <Upload size={14} aria-hidden="true" /> {p('upload')}
            <input type="file" multiple accept=".xls,.xlsx,.csv" disabled={ref.status !== 'ok'} className="sr-only"
              aria-label={p('uploadAria')}
              onChange={(e) => { const l = [...(e.target.files || [])]; e.target.value = ''; if (l.length) readFiles(l) }} />
          </label>
          {files.length > 0 && <button type="button" className="cc-btn-ghost" disabled={busy} onClick={() => setFiles([])}>{p('clearList')}</button>}
        </div>
      )}
      {ref.status === 'loading' && isSuperAdmin && <p className="cc-card-sub">{p('loadingRef', { country })}</p>}
      {ref.status === 'error' && <ErrorNote error={ref.error} />}
      {ref.truncated && <Note tone="warn">{p('refTruncated', { country })}</Note>}
      {err && !confirm && <ErrorNote error={err} />}

      {files.length > 0 && (
        <SectionCard title={p('filesTitle')} sub={p('filesSub')}>
          <KitTable compact scroll rows={rows} columns={columns} empty={p('noFiles')}
            onRowClick={(f) => { if (!f.reading && !f.loading) { setOpen(f.id); setTab('stock') } }} />
          {rows.some((f) => f.duplicateOf) && <Note tone="warn">{p('duplicates', { list: rows.filter((f) => f.duplicateOf).map((f) => f.filename).join(', ') })}</Note>}
        </SectionCard>
      )}

      <SectionCard title={p('historyTitle')}>
        <PagedTable query={history} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(0) }}
          empty={p('historyEmpty')} what={p('historyWhat')} noun={p('historyNoun')}
          columns={[
            { key: 'posted_at', header: p('colPosted'), cell: (u) => fmtDateTime(u.posted_at || u.created_at) },
            { key: 'status', header: p('colStatus'), cell: (u) => (u.status === 'open'
              ? (
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <StatusPill value="open" tone="warning" label={statusLabel('notFinished')} />
                  {isSuperAdmin && <button type="button" className="cc-btn-ghost" disabled={busy} onClick={(e) => { e.stopPropagation(); runFromHistory(u, 'continue') }}>{p('continue')}</button>}
                  {isSuperAdmin && <button type="button" className="cc-btn-ghost" disabled={busy} onClick={(e) => { e.stopPropagation(); setHistCancel(u) }}>{p('cancel')}</button>}
                </span>
              )
              : <StatusPill value={u.status} tone="good" label={statusLabel('posted')} />) },
            { key: 'filename', header: p('colFile'), cell: (u) => <span className="inv-mono" dir="ltr">{u.filename}</span> },
            { key: 'warehouse_code', header: p('colErpStore') },
            { key: 'site', header: p('colSite') },
            { key: 'period_to', header: p('colBalanceAt'), cell: (u) => u.period_to || <span className="cc-na">{NA}</span> },
            { key: 'changed', header: p('colQtyChanged'), numeric: true, cell: (u) => formatQty(u.summary?.quantities_changed) },
            { key: 'added', header: p('colItemsAdded'), numeric: true, cell: (u) => formatQty(u.summary?.items_added) },
            { key: 'held', header: p('colHeld'), numeric: true, cell: (u) => formatQty(u.summary?.held_back?.length) },
          ]} />
      </SectionCard>

      <SideDrawer className="cc inv-panel" open={!!cur} onClose={() => !busy && setOpen(null)} busy={busy} size="xl"
        title={cur ? cur.filename : ''} closeLabel={p('close')}>
        {cur && <FileDetail f={cur} tab={tab} setTab={setTab} patch={patch} onCategory={setCategory} canPost={canPost(cur)} onPost={() => setConfirm(cur.id)}
          isOwner={isSuperAdmin} busy={busy} onResume={() => resume(cur)} onCancelOpen={() => cancelOpen(cur)} err={err} />}
      </SideDrawer>

      <Modal className="cc inv-panel" open={!!confirm} onClose={() => !busy && setConfirm(null)} size="md" title={p('confirmTitle')}
        footer={(
          <div className="inv-actions">
            <button type="button" className="cc-btn-ghost" disabled={busy} onClick={() => setConfirm(null)}>{p('cancel')}</button>
            <button type="button" className="cc-btn-primary" disabled={busy || (files.find((f) => f.id === confirm)?.movesAfter !== 0 && !files.find((f) => f.id === confirm)?.ackMoves)}
              onClick={() => post(files.find((f) => f.id === confirm))}>
              <Send size={14} aria-hidden="true" /> {busy ? p('posting') : p('post')}
            </button>
          </div>
        )}>
        {confirm && (() => {
          const f = files.find((x) => x.id === confirm)
          const pl = f.plan
          const cats = (list) => list.filter((n) => (f.categories[n.code] || n.category) !== 'unclassified')
          return (
            <div className="inv-hub" style={{ gap: 8 }}>
              <p>{p('confirmStore', { code: f.location.code, site: f.location.site, to: f.parsed.meta.to || NA })}</p>
              <ul style={{ margin: 0, paddingInlineStart: 18, display: 'grid', gap: 4 }}>
                <li>{p('sumChanges', { n: pl.changes.length, up: signed(pl.totals.increase), down: signed(pl.totals.decrease) })}</li>
                <li>{p('sumNew', { n: pl.newItems.length })}</li>
                <li>{p('sumRenames', { n: pl.renames.length - f.skipRenames.size })}</li>
                <li>{p('sumCats', { n: cats(pl.reclassify).filter((n) => !f.skipReclass.has(n.code)).length })}</li>
                <li>{p('sumHeld', { n: pl.held.length })}</li>
                <li>{f.zeroMissing ? p('sumMissingZero', { n: pl.missing.length }) : p('sumMissingKeep', { n: pl.missing.length })}</li>
              </ul>
              {f.movesAfter !== 0 && (
                <label className="inv-check">
                  <input type="checkbox" checked={Boolean(f.ackMoves)} onChange={() => patch(f.id, (c) => ({ ackMoves: !c.ackMoves }))} />
                  <span>{f.movesAfter > 0
                    ? p('movesAfter', { n: f.movesAfter, to: f.parsed.meta.to })
                    : p('movesUnknown', { to: f.parsed.meta.to })}</span>
                </label>
              )}
              {f.progress && <p className="cc-card-sub" role="status">{f.progress}</p>}
              <Note>{p('confirmNote')}</Note>
              {err && <ErrorNote error={err} />}
            </div>
          )
        })()}
      </Modal>

      <Modal className="cc inv-panel" open={!!histCancel} onClose={() => !busy && setHistCancel(null)} size="sm" title={p('cancelTitle')}
        footer={(
          <div className="inv-actions">
            <button type="button" className="cc-btn-ghost" disabled={busy} onClick={() => setHistCancel(null)}>{p('keepIt')}</button>
            <button type="button" className="cc-btn-primary" disabled={busy} onClick={() => runFromHistory(histCancel, 'cancel')}>{busy ? p('cancelling') : p('cancelUpload')}</button>
          </div>
        )}>
        {histCancel && <p>{p('cancelBody', { file: histCancel.filename })}</p>}
        {err && histCancel && <ErrorNote error={err} />}
      </Modal>
    </div>
  )
}

function FileDetail({ f, tab, setTab, patch, onCategory, canPost, onPost, isOwner, busy, onResume, onCancelOpen, err }) {
  const { p, NA, reasonText, rejectText, reasonLabel, heldSummary } = useErpText()
  const pl = f.plan
  const toggle = (field, code) => patch(f.id, (cur) => {
    const s = new Set(cur[field]); if (s.has(code)) s.delete(code); else s.add(code); return { [field]: s }
  })
  const setCat = (code, value) => onCategory(f.id, code, value)
  const catSelect = (r) => (
    <select className="cc-select" aria-label={p('categoryAria', { code: r.code })} value={f.categories?.[r.code] || r.category} onChange={(e) => setCat(r.code, e.target.value)}>
      {MATERIAL_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
    </select>
  )
  const meta = f.parsed?.meta
  const blockers = f.parsed?.ok ? postBlockers(f.parsed) : []

  if (f.error) return <ErrorNote error={f.error} />
  if (f.stockError) {
    return (
      <div className="inv-hub" style={{ gap: 8 }}>
        <ErrorNote error={p('stockReadFailed', { error: f.stockError })} />
        <div className="inv-actions"><button type="button" className="cc-btn-ghost" onClick={() => patch(f.id, { stockError: null, location: undefined })}>{p('tryAgain')}</button></div>
      </div>
    )
  }
  if (!f.parsed?.ok) return <Note tone="bad">{p('notLedgerBody')}</Note>

  return (
    <div className="inv-hub" style={{ gap: 12 }}>
      <dl className="inv-dl">
        <dt>{p('dtReport')}</dt><dd dir="ltr">{meta.reportId || NA}{meta.reportId && meta.reportId !== 'CSOL-IMS-013-1' ? ` ${p('notLedgerReport')}` : ''}</dd>
        <dt>{p('colBalanceAt')}</dt><dd>{meta.to || NA}</dd>
        <dt>{p('dtCurrency')}</dt><dd>{meta.currency || NA}</dd>
        <dt>{p('dtStore')}</dt><dd>{f.location ? `${f.location.code} (${f.location.site})` : p('noMatchingLocation', { stores: meta.warehouses.join(', ') })}</dd>
      </dl>
      {blockers.length > 0 && <Note tone="bad" title={p('cannotPostTitle')}><ul style={{ margin: 0, paddingInlineStart: 18 }}>{blockers.map((b) => <li key={b}>{b}</li>)}</ul></Note>}
      {f.parsed.rejected.length > 0 && (
        <KitTable compact rows={f.parsed.rejected.map((r, i) => ({ ...r, i }))} empty="" columns={[
          { key: 'row', header: p('colRow'), numeric: true },
          { key: 'code', header: p('colItem'), cell: (r) => r.code || <span className="cc-na">{NA}</span> },
          { key: 'reason', header: p('colProblem'), cell: (r) => rejectText(r.reason) },
        ]} />
      )}
      {f.previous?.status === 'posted' && <Note tone="warn">{p('alreadyPostedBody', { at: fmtDateTime(f.previous.posted_at) })}</Note>}
      {f.previous?.status === 'open' && (
        <Note tone="warn" title={p('stoppedTitle')}>
          {p('stoppedBody', { at: fmtDateTime(f.previous.created_at) })}
          {isOwner && (
            <div className="inv-actions" style={{ marginTop: 8 }}>
              <button type="button" className="cc-btn-primary" disabled={busy} onClick={onResume}><Send size={14} aria-hidden="true" /> {busy ? p('posting') : p('continue')}</button>
              <button type="button" className="cc-btn-ghost" disabled={busy} onClick={onCancelOpen}>{p('cancelUpload')}</button>
              <span className="cc-card-sub">{p('cancelKeeps')}</span>
            </div>
          )}
        </Note>
      )}
      {f.progress && <p className="cc-card-sub" role="status">{f.progress}</p>}
      {err && !canPost && <ErrorNote error={err} />}
      {f.location === null && <Note tone="warn">{p('noLocationBody', { stores: meta.warehouses.join(', ') })}</Note>}
      {f.posted && <Note tone="good" icon={CheckCircle2}>{p('postedBody', { changed: f.posted.quantities_changed, zero: f.posted.set_to_zero || 0, added: f.posted.items_added, names: f.posted.names_updated, cats: f.posted.categories_set, held: f.posted.held_back?.length || 0, detail: heldSummary(f.posted.held_back) })}</Note>}

      {pl && (
        <>
          <div className="inv-kpis">
            <Kpi icon={ArrowUpDown} tone="t-blue" value={pl.changes.length} label={p('kpiChanges')} />
            <Kpi icon={PackagePlus} tone="t-green" value={pl.newItems.length} label={p('kpiNew')} />
            <Kpi icon={Tags} tone="t-amber" value={pl.renames.length + pl.reclassify.length} label={p('kpiNames')} />
            <Kpi icon={AlertTriangle} tone="t-red" value={pl.held.length} label={p('colHeld')} />
          </div>
          <Tabs label={p('tabsLabel')} value={tab} onChange={setTab} tabs={[
            { key: 'stock', label: p('tabStock', { n: pl.changes.length }) },
            { key: 'new', label: p('tabNew', { n: pl.newItems.length }) },
            { key: 'names', label: p('tabNames', { n: pl.renames.length }) },
            { key: 'cats', label: p('tabCats', { n: pl.reclassify.length }) },
            { key: 'held', label: p('tabHeld', { n: pl.held.length }) },
            { key: 'missing', label: p('tabMissing', { n: pl.missing.length }) },
          ]} />
          {tab === 'stock' && (
            <KitTable compact scroll rows={pl.changes} empty={p('emptyStock')} columns={[
              { key: 'code', header: p('colItem'), cell: (r) => <span className="inv-mono">{r.code}</span> },
              { key: 'description', header: p('colDescription') },
              { key: 'on_hand', header: p('colTyrePulse'), numeric: true, cell: (r) => (r.on_hand === null ? <span className="cc-na">{p('none')}</span> : formatQty(r.on_hand)) },
              { key: 'erp_qty', header: p('colErp'), numeric: true, cell: (r) => formatQty(r.erp_qty) },
              { key: 'delta', header: p('colChange'), numeric: true, cell: (r) => signed(r.delta) },
              { key: 'rate', header: p('colErpRate'), numeric: true, cell: (r) => (r.rate === null ? <span className="cc-na">{p('unvalued')}</span> : formatMoney(r.rate, meta.currency)) },
            ]} />
          )}
          {tab === 'new' && (
            <KitTable compact scroll rows={pl.newItems} empty={p('emptyNew')} columns={[
              { key: 'code', header: p('colItem'), cell: (r) => <span className="inv-mono">{r.code}</span> },
              { key: 'item_name', header: p('colName') },
              { key: 'category', header: p('colCategory'), sortable: false, cell: catSelect },
              { key: 'subcategory', header: p('colGroup'), cell: (r) => r.subcategory || <span className="cc-na">{NA}</span> },
              { key: 'reason', header: p('colWhy'), cell: (r) => reasonLabel(r.reason) },
            ]} />
          )}
          {tab === 'names' && (
            <KitTable compact scroll rows={pl.renames} empty={p('emptyNames')} columns={[
              { key: 'use', header: p('colUse'), sortable: false, cell: (r) => <input type="checkbox" aria-label={p('useNameAria', { code: r.code })} checked={!f.skipRenames.has(r.code)} onChange={() => toggle('skipRenames', r.code)} /> },
              { key: 'code', header: p('colItem'), cell: (r) => <span className="inv-mono">{r.code}</span> },
              { key: 'from', header: p('colTpName'), cell: (r) => r.from || <span className="cc-na">{p('none')}</span> },
              { key: 'to', header: p('colErpName') },
            ]} />
          )}
          {tab === 'cats' && (
            <KitTable compact scroll rows={pl.reclassify} empty={p('emptyCats')} columns={[
              { key: 'use', header: p('colUse'), sortable: false, cell: (r) => <input type="checkbox" aria-label={p('setCatAria', { code: r.code })} checked={!f.skipReclass.has(r.code)} onChange={() => toggle('skipReclass', r.code)} /> },
              { key: 'code', header: p('colItem'), cell: (r) => <span className="inv-mono">{r.code}</span> },
              { key: 'name', header: p('colName') },
              { key: 'category', header: p('colCategory'), sortable: false, cell: catSelect },
              { key: 'subcategory', header: p('colGroup'), cell: (r) => r.subcategory || <span className="cc-na">{NA}</span> },
              { key: 'reason', header: p('colWhy'), cell: (r) => reasonLabel(r.reason) },
            ]} />
          )}
          {tab === 'held' && (
            <KitTable compact scroll rows={pl.held} empty={p('emptyHeld')} columns={[
              { key: 'code', header: p('colItem'), cell: (r) => <span className="inv-mono">{r.code}</span> },
              { key: 'description', header: p('colDescription') },
              { key: 'qty', header: p('colErp'), numeric: true, cell: (r) => formatQty(r.qty) },
              { key: 'reason', header: p('colWhy'), cell: (r) => reasonText(r.reason) },
            ]} />
          )}
          {tab === 'missing' && (
            <>
              <label className="inv-check">
                <input type="checkbox" checked={f.zeroMissing} onChange={() => patch(f.id, (cur) => ({ zeroMissing: !cur.zeroMissing }))} />
                <span>{p('zeroMissing')}</span>
              </label>
              <KitTable compact scroll rows={pl.missing} empty={p('emptyMissing')} columns={[
                { key: 'code', header: p('colItem'), cell: (r) => <span className="inv-mono">{r.code || NA}</span> },
                { key: 'description', header: p('colDescription') },
                { key: 'on_hand', header: p('colTyrePulse'), numeric: true, cell: (r) => formatQty(r.on_hand) },
                { key: 'keep', header: p('colIfZero'), cell: (r) => (r.keep === 'reserved' ? p('keptReserved') : r.keep === 'serial_tracked' ? p('keptSerial') : p('setZero')) },
              ]} />
            </>
          )}
          {f.stockTruncated && <Note tone="warn">{p('stockTruncated')}</Note>}
          {canPost && (
            <div className="inv-actions">
              <button type="button" className="cc-btn-primary" onClick={onPost}><FileSpreadsheet size={14} aria-hidden="true" /> {p('review')}</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
