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
import { useLanguage } from '../../contexts/LanguageContext'
import { loadUnmatchedReview } from '../../lib/api/stockReconcile'
import { UNMATCHED_KINDS, unmatchedExportRows } from '../../lib/inventory/stockReconcile'
import { formatQty } from '../../lib/inventory/inventoryMoney'
import { useInvQuery, ErrorNote, NotSetUp, Note, StatusPill, SectionCard, alignNumeric, fmtDateTime } from './InvUi'
import { proposeStockLink, decideLink, loadStockLinkProposals } from '../../lib/api/materialLinks'
import { newIdempotencyKey } from '../../lib/api/inventory'
import { toUserMessage } from '../../lib/inventory/errorText'

const KIND_TONE = { code_exact: 'good', code_ambiguous: 'warning', code_missing: 'bad', no_code_suggest: 'info', no_code_none: 'muted' }
const SOURCES = ['material_master', 'material_canonical']
const FILTERS = ['real', 'code', 'nocode', 'demo', 'all']

function Candidates({ row, canPropose, canDecide, userId, proposals, onDone }) {
  const { t } = useLanguage()
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
        <Note tone="warn" title={t('wmsparts.unmatched.awaitingTitle')}>
          {t('wmsparts.unmatched.awaitingBody', {
            item: item ? `${item.code || item.item_code} ${item.name || item.item_name || ''}`.trim() : open.item_id,
            basis: open.basis === 'exact_code' ? t('wmsparts.unmatched.basisCode') : t('wmsparts.unmatched.basisSuggestion'),
          })}
          {open.note ? ` ${t('wmsparts.unmatched.noteValue', { note: open.note })}` : ''}
        </Note>
        {error && <ErrorNote error={error} />}
        <div className="inv-actions">
          {own ? (
            <>
              <span className="cc-card-sub">{t('wmsparts.unmatched.anotherMustApprove')}</span>
              <button type="button" className="cc-btn-ghost" disabled={!!busy}
                onClick={() => act('w', (k) => decideLink({ id: open.id, decision: 'withdraw' }, k))}>
                <Undo2 size={13} aria-hidden="true" /> {t('wmsparts.common.withdraw')}
              </button>
            </>
          ) : canDecide ? (
            <>
              <button type="button" className="inv-btn-accent" disabled={!!busy}
                onClick={() => act('a', (k) => decideLink({ id: open.id, decision: 'approve' }, k))}>
                <Check size={13} aria-hidden="true" /> {t('wmsparts.unmatched.approveLink')}
              </button>
              <input className="inv-input" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder={t('wmsparts.unmatched.rejectReason')} aria-label={t('wmsparts.unmatched.rejectReason')} />
              <button type="button" className="inv-btn-outline" disabled={!!busy || !rejectNote.trim()}
                onClick={() => act('r', (k) => decideLink({ id: open.id, decision: 'reject', note: rejectNote }, k))}>
                <X size={13} aria-hidden="true" /> {t('wmsparts.common.reject')}
              </button>
            </>
          ) : <span className="cc-card-sub">{t('wmsparts.unmatched.needsApprover')}</span>}
        </div>
      </div>
    )
  }

  if (!list.length) {
    return (
      <Note tone="warn">
        {row.code
          ? t('wmsparts.unmatched.codeMissing', { code: row.code, country: row.country || t('wmsparts.unmatched.thisCountry') })
          : t('wmsparts.unmatched.noSize')}
      </Note>
    )
  }
  return (
    <div className="inv-scroll">
      {last && <Note tone={last.status === 'rejected' ? 'warn' : 'info'}>{t('wmsparts.unmatched.lastProposal', { status: t(`wmsparts.candStatus.${last.status}`) })}{last.decision_note ? `: ${last.decision_note}` : '.'}</Note>}
      {error && <ErrorNote error={error} />}
      {!exact && canPropose && (
        <label className="cc-field" style={{ maxWidth: 420 }}>
          <span>{t('wmsparts.unmatched.whyLabel')}</span>
          <input className="inv-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('wmsparts.unmatched.whyPh')} />
        </label>
      )}
      <KitTable compact rows={list} columns={alignNumeric([
        { key: 'code', header: t('wmsparts.common.code'), cell: (c) => (c.code || c.item_code ? <span dir="ltr">{c.code || c.item_code}</span> : <span className="cc-na">{t('wmsparts.common.na')}</span>) },
        { key: 'name', header: t('wmsparts.common.name'), cell: (c) => c.name || c.item_name || <span className="cc-na">{t('wmsparts.common.na')}</span> },
        { key: 'source', header: t('wmsparts.common.source'), cell: (c) => (SOURCES.includes(c.source) ? t(`wmsparts.unmatched.source.${c.source}`) : c.source) },
        { key: 'linked', header: t('wmsparts.unmatched.inCatalogue'), cell: (c) => (c.linked === true
          ? <StatusPill value="yes" tone="good" label={t('wmsparts.unmatched.linked')} />
          : c.linked === false ? <StatusPill value="no" tone="warning" label={t('wmsparts.unmatched.notLinked')} /> : <span className="cc-na">{t('wmsparts.common.na')}</span>) },
        { key: 'reasons', header: exact ? t('wmsparts.common.basis') : t('wmsparts.unmatched.whySuggested'), cell: (c) => (c.reasons || []).join('. ') },
        { key: 'confirm', header: '', cell: (c) => {
          if (c.source === 'material_canonical') {
            return <span className="cc-card-sub">{t('wmsparts.unmatched.catalogueOnly')}</span>
          }
          const key = c.id || c.item_id
          return (
            <button type="button" className="inv-btn-outline" disabled={!canPropose || !!busy || (!exact && !note.trim())}
              title={!canPropose ? t('wmsparts.unmatched.noPermission') : (!exact && !note.trim()) ? t('wmsparts.unmatched.writeWhy') : undefined}
              onClick={() => act(key, (k) => proposeStockLink(row, c, note, k))}>
              <Send size={13} aria-hidden="true" /> {t('wmsparts.unmatched.proposeLink')}
            </button>
          )
        } },
      ])} />
      <p className="cc-muted" style={{ margin: '6px 0 0' }}>
        {exact
          ? t('wmsparts.unmatched.exactFoot')
          : t('wmsparts.unmatched.suggestFoot')}
      </p>
    </div>
  )
}

