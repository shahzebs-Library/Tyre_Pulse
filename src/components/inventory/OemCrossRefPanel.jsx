/**
 * OEM cross-reference review. Proposes links between parsed OEM manual rows and
 * company catalogue items by an exact, explainable part-number match
 * (src/lib/inventory/oemCrossRef.js) and lets a person act on each one:
 *  - Accept submits the link through inv_compat_propose (stored as "proposed");
 *  - a SECOND person approves or rejects a stored link through inv_compat_decide
 *    (the database refuses the proposer deciding their own record);
 *  - Dismiss on a suggestion that is not stored yet only hides it on this
 *    screen, because nothing is stored to reject. The UI says so.
 * Nothing is linked automatically. The panel loads only when opened.
 */
import { useMemo, useState } from 'react'
import { Search, Check, X, EyeOff, RefreshCw } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import { loadOemCrossRef, submitOemLink, decideOemLink } from '../../lib/api/oemCrossRef'
import { newIdempotencyKey } from '../../lib/api/inventory'
import {
  filterProposals, summarizeProposals, proposalStatus, STATUS_FILTERS, BAND_FILTERS, FIELD_BAND,
} from '../../lib/inventory/oemCrossRef'
import { toUserMessage } from '../../lib/inventory/errorText'
import { KitTable } from '../commandCenter/kit'
import { useInvQuery, ErrorNote, NotSetUp, Note, SectionCard, StatusPill, SearchBox, fmtDateTime } from './InvUi'

const STATUS_TONE = { open: 'info', awaiting: 'warn', approved: 'good', rejected: 'muted', conflict: 'bad', no_erp: 'muted' }
const BAND_TONE = { high: 'good', medium: 'warn' }

function Evidence({ c, t }) {
  return (
    <span className="inv-mm-chips">
      {c.evidence.map((x, i) => (
        <span key={`${x.field}-${i}`} className={`inv-chip ${FIELD_BAND[x.field] === 'high' ? 'inv-chip-accent' : ''}`}
          title={x.field === 'description' ? String(x.value || '') : undefined}>
          {t(`inventory.oemx.field.${x.field}`)}{x.field !== 'description' && x.value ? `: ${x.value}` : ''}
        </span>
      ))}
    </span>
  )
}

function ErpCell({ c, t }) {
  if (c.erp.state === 'ok') return <span>{c.erp.item.item_code}{c.erp.item.country ? ` (${c.erp.item.country})` : ''}</span>
  return <span className="cc-na">{t(`inventory.oemx.erp.${c.erp.state}`, { n: c.erp.count })}</span>
}

