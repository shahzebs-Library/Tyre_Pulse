/**
 * Unmatched stock items: stock lines that are not linked to a Material Master
 * item. For each line the screen PROPOSES a match:
 *   - a line carrying an item code: the exact code in the same country;
 *   - a line with no code: catalogue items of the same tyre size, ranked by
 *     brand. These are suggestions only and are never applied automatically.
 *
 * Linking is two-person (migration 20261124132000, inv_material_link_propose /
 * inv_material_link_decide): one person proposes the item for the line, a
 * SECOND person approves. The database refuses the proposer, a different
 * country, a line that changed since, and stamps who approved. A suggestion
 * needs a note in the proposer's own words. Until the migration is applied the
 * buttons report "not set up" and the proposals can still be exported.
 */
import { useMemo, useState } from 'react'
import { Link2, Link2Off, Search, FlaskConical, Download, RefreshCw, CheckCircle2, Send, Check, X, Undo2 } from 'lucide-react'
import { KitTable, Kpi } from '../commandCenter/kit'
import { loadUnmatchedReview } from '../../lib/api/stockReconcile'
import { UNMATCHED_KINDS, unmatchedExportRows } from '../../lib/inventory/stockReconcile'
import { formatQty } from '../../lib/inventory/inventoryMoney'
import { useInvQuery, ErrorNote, NotSetUp, Note, StatusPill, SectionCard, alignNumeric, fmtDateTime } from './InvUi'
import { proposeStockLink, decideLink, loadStockLinkProposals } from '../../lib/api/materialLinks'
import { newIdempotencyKey } from '../../lib/api/inventory'
import { toUserMessage } from '../../lib/inventory/errorText'

const KIND_TONE = { code_exact: 'good', code_ambiguous: 'warning', code_missing: 'bad', no_code_suggest: 'info', no_code_none: 'muted' }
const SOURCE_LABEL = { material_master: 'ERP item (Material Master)', material_canonical: 'Catalogue item' }
const FILTERS = [
  { key: 'real', label: 'Real stock' },
  { key: 'code', label: 'Has a code' },
  { key: 'nocode', label: 'No code' },
  { key: 'demo', label: 'Demo data' },
  { key: 'all', label: 'All' },
]

function Candidates({ row, canPropose, canDecide, userId, proposals, onDone }) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [note, setNote] = useState('')
  const [rejectNote, setRejectNote] = useState('')
  const list = row.candidates || []
  const exact = row.kind === 'code_exact'
  const open = (proposals || []).find((p) => p.status === 'proposed') || null
  const last = (proposals || []).find((p) => p.status !== 'proposed') || null

  const act = async (key, fn) => {
    setBusy(key); setError(null)
    try { await fn(newIdempotencyKey()); setNote(''); setRejectNote(''); onDone() } catch (err) { setError(toUserMessage(err)) } finally { setBusy(null) }
  }

  if (open) {
    const own = userId && open.proposed_by === userId
    const item = list.find((c) => (c.item_id || c.id) === open.item_id)
    return (
      <div>
        <Note tone="warn" title="A link is awaiting approval">
          {`Proposed item: ${item ? `${item.code || item.item_code} ${item.name || item.item_name || ''}` : open.item_id}. Basis: ${open.basis === 'exact_code' ? 'same item code' : 'confirmed suggestion'}.`}
          {open.note ? ` Note: ${open.note}` : ''}
        </Note>
        {error && <ErrorNote error={error} />}
        <div className="inv-actions">
          {own ? (
            <>
              <span className="cc-card-sub">Another person must approve it.</span>
              <button type="button" className="cc-btn-ghost" disabled={!!busy}
                onClick={() => act('w', (k) => decideLink({ id: open.id, decision: 'withdraw' }, k))}>
                <Undo2 size={13} aria-hidden="true" /> Withdraw
              </button>
            </>
          ) : canDecide ? (
            <>
              <button type="button" className="inv-btn-accent" disabled={!!busy}
                onClick={() => act('a', (k) => decideLink({ id: open.id, decision: 'approve' }, k))}>
                <Check size={13} aria-hidden="true" /> Approve link
              </button>
              <input className="inv-input" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="Reason to reject" aria-label="Reason to reject" />
              <button type="button" className="inv-btn-outline" disabled={!!busy || !rejectNote.trim()}
                onClick={() => act('r', (k) => decideLink({ id: open.id, decision: 'reject', note: rejectNote }, k))}>
                <X size={13} aria-hidden="true" /> Reject
              </button>
            </>
          ) : <span className="cc-card-sub">Needs an approver with the master-data right.</span>}
        </div>
      </div>
    )
  }

  if (!list.length) {
    return (
      <Note tone="warn">
        {row.code
          ? `Code ${row.code} is not in Material Master for ${row.country || 'this country'}. Add the item to Material Master first, or correct the code on the stock line.`
          : 'No tyre size could be read from this description, so no catalogue item can be suggested. A person must identify the item.'}
      </Note>
    )
  }
  return (
    <div className="inv-scroll">
      {last && <Note tone={last.status === 'rejected' ? 'warn' : 'info'}>{`The last proposal was ${last.status}${last.decision_note ? `: ${last.decision_note}` : '.'}`}</Note>}
      {error && <ErrorNote error={error} />}
      {!exact && canPropose && (
        <label className="cc-field" style={{ maxWidth: 420 }}>
          <span>Why is this the right item? (needed for a suggestion)</span>
          <input className="inv-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: brand and size checked on the shelf" />
        </label>
      )}
      <KitTable compact rows={list} columns={alignNumeric([
        { key: 'code', header: 'Code', cell: (c) => c.code || c.item_code || <span className="cc-na">N/A</span> },
        { key: 'name', header: 'Name', cell: (c) => c.name || c.item_name || <span className="cc-na">N/A</span> },
        { key: 'source', header: 'Source', cell: (c) => SOURCE_LABEL[c.source] || c.source },
        { key: 'linked', header: 'In catalogue', cell: (c) => (c.linked === true
          ? <StatusPill value="yes" tone="good" label="Linked" />
          : c.linked === false ? <StatusPill value="no" tone="warning" label="Not linked" /> : <span className="cc-na">N/A</span>) },
        { key: 'reasons', header: exact ? 'Basis' : 'Why suggested', cell: (c) => (c.reasons || []).join('. ') },
        { key: 'confirm', header: '', cell: (c) => {
          if (c.source === 'material_canonical') {
            return <span className="cc-card-sub">Catalogue only. Link it to an ERP item first.</span>
          }
          const key = c.id || c.item_id
          return (
            <button type="button" className="inv-btn-outline" disabled={!canPropose || !!busy || (!exact && !note.trim())}
              title={!canPropose ? 'You do not have permission to propose links.' : (!exact && !note.trim()) ? 'Write why this item is right first.' : undefined}
              onClick={() => act(key, (k) => proposeStockLink(row, c, note, k))}>
              <Send size={13} aria-hidden="true" /> Propose link
            </button>
          )
        } },
      ])} />
      <p className="cc-muted" style={{ margin: '6px 0 0' }}>
        {exact
          ? 'The server checks the code again. A second person approves before the line is linked.'
          : 'Suggestions only. They are ranked by tyre size and brand and are never applied automatically. A second person approves.'}
      </p>
    </div>
  )
}

