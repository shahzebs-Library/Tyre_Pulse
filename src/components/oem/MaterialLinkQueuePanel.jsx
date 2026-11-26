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
import { useLanguage } from '../../contexts/LanguageContext'
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
  const { t } = useLanguage()
  const basisLabel = (b) => (BASIS_LABEL[b] ? t(`wmsparts.basis.${b}`) : b)

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
          onClick={() => act(key, (k) => proposeErpLink(r, k), t('wmsparts.queue.doneProposed'))}>
          <Send size={14} aria-hidden="true" /> {t('wmsparts.queue.propose')}
        </button>
      )
    }
    if (s === 'mine') {
      return (
        <span className="inv-mm-chips">
          <span className="cc-card-sub">{t('wmsparts.queue.anotherMustApprove')}</span>
          <button type="button" className="cc-btn-ghost" disabled={busy === key}
            onClick={() => act(key, (k) => decideLink({ id: r.proposal_id, decision: 'withdraw' }, k), t('wmsparts.queue.doneWithdrawn'))}>
            <Undo2 size={14} aria-hidden="true" /> {t('wmsparts.common.withdraw')}
          </button>
        </span>
      )
    }
    if (s === 'awaiting') {
      if (!canDecide) return <span className="cc-card-sub">{t('wmsparts.queue.needsApprover')}</span>
      if (rejecting === key) {
        return (
          <span className="inv-mm-chips">
            <input className="inv-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('wmsparts.common.reason')} aria-label={t('wmsparts.queue.rejectReasonAria')} />
            <button type="button" className="inv-btn-outline" disabled={busy === key || !note.trim()}
              onClick={() => act(key, (k) => decideLink({ id: r.proposal_id, decision: 'reject', note }, k), t('wmsparts.queue.doneRejected'))}>
              <X size={14} aria-hidden="true" /> {t('wmsparts.common.reject')}
            </button>
            <button type="button" className="cc-btn-ghost" onClick={() => { setRejecting(null); setNote('') }}>{t('wmsparts.common.cancel')}</button>
          </span>
        )
      }
      return (
        <span className="inv-mm-chips">
          <button type="button" className="inv-btn-accent" disabled={busy === key}
            onClick={() => act(key, (k) => decideLink({ id: r.proposal_id, decision: 'approve' }, k), t('wmsparts.queue.doneApproved'))}>
            <Check size={14} aria-hidden="true" /> {t('wmsparts.common.approve')}
          </button>
          <button type="button" className="inv-btn-outline" disabled={busy === key} onClick={() => { setRejecting(key); setNote('') }}>
            <X size={14} aria-hidden="true" /> {t('wmsparts.common.reject')}
          </button>
        </span>
      )
    }
    return <span className="cc-na">{t('wmsparts.common.none')}</span>
  }

  const columns = [
    { key: 'item_code', header: t('wmsparts.approved.col.erpItem'), sortValue: (r) => r.item_code, cell: (r) => (
      <span><strong dir="ltr">{r.item_code}</strong> <span className="cc-card-sub" style={{ display: 'block' }}>{r.item_name || t('wmsparts.queue.noDescription')} ({r.country})</span></span>
    ) },
    { key: 'company_sku', header: t('wmsparts.queue.catalogueItem'), sortValue: (r) => r.company_sku, cell: (r) => (
      <span><strong dir="ltr">{r.company_sku}</strong> <span className="cc-card-sub" style={{ display: 'block' }}>{r.canonical_description || t('wmsparts.queue.noDescription')}</span></span>
    ) },
    { key: 'basis', header: t('wmsparts.common.basis'), sortValue: (r) => r.basis, cell: (r) => (
      <span>
        {basisLabel(r.basis)}
        {r.basis === 'normalized_oem' && r.matched_value ? <span className="cc-card-sub" style={{ display: 'block' }}>{t('wmsparts.queue.oemValue', { value: r.matched_value })}</span> : null}
      </span>
    ) },
    { key: 'check', header: t('wmsparts.queue.check'), sortable: false, cell: (r) => {
      const w = candidateWarnings(r, t)
      if (!w.length) return <StatusPill value="ok" tone="good" label={r.same_description ? t('wmsparts.queue.sameDescription') : t('wmsparts.queue.noWarning')} />
      return <ul className="oem-warn-list">{w.map((x) => <li key={x}>{x}</li>)}</ul>
    } },
    { key: 'status', header: t('wmsparts.common.status'), sortValue: (r) => candidateStatus(r, userId), cell: (r) => {
      const s = candidateStatus(r, userId)
      return <StatusPill value={s} tone={CANDIDATE_STATUS_TONE[s]} label={CANDIDATE_STATUS_LABEL[s] ? t(`wmsparts.candStatus.${s}`) : s} />
    } },
    { key: 'actions', header: t('wmsparts.common.action'), sortable: false, cell: actions },
  ]

  return (
    <SectionCard
      title={t('wmsparts.queue.title')}
      sub={t('wmsparts.queue.sub')}
      action={(
        <button type="button" className="cc-btn-ghost" onClick={q.retry} disabled={q.loading}>
          <RefreshCw size={14} aria-hidden="true" /> {t('wmsparts.common.refresh')}
        </button>
      )}>
      <Note>{t('wmsparts.queue.note')}</Note>
      {q.error ? <ErrorNote error={q.error} onRetry={q.retry} />
        : q.data?.status === 'not_provisioned' ? <NotSetUp what={t('wmsparts.queue.what')} />
          : (
            <>
              {q.data && (
                <p className="cc-card-sub">
                  {t('wmsparts.queue.summary', {
                    total: formatQty(q.data.total), country: effectiveCountry, exact: formatQty(summary.exact),
                    oem: formatQty(summary.oem), same: formatQty(summary.sameDescription),
                    warnings: formatQty(summary.warnings), awaiting: formatQty(summary.awaiting),
                  })}
                </p>
              )}
              {actionError && <ErrorNote error={actionError} />}
              {done && <Note tone="good">{done}</Note>}
              <div className="inv-toolbar" role="group" aria-label={t('wmsparts.common.filters')}>
                {!scoped && (
                  <label className="cc-field">
                    <span>{t('wmsparts.common.country')}</span>
                    <select className="cc-select" value={country} onChange={(e) => { setCountry(e.target.value); setPage(0) }}>
                      {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                )}
                <label className="cc-field">
                  <span>{t('wmsparts.common.show')}</span>
                  <select className="cc-select" value={filters.view} onChange={(e) => setFilters((f) => ({ ...f, view: e.target.value }))}>
                    {CANDIDATE_FILTERS.map((k) => <option key={k} value={k}>{t(`wmsparts.queue.view.${k}`)}</option>)}
                  </select>
                </label>
                <label className="cc-field">
                  <span>{t('wmsparts.common.basis')}</span>
                  <select className="cc-select" value={filters.basis} onChange={(e) => setFilters((f) => ({ ...f, basis: e.target.value }))}>
                    <option value="all">{t('wmsparts.common.all')}</option>
                    <option value="exact_code">{t('wmsparts.basis.exact_code')}</option>
                    <option value="normalized_oem">{t('wmsparts.basis.normalized_oem')}</option>
                  </select>
                </label>
                <SearchBox value={filters.search} onChange={(v) => setFilters((f) => ({ ...f, search: v }))}
                  placeholder={t('wmsparts.queue.searchPh')} label={t('wmsparts.queue.search')} />
              </div>
              <div className="inv-scroll">
                <KitTable compact scroll columns={columns} rows={rows} loading={q.loading && !q.data}
                  empty={q.data?.total ? t('wmsparts.queue.noMatch') : t('wmsparts.queue.empty')} />
              </div>
              {q.data?.total > CANDIDATE_PAGE && (
                <Pager page={page} pageSize={CANDIDATE_PAGE} total={q.data.total} onPage={setPage} noun={t('wmsparts.queue.noun')} sizes={[CANDIDATE_PAGE]} />
              )}
              <style>{`.oem-warn-list { margin: 0; padding-inline-start: 16px; font-size: 12px; color: var(--cc-amber, #b45309); max-width: 320px; }`}</style>
            </>
          )}
    </SectionCard>
  )
}