export default function UnmatchedItemsPanel({ scope, can, userId }) {
  const { t } = useLanguage()
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
  if (q.data?.status === 'not_provisioned') return <NotSetUp what={t('wmsparts.unmatched.what')} />

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
      setExportErr(t('wmsparts.unmatched.exportFailed'))
    } finally { setExporting(false) }
  }

  const columns = [
    { key: 'site', header: t('wmsparts.common.site'), cell: (r) => r.site || <span className="cc-na">{t('wmsparts.common.na')}</span> },
    { key: 'description', header: t('wmsparts.common.description'), cell: (r) => (
      <span>{r.description || <span className="cc-na">{t('wmsparts.common.na')}</span>}{r.demo && <> <StatusPill value="demo" tone="muted" label={t('wmsparts.unmatched.demo')} /></>}</span>
    ) },
    { key: 'code', header: t('wmsparts.unmatched.codeOnLine'), cell: (r) => (r.code ? <span dir="ltr">{r.code}</span> : <span className="cc-na">{t('wmsparts.common.none')}</span>) },
    { key: 'size', header: t('wmsparts.unmatched.tyreSize'), cell: (r) => (r.size ? <span dir="ltr">{r.size}</span> : <span className="cc-na">{t('wmsparts.common.na')}</span>) },
    { key: 'qty_on_hand', header: t('wmsparts.common.onHand'), numeric: true, cell: (r) => formatQty(r.qty_on_hand) },
    { key: 'kind', header: t('wmsparts.unmatched.finding'), cell: (r) => <StatusPill value={r.kind} tone={KIND_TONE[r.kind]} label={UNMATCHED_KINDS[r.kind] ? t(`wmsparts.unmatched.kind.${r.kind}`) : r.kind} /> },
    { key: 'best', header: t('wmsparts.unmatched.proposedMatch'), cell: (r) => {
      const b = r.candidates?.[0]
      if (!b) return <span className="cc-na">{t('wmsparts.common.none')}</span>
      return <span>{b.code || b.item_code} {b.name || b.item_name ? `- ${b.name || b.item_name}` : ''}{r.candidates.length > 1 ? ` (+${r.candidates.length - 1})` : ''}</span>
    } },
  ]

  const open = rows.find((r) => r.id === openId) || null

  return (
    <div className="inv-hub">
      <Note>{t('wmsparts.unmatched.intro')}</Note>
      <Note title={t('wmsparts.unmatched.twoPeopleTitle')}>{t('wmsparts.unmatched.twoPeopleBody')}</Note>
      {q.data?.truncated && <Note tone="warn">{t('wmsparts.unmatched.truncated')}</Note>}
      <div className="inv-kpis">
        <Kpi icon={Link2Off} tone="t-amber" loading={loading} value={s?.real} label={t('wmsparts.unmatched.kpi.real')} />
        <Kpi icon={CheckCircle2} tone="t-green" loading={loading} value={s?.code_exact} label={t('wmsparts.unmatched.kpi.exact')} />
        <Kpi icon={Search} tone="t-blue" loading={loading} value={s?.no_code_suggest} label={t('wmsparts.unmatched.kpi.suggest')} />
        <Kpi icon={Link2} tone="t-red" loading={loading} value={s ? s.code_missing + s.code_ambiguous + s.no_code_none : null} label={t('wmsparts.unmatched.kpi.identify')} />
        <Kpi icon={FlaskConical} tone="t-blue" loading={loading} value={s?.demo} label={t('wmsparts.unmatched.kpi.demo')} />
      </div>
      <SectionCard
        title={t('wmsparts.unmatched.title', { n: formatQty(rows.length) })}
        sub={q.data ? t('wmsparts.unmatched.sub', { time: fmtDateTime(q.data.generatedAt) }) : undefined}
        action={(
          <div className="inv-actions">
            <button type="button" className="cc-btn-ghost" onClick={q.retry} disabled={q.loading}>
              <RefreshCw size={14} aria-hidden="true" /> {t('wmsparts.common.refresh')}
            </button>
            {canExport && (
              <button type="button" className="cc-btn-ghost" onClick={doExport} disabled={exporting || !rows.length}>
                <Download size={14} aria-hidden="true" /> {exporting ? t('wmsparts.common.preparing') : t('wmsparts.common.excel')}
              </button>
            )}
          </div>
        )}>
        {exportErr && <ErrorNote error={exportErr} />}
        <div className="inv-toolbar">
          <label className="cc-field" style={{ maxWidth: 220 }}>
            <span>{t('wmsparts.common.show')}</span>
            <select className="cc-select" value={filter} onChange={(e) => { setFilter(e.target.value); setOpenId(null) }}>
              {FILTERS.map((k) => <option key={k} value={k}>{t(`wmsparts.unmatched.filter.${k}`)}</option>)}
            </select>
          </label>
        </div>
        <div className="inv-scroll">
          <KitTable compact columns={alignNumeric(columns)} rows={rows} loading={loading}
            empty={filter === 'real' ? t('wmsparts.unmatched.allLinked') : t('wmsparts.unmatched.noLines')}
            onRowClick={(r) => setOpenId(r.id === openId ? null : r.id)} />
        </div>
      </SectionCard>
      {open && (
        <SectionCard title={t('wmsparts.unmatched.proposalsFor', { line: open.description || t('wmsparts.unmatched.thisLine') })}
          sub={`${t('wmsparts.unmatched.lineSub', { site: open.site || t('wmsparts.unmatched.noSite'), country: open.country || t('wmsparts.common.noCountry'), qty: formatQty(open.qty_on_hand) })}${open.brands?.length ? ` ${t('wmsparts.unmatched.brandRead', { brands: open.brands.join(', ') })}` : ''}`}>
          <Candidates key={open.id} row={open} canPropose={canPropose} canDecide={canDecide} userId={userId}
            proposals={(pq.data || []).filter((p) => p.stock_id === open.id)}
            onDone={() => { q.retry(); pq.retry() }} />
          {pq.error && <ErrorNote error={pq.error} onRetry={pq.retry} />}
          {!pq.loading && !pq.error && pq.data === null && <Note tone="warn">{t('wmsparts.unmatched.notSetUp')}</Note>}
        </SectionCard>
      )}
    </div>
  )
}