export default function UnmatchedItemsPanel({ scope, can, userId }) {
  const q = useInvQuery(() => loadUnmatchedReview(scope), [scope?.country, scope?.site])
  const ids = (q.data?.rows || []).map((r) => r.id).join(',')
  const pq = useInvQuery(() => (ids ? loadStockLinkProposals(ids.split(',')) : Promise.resolve([])), [ids])
  const [filter, setFilter] = useState('real')
  const [openId, setOpenId] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [exportErr, setExportErr] = useState('')
  const canExport = typeof can === 'function' ? can('export') : false
  // Linking an item is a master-data decision: the same right that approves
  // engineering / adjustment changes (mirrors _inv_pi_can_master server-side).
  const canDecide = typeof can === 'function' ? (can('engineering_approve') || can('adjustment_approve') || can('discrepancy_review')) : false
  // Proposing is open to stock users; the server decides (procure / engineering / elevated).
  const canPropose = typeof can === 'function' ? (can('view') || canDecide) : false

  const rows = useMemo(() => {
    const all = q.data?.rows || []
    if (filter === 'real') return all.filter((r) => !r.demo)
    if (filter === 'demo') return all.filter((r) => r.demo)
    if (filter === 'code') return all.filter((r) => r.code)
    if (filter === 'nocode') return all.filter((r) => !r.code)
    return all
  }, [q.data, filter])

  if (q.error) return <ErrorNote error={q.error} onRetry={q.retry} />
  if (q.data?.status === 'not_provisioned') return <NotSetUp what="stock lines" />

  const s = q.data?.summary
  const loading = q.loading && !q.data

  const doExport = async () => {
    setExporting(true); setExportErr('')
    try {
      const { exportToExcel, reportFileName } = await import('../../lib/exportUtils')
      const data = unmatchedExportRows(rows)
      const keys = ['stock_id', 'country', 'site', 'description', 'code', 'size', 'qty_on_hand', 'data', 'finding', 'proposed_code', 'proposed_name', 'proposed_source', 'basis', 'status']
      const headers = ['Stock line', 'Country', 'Site', 'Description', 'Code on line', 'Tyre size', 'On hand', 'Data', 'Finding', 'Proposed code', 'Proposed item', 'Source', 'Basis', 'Status']
      await exportToExcel(data, keys, headers, reportFileName('Unmatched stock items', scope?.country || 'All countries'), 'Unmatched')
    } catch {
      setExportErr('The file could not be created. Try again.')
    } finally { setExporting(false) }
  }

  const columns = [
    { key: 'site', header: 'Site', cell: (r) => r.site || <span className="cc-na">N/A</span> },
    { key: 'description', header: 'Description', cell: (r) => (
      <span>{r.description || <span className="cc-na">N/A</span>}{r.demo && <> <StatusPill value="demo" tone="muted" label="Demo" /></>}</span>
    ) },
    { key: 'code', header: 'Code on line', cell: (r) => r.code || <span className="cc-na">None</span> },
    { key: 'size', header: 'Tyre size', cell: (r) => r.size || <span className="cc-na">N/A</span> },
    { key: 'qty_on_hand', header: 'On hand', numeric: true, cell: (r) => formatQty(r.qty_on_hand) },
    { key: 'kind', header: 'Finding', cell: (r) => <StatusPill value={r.kind} tone={KIND_TONE[r.kind]} label={UNMATCHED_KINDS[r.kind]} /> },
    { key: 'best', header: 'Proposed match', cell: (r) => {
      const b = r.candidates?.[0]
      if (!b) return <span className="cc-na">None</span>
      return <span>{b.code || b.item_code} {b.name || b.item_name ? `- ${b.name || b.item_name}` : ''}{r.candidates.length > 1 ? ` (+${r.candidates.length - 1})` : ''}</span>
    } },
  ]

  const open = rows.find((r) => r.id === openId) || null

  return (
    <div className="inv-hub">
      <Note>
        Stock lines that are not linked to a Material Master item cannot show catalogue details, consumption or cost.
        Lines with a code are matched exactly. Lines without a code get suggestions by tyre size and brand that a
        person must confirm; nothing is linked automatically.
      </Note>
      <Note title="Two people link a line">
        One person proposes the item for a stock line; a second person approves it. Nothing is linked automatically.
        Demo lines are test data and should not be linked.
      </Note>
      {q.data?.truncated && <Note tone="warn">Not every line was read. Narrow the country or site to see the rest.</Note>}
      <div className="inv-kpis">
        <Kpi icon={Link2Off} tone="t-amber" loading={loading} value={s?.real} label="Real lines not linked" />
        <Kpi icon={CheckCircle2} tone="t-green" loading={loading} value={s?.code_exact} label="Exact code match found" />
        <Kpi icon={Search} tone="t-blue" loading={loading} value={s?.no_code_suggest} label="Suggestions to review" />
        <Kpi icon={Link2} tone="t-red" loading={loading} value={s ? s.code_missing + s.code_ambiguous + s.no_code_none : null} label="Need a person to identify" />
        <Kpi icon={FlaskConical} tone="t-blue" loading={loading} value={s?.demo} label="Demo / test lines" />
      </div>
      <SectionCard
        title={`Unmatched stock lines (${formatQty(rows.length)})`}
        sub={q.data ? `Read ${fmtDateTime(q.data.generatedAt)}. Select a line to see every proposal.` : undefined}
        action={(
          <div className="inv-actions">
            <button type="button" className="cc-btn-ghost" onClick={q.retry} disabled={q.loading}>
              <RefreshCw size={14} aria-hidden="true" /> Refresh
            </button>
            {canExport && (
              <button type="button" className="cc-btn-ghost" onClick={doExport} disabled={exporting || !rows.length}>
                <Download size={14} aria-hidden="true" /> {exporting ? 'Preparing...' : 'Excel'}
              </button>
            )}
          </div>
        )}>
        {exportErr && <ErrorNote error={exportErr} />}
        <div className="inv-toolbar">
          <label className="cc-field" style={{ maxWidth: 220 }}>
            <span>Show</span>
            <select className="cc-select" value={filter} onChange={(e) => { setFilter(e.target.value); setOpenId(null) }}>
              {FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </label>
        </div>
        <div className="inv-scroll">
          <KitTable compact columns={alignNumeric(columns)} rows={rows} loading={loading}
            empty={filter === 'real' ? 'Every real stock line is linked to Material Master.' : 'No lines in this view.'}
            onRowClick={(r) => setOpenId(r.id === openId ? null : r.id)} />
        </div>
      </SectionCard>
      {open && (
        <SectionCard title={`Proposals for ${open.description || 'this line'}`}
          sub={`${open.site || 'No site'}, ${open.country || 'no country'}. On hand ${formatQty(open.qty_on_hand)}.${open.brands?.length ? ` Brand read from the line: ${open.brands.join(', ')}.` : ''}`}>
          <Candidates key={open.id} row={open} canPropose={canPropose} canDecide={canDecide} userId={userId}
            proposals={(pq.data || []).filter((p) => p.stock_id === open.id)}
            onDone={() => { q.retry(); pq.retry() }} />
          {pq.error && <ErrorNote error={pq.error} onRetry={pq.retry} />}
          {!pq.loading && !pq.error && pq.data === null && <Note tone="warn">Linking is not set up yet in the database. The proposals can be reviewed and exported.</Note>}
        </SectionCard>
      )}
    </div>
  )
}