export default function OemCrossRefPanel({ scope, userId }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [filters, setFilters] = useState({ band: 'all', status: 'all', search: '' })
  const [dismissed, setDismissed] = useState(() => new Set())
  const [busy, setBusy] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [done, setDone] = useState(null)
  const [rejecting, setRejecting] = useState(null)
  const [note, setNote] = useState('')
  const country = scope?.country && scope.country !== 'All' ? scope.country : undefined

  const q = useInvQuery(() => (open ? loadOemCrossRef({ country }) : Promise.resolve(null)), [open, country])
  const all = useMemo(() => (q.data?.proposals || []).filter((p) => !dismissed.has(p.key)), [q.data, dismissed])
  const summary = useMemo(() => summarizeProposals(all), [all])
  const rows = useMemo(() => filterProposals(all, filters), [all, filters])

  const act = async (key, fn, message) => {
    setBusy(key); setActionError(null); setDone(null)
    try {
      await fn(newIdempotencyKey())
      setDone(message)
      setRejecting(null); setNote('')
      q.retry()
    } catch (err) {
      setActionError(toUserMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const setF = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }))

  const actions = (p) => {
    const status = proposalStatus(p)
    if (status === 'awaiting') {
      const ref = p.candidates[0].reference
      const own = userId && ref.proposed_by === userId
      if (rejecting === p.key) {
        return (
          <span className="inv-mm-chips">
            <input className="inv-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('inventory.oemx.reasonPh')}
              aria-label={t('inventory.oemx.reasonPh')} />
            <button type="button" className="inv-btn-outline" disabled={busy === p.key || !note.trim()}
              onClick={() => act(p.key, (k) => decideOemLink({ id: ref.id, decision: 'reject', note }, k), t('inventory.oemx.doneRejected'))}>
              <X size={14} aria-hidden="true" /> {t('inventory.oemx.confirmReject')}
            </button>
            <button type="button" className="cc-btn-ghost" onClick={() => { setRejecting(null); setNote('') }}>{t('inventory.oemx.cancel')}</button>
          </span>
        )
      }
      return (
        <span className="inv-mm-chips">
          <button type="button" className="inv-btn-accent" disabled={own || busy === p.key} title={own ? t('inventory.oemx.ownProposal') : undefined}
            onClick={() => act(p.key, (k) => decideOemLink({ id: ref.id, decision: 'approve' }, k), t('inventory.oemx.doneApproved'))}>
            <Check size={14} aria-hidden="true" /> {t('inventory.oemx.approve')}
          </button>
          <button type="button" className="inv-btn-outline" disabled={own || busy === p.key} title={own ? t('inventory.oemx.ownProposal') : undefined}
            onClick={() => { setRejecting(p.key); setNote('') }}>
            <X size={14} aria-hidden="true" /> {t('inventory.oemx.reject')}
          </button>
          {own && <span className="cc-card-sub">{t('inventory.oemx.ownProposal')}</span>}
        </span>
      )
    }
    if (status === 'approved' || status === 'rejected') {
      const ref = p.candidates[0].reference
      return <span className="cc-card-sub">{ref.decision_note || fmtDateTime(ref.approved_at)}</span>
    }
    const dismiss = (
      <button type="button" className="cc-btn-ghost" title={t('inventory.oemx.dismissHint')}
        onClick={() => setDismissed((s) => new Set(s).add(p.key))}>
        <EyeOff size={14} aria-hidden="true" /> {t('inventory.oemx.dismiss')}
      </button>
    )
    if (status === 'no_erp') return dismiss
    // open match, or a conflict where a PERSON picks one candidate explicitly
    return (
      <span className="inv-mm-chips">
        {p.candidates.filter((c) => c.erp.state === 'ok' && !c.reference).map((c) => (
          <button key={c.canonical.id} type="button" className="inv-btn-accent" disabled={busy === p.key}
            onClick={() => act(p.key, (k) => submitOemLink(p, c, k), t('inventory.oemx.doneSubmitted'))}>
            <Check size={14} aria-hidden="true" /> {p.kind === 'conflict' ? t('inventory.oemx.acceptThis', { sku: c.canonical.company_sku }) : t('inventory.oemx.accept')}
          </button>
        ))}
        {dismiss}
      </span>
    )
  }

  const columns = [
    {
      key: 'partNo', header: t('inventory.oemx.col.oem'), sortValue: (p) => p.partKey,
      cell: (p) => (
        <span>
          <strong>{p.partNo}</strong>
          <span className="cc-card-sub" style={{ display: 'block' }}>
            {p.entries[0]?.description || ''}{p.entries.length > 1 ? ` ${t('inventory.oemx.rows', { n: p.entries.length })}` : ''}
            {p.entries[0]?.manual?.model ? `, ${p.entries[0].manual.manufacturer || ''} ${p.entries[0].manual.model}` : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'item', header: t('inventory.oemx.col.item'), sortable: false,
      cell: (p) => (
        <span style={{ display: 'grid', gap: 6 }}>
          {p.candidates.map((c) => (
            <span key={c.canonical.id}>
              <strong>{c.canonical.company_sku}</strong> {c.canonical.description || ''}
              <Evidence c={c} t={t} />
            </span>
          ))}
        </span>
      ),
    },
    {
      key: 'erp', header: t('inventory.oemx.col.erp'), sortable: false,
      cell: (p) => (
        <span style={{ display: 'grid', gap: 6 }}>{p.candidates.map((c) => <ErpCell key={c.canonical.id} c={c} t={t} />)}</span>
      ),
    },
    {
      key: 'band', header: t('inventory.oemx.col.confidence'), sortValue: (p) => p.band || 'z',
      cell: (p) => (p.kind === 'conflict'
        ? <StatusPill value="conflict" tone="bad" label={t('inventory.oemx.conflict', { n: p.candidates.length })} />
        : <StatusPill value={p.band} tone={BAND_TONE[p.band]} label={t(`inventory.oemx.band.${p.band}`)} />),
    },
    {
      key: 'status', header: t('inventory.oemx.col.status'), sortValue: (p) => proposalStatus(p),
      cell: (p) => { const s = proposalStatus(p); return <StatusPill value={s} tone={STATUS_TONE[s]} label={t(`inventory.oemx.status.${s}`)} /> },
    },
    { key: 'actions', header: t('inventory.oemx.col.actions'), sortable: false, cell: actions },
  ]

  return (
    <SectionCard
      title={t('inventory.oemx.title')}
      sub={t('inventory.oemx.sub')}
      action={open ? (
        <button type="button" className="cc-btn-ghost" onClick={q.retry} disabled={q.loading}>
          <RefreshCw size={14} aria-hidden="true" /> {t('inventory.oemx.refresh')}
        </button>
      ) : (
        <button type="button" className="inv-btn-outline" onClick={() => setOpen(true)}>
          <Search size={14} aria-hidden="true" /> {t('inventory.oemx.open')}
        </button>
      )}
    >
      {!open ? <p className="cc-card-sub">{t('inventory.oemx.closedNote')}</p> : (
        <>
          <Note>{t('inventory.oemx.rule')}</Note>
          {q.error ? <ErrorNote error={q.error} onRetry={q.retry} />
            : q.data?.status === 'not_provisioned' ? <NotSetUp what={t('inventory.oemx.title')} />
              : q.loading && !q.data ? <div className="cc-skel" style={{ height: 200 }} aria-busy="true" />
                : (
                  <>
                    <p className="cc-card-sub">
                      {t('inventory.oemx.summary', {
                        total: summary.total, rows: summary.manualRows, high: summary.high, medium: summary.medium,
                        conflict: summary.conflict, entries: q.data?.counts?.entries ?? 0,
                      })}
                      {dismissed.size ? ` ${t('inventory.oemx.dismissedCount', { n: dismissed.size })}` : ''}
                    </p>
                    {q.data?.truncated?.length > 0 && <Note tone="warn">{t('inventory.oemx.truncated')}</Note>}
                    {actionError && <ErrorNote error={actionError} />}
                    {done && <Note tone="good">{done}</Note>}
                    <div className="inv-toolbar" role="group" aria-label={t('inventory.oemx.filters')}>
                      <label className="cc-field">
                        <span>{t('inventory.oemx.col.confidence')}</span>
                        <select className="cc-select" value={filters.band} onChange={setF('band')}>
                          {BAND_FILTERS.map((k) => <option key={k} value={k}>{t(`inventory.oemx.band.${k}`)}</option>)}
                        </select>
                      </label>
                      <label className="cc-field">
                        <span>{t('inventory.oemx.col.status')}</span>
                        <select className="cc-select" value={filters.status} onChange={setF('status')}>
                          {STATUS_FILTERS.map((k) => <option key={k} value={k}>{t(`inventory.oemx.status.${k}`)}</option>)}
                        </select>
                      </label>
                      <SearchBox value={filters.search} onChange={(v) => setFilters((f) => ({ ...f, search: v }))}
                        placeholder={t('inventory.oemx.searchPh')} label={t('inventory.oemx.search')} />
                    </div>
                    {!all.length ? <div className="cc-empty">{t('inventory.oemx.empty')}</div>
                      : !rows.length ? <div className="cc-empty">{t('inventory.oemx.noMatch')}</div>
                        : <KitTable columns={columns} rows={rows} compact scroll />}
                  </>
                )}
        </>
      )}
    </SectionCard>
  )
}
