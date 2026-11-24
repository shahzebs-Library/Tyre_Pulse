/**
 * Unmatched stock items: stock lines that are not linked to a Material Master
 * item. For each line the screen PROPOSES a match:
 *   - a line carrying an item code: the exact code in the same country;
 *   - a line with no code: catalogue items of the same tyre size, ranked by
 *     brand. These are suggestions only and are never applied automatically.
 *
 * Confirming a link needs a server writer that sets the stock line's item and
 * records who confirmed it. None exists yet (stock lines cannot be written
 * directly), so the confirm step is shown as not yet available and the exact
 * database change is written up in docs/warehouse/07_UNMATCHED_LINK_DB_CHANGES.md.
 */
import { useMemo, useState } from 'react'
import { Link2, Link2Off, Search, FlaskConical, Download, RefreshCw, CheckCircle2, Lock } from 'lucide-react'
import { KitTable, Kpi } from '../commandCenter/kit'
import { loadUnmatchedReview } from '../../lib/api/stockReconcile'
import { UNMATCHED_KINDS, unmatchedExportRows } from '../../lib/inventory/stockReconcile'
import { formatQty } from '../../lib/inventory/inventoryMoney'
import { useInvQuery, ErrorNote, NotSetUp, Note, StatusPill, SectionCard, alignNumeric, fmtDateTime } from './InvUi'

const KIND_TONE = { code_exact: 'good', code_ambiguous: 'warning', code_missing: 'bad', no_code_suggest: 'info', no_code_none: 'muted' }
const SOURCE_LABEL = { material_master: 'ERP item (Material Master)', material_canonical: 'Catalogue item' }
const FILTERS = [
  { key: 'real', label: 'Real stock' },
  { key: 'code', label: 'Has a code' },
  { key: 'nocode', label: 'No code' },
  { key: 'demo', label: 'Demo data' },
  { key: 'all', label: 'All' },
]

function Candidates({ row, canLink }) {
  const list = row.candidates || []
  if (!list.length) {
    return (
      <Note tone="warn">
        {row.code
          ? `Code ${row.code} is not in Material Master for ${row.country || 'this country'}. Add the item to Material Master first, or correct the code on the stock line.`
          : 'No tyre size could be read from this description, so no catalogue item can be suggested. A person must identify the item.'}
      </Note>
    )
  }
  const exact = row.kind === 'code_exact'
  return (
    <div className="inv-scroll">
      <KitTable compact rows={list} columns={alignNumeric([
        { key: 'code', header: 'Code', cell: (c) => c.code || c.item_code || <span className="cc-na">N/A</span> },
        { key: 'name', header: 'Name', cell: (c) => c.name || c.item_name || <span className="cc-na">N/A</span> },
        { key: 'source', header: 'Source', cell: (c) => SOURCE_LABEL[c.source] || c.source },
        { key: 'linked', header: 'In catalogue', cell: (c) => (c.linked === true
          ? <StatusPill value="yes" tone="good" label="Linked" />
          : c.linked === false ? <StatusPill value="no" tone="warning" label="Not linked" /> : <span className="cc-na">N/A</span>) },
        { key: 'reasons', header: exact ? 'Basis' : 'Why suggested', cell: (c) => (c.reasons || []).join('. ') },
        { key: 'confirm', header: '', cell: () => (
          <button type="button" className="cc-btn-ghost" disabled
            title={canLink
              ? 'Linking needs a database change that is not installed yet.'
              : 'You do not have permission to link stock items.'}>
            <Lock size={13} aria-hidden="true" /> Confirm link
          </button>
        ) },
      ])} />
      {!exact && (
        <p className="cc-muted" style={{ margin: '6px 0 0' }}>
          Suggestions only. They are ranked by tyre size and brand and are never applied automatically.
        </p>
      )}
    </div>
  )
}

export default function UnmatchedItemsPanel({ scope, can }) {
  const q = useInvQuery(() => loadUnmatchedReview(scope), [scope?.country, scope?.site])
  const [filter, setFilter] = useState('real')
  const [openId, setOpenId] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [exportErr, setExportErr] = useState('')
  const canExport = typeof can === 'function' ? can('export') : false
  // Linking an item is a master-data decision: the same right that approves
  // engineering / adjustment changes (mirrors _inv_pi_can_master server-side).
  const canLink = typeof can === 'function' ? (can('adjustment_approve') || can('discrepancy_review')) : false

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
      <Note tone="warn" icon={Lock} title="Confirming a link is not available yet">
        Stock lines can only be changed by an approved server action, and none exists yet that links a stock line to
        an item. The proposals below can be reviewed and exported now; the confirm step waits for that database change.
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
          <Candidates row={open} canLink={canLink} />
        </SectionCard>
      )}
    </div>
  )
}
