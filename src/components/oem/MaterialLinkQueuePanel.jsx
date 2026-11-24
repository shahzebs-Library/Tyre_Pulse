/**
 * Review queue for ERP items (material_master) that have no catalogue link.
 * UAE has 9,321 such items and Egypt 3,398 (KSA links were loaded in WP1).
 *
 * The server proposes a match only by an exact rule (same item code, or the same
 * normalised OEM number as a catalogue OEM alias). Nothing fuzzy, nothing applied:
 *   Propose  -> stores a proposal (inv_material_link_propose);
 *   Approve / Reject -> a SECOND person decides (inv_material_link_decide). The
 *   database refuses the proposer, stamps the approver and re-checks the country.
 * A code means a different item per country, so a same-code match whose
 * description differs is shown with a warning and never counted as safe.
 */
import { useMemo, useState } from 'react'
import { Check, X, Send, RefreshCw, Undo2 } from 'lucide-react'
import { KitTable, Pager } from '../commandCenter/kit'
import { loadLinkCandidates, proposeErpLink, decideLink, CANDIDATE_PAGE } from '../../lib/api/materialLinks'
import { newIdempotencyKey } from '../../lib/api/inventory'
import {
  BASIS_LABEL, CANDIDATE_STATUS_LABEL, CANDIDATE_STATUS_TONE, CANDIDATE_FILTERS,
  candidateStatus, candidateWarnings, filterCandidates, summarizeCandidates,
} from '../../lib/oem/materialLinks'
import { toUserMessage } from '../../lib/inventory/errorText'
import { formatQty } from '../../lib/inventory/inventoryMoney'
import { useInvQuery, ErrorNote, NotSetUp, Note, SectionCard, StatusPill, SearchBox } from '../inventory/InvUi'

const VIEW_LABEL = {
  all: 'All', safe: 'Safe to propose', warning: 'Has a warning', open: 'Not proposed', awaiting: 'Awaiting approval', approved: 'Approved',
}
const COUNTRIES = ['UAE', 'Egypt', 'KSA']

export default function MaterialLinkQueuePanel({ scope, can, userId }) {
  const scoped = scope?.country && scope.country !== 'All' ? scope.country : null
  const [country, setCountry] = useState(scoped || 'UAE')
  const [page, setPage] = useState(0)
  const [filters, setFilters] = useState({ view: 'all', basis: 'all', search: '' })
  const [busy, setBusy] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [done, setDone] = useState(null)
  const [rejecting, setRejecting] = useState(null)
  const [note, setNote] = useState('')
  const effectiveCountry = scoped || country
  const canDecide = typeof can === 'function' && (can('engineering_approve') || can('adjustment_approve'))

  const q = useInvQuery(() => loadLinkCandidates({ country: effectiveCountry, page }), [effectiveCountry, page])
  const rows = useMemo(() => filterCandidates(q.data?.rows || [], filters, userId), [q.data, filters, userId])
  const summary = useMemo(() => summarizeCandidates(q.data?.rows || [], userId), [q.data, userId])

  const act = async (key, fn, message) => {
    setBusy(key); setActionError(null); setDone(null)
    try {
      await fn(newIdempotencyKey())
      setDone(message); setRejecting(null); setNote('')
      q.retry()
    } catch (err) {
      setActionError(toUserMessage(err))
    } finally { setBusy(null) }
  }

  const rowKey = (r) => `${r.item_id}|${r.canonical_id}`

  const actions = (r) => {
    const s = candidateStatus(r, userId)
    const key = rowKey(r)
    if (s === 'open') {
      return (
        <button type="button" className="inv-btn-outline" disabled={busy === key || r.canonical_taken}
          onClick={() => act(key, (k) => proposeErpLink(r, k), 'Proposal stored. A second person must approve it.')}>
          <Send size={14} aria-hidden="true" /> Propose
        </button>
      )
    }
    if (s === 'mine') {
      return (
        <span className="inv-mm-chips">
          <span className="cc-card-sub">Another person must approve.</span>
          <button type="button" className="cc-btn-ghost" disabled={busy === key}
            onClick={() => act(key, (k) => decideLink({ id: r.proposal_id, decision: 'withdraw' }, k), 'Proposal withdrawn.')}>
            <Undo2 size={14} aria-hidden="true" /> Withdraw
          </button>
        </span>
      )
    }
    if (s === 'awaiting') {
      if (!canDecide) return <span className="cc-card-sub">Needs an engineering approver.</span>
      if (rejecting === key) {
        return (
          <span className="inv-mm-chips">
            <input className="inv-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason" aria-label="Reason for rejecting" />
            <button type="button" className="inv-btn-outline" disabled={busy === key || !note.trim()}
              onClick={() => act(key, (k) => decideLink({ id: r.proposal_id, decision: 'reject', note }, k), 'Proposal rejected.')}>
              <X size={14} aria-hidden="true" /> Reject
            </button>
            <button type="button" className="cc-btn-ghost" onClick={() => { setRejecting(null); setNote('') }}>Cancel</button>
          </span>
        )
      }
      return (
        <span className="inv-mm-chips">
          <button type="button" className="inv-btn-accent" disabled={busy === key}
            onClick={() => act(key, (k) => decideLink({ id: r.proposal_id, decision: 'approve' }, k), 'Link approved and saved.')}>
            <Check size={14} aria-hidden="true" /> Approve
          </button>
          <button type="button" className="inv-btn-outline" disabled={busy === key} onClick={() => { setRejecting(key); setNote('') }}>
            <X size={14} aria-hidden="true" /> Reject
          </button>
        </span>
      )
    }
    return <span className="cc-na">None</span>
  }

  const columns = [
    { key: 'item_code', header: 'ERP item', sortValue: (r) => r.item_code, cell: (r) => (
      <span><strong>{r.item_code}</strong> <span className="cc-card-sub" style={{ display: 'block' }}>{r.item_name || 'No description'} ({r.country})</span></span>
    ) },
    { key: 'company_sku', header: 'Catalogue item', sortValue: (r) => r.company_sku, cell: (r) => (
      <span><strong>{r.company_sku}</strong> <span className="cc-card-sub" style={{ display: 'block' }}>{r.canonical_description || 'No description'}</span></span>
    ) },
    { key: 'basis', header: 'Basis', sortValue: (r) => r.basis, cell: (r) => (
      <span>
        {BASIS_LABEL[r.basis] || r.basis}
        {r.basis === 'normalized_oem' && r.matched_value ? <span className="cc-card-sub" style={{ display: 'block' }}>OEM {r.matched_value}</span> : null}
      </span>
    ) },
    { key: 'check', header: 'Check', sortable: false, cell: (r) => {
      const w = candidateWarnings(r)
      if (!w.length) return <StatusPill value="ok" tone="good" label={r.same_description ? 'Same description' : 'No warning'} />
      return <ul className="oem-warn-list">{w.map((x) => <li key={x}>{x}</li>)}</ul>
    } },
    { key: 'status', header: 'Status', sortValue: (r) => candidateStatus(r, userId), cell: (r) => {
      const s = candidateStatus(r, userId)
      return <StatusPill value={s} tone={CANDIDATE_STATUS_TONE[s]} label={CANDIDATE_STATUS_LABEL[s]} />
    } },
    { key: 'actions', header: 'Action', sortable: false, cell: actions },
  ]

  return (
    <SectionCard
      title="ERP items without a catalogue link"
      sub="Proposed by exact code or OEM number only. A second person approves each link."
      action={(
        <button type="button" className="cc-btn-ghost" onClick={q.retry} disabled={q.loading}>
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </button>
      )}>
      <Note>
        An item code can mean a different item in each country. A match with the same code but a different
        description is marked and needs a person to check it. Items with no exact match are not listed here;
        they need a person to identify them in Material Master.
      </Note>
      {q.error ? <ErrorNote error={q.error} onRetry={q.retry} />
        : q.data?.status === 'not_provisioned' ? <NotSetUp what="The link review queue" />
          : (
            <>
              {q.data && (
                <p className="cc-card-sub">
                  {`${formatQty(q.data.total)} proposed matches in ${effectiveCountry}. This page: ${formatQty(summary.exact)} by code, `
                    + `${formatQty(summary.oem)} by OEM number, ${formatQty(summary.sameDescription)} with the same description, `
                    + `${formatQty(summary.warnings)} with a warning, ${formatQty(summary.awaiting)} awaiting approval.`}
                </p>
              )}
              {actionError && <ErrorNote error={actionError} />}
              {done && <Note tone="good">{done}</Note>}
              <div className="inv-toolbar" role="group" aria-label="Filters">
                {!scoped && (
                  <label className="cc-field">
                    <span>Country</span>
                    <select className="cc-select" value={country} onChange={(e) => { setCountry(e.target.value); setPage(0) }}>
                      {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                )}
                <label className="cc-field">
                  <span>Show</span>
                  <select className="cc-select" value={filters.view} onChange={(e) => setFilters((f) => ({ ...f, view: e.target.value }))}>
                    {CANDIDATE_FILTERS.map((k) => <option key={k} value={k}>{VIEW_LABEL[k]}</option>)}
                  </select>
                </label>
                <label className="cc-field">
                  <span>Basis</span>
                  <select className="cc-select" value={filters.basis} onChange={(e) => setFilters((f) => ({ ...f, basis: e.target.value }))}>
                    <option value="all">All</option>
                    <option value="exact_code">{BASIS_LABEL.exact_code}</option>
                    <option value="normalized_oem">{BASIS_LABEL.normalized_oem}</option>
                  </select>
                </label>
                <SearchBox value={filters.search} onChange={(v) => setFilters((f) => ({ ...f, search: v }))}
                  placeholder="Code, SKU or description" label="Search the queue" />
              </div>
              <div className="inv-scroll">
                <KitTable compact scroll columns={columns} rows={rows} loading={q.loading && !q.data}
                  empty={q.data?.total ? 'No matches in this view.' : 'No exact matches to review for this country.'} />
              </div>
              {q.data?.total > CANDIDATE_PAGE && (
                <Pager page={page} pageSize={CANDIDATE_PAGE} total={q.data.total} onPage={setPage} noun="matches" sizes={[CANDIDATE_PAGE]} />
              )}
              <style>{`.oem-warn-list { margin: 0; padding-left: 16px; font-size: 12px; color: var(--cc-amber, #b45309); max-width: 320px; }`}</style>
            </>
          )}
    </SectionCard>
  )
}
