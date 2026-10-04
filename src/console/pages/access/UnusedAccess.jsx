/**
 * UnusedAccess - "Unused and risky access" on the Access Control home, plus
 * the access review drawer that suggests a decision per person.
 *
 * Read from access_unused_summary() (super admin, read-only). Suggestions come
 * from sign-in dates only and are a hint for the reviewer; nothing changes
 * until the reviewer starts the review, and even then the decisions are
 * recorded as evidence on the review snapshot. Locking or removing anyone only
 * happens when the review is applied on the Access Reviews page, behind its own
 * confirmation. Admins are never suggested for removal.
 *
 * Owner decisions that stay open and are shown as such, never done here:
 * locking the Drivers who never signed in, and removing the Demo Manager.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  UserX, Clock, CalendarX, UserCog, Activity, ClipboardCheck, Download, Info, Save,
} from 'lucide-react'
import {
  Panel, PanelHeader, Badge, Btn, LoadingState, ErrorState, ImpactBox, Note, Table, THead, Th, Tr, Td,
} from '../../components/ui'
import { Drawer } from '../shared/pageKit'
import { getAccessUnusedSummary, startReviewWithDecisions } from '../../../lib/api/accessReviews'
import {
  shapeUnusedSummary, unusedKpis, unusedFindings, suggestDecision, SUGGESTION_META,
  REVIEW_SCOPES, inScope, toReviewDecision, decisionCounts,
} from '../../../lib/accessUnused'
import { toUserMessage } from '../../../lib/safeError'
import { exportConsoleRows } from '../../../lib/consoleTable'
import { useConsoleAuth } from '../../ConsoleAuthContext'

const FINDING_ICON = { never_drivers: UserX, never_other: UserX, idle: Clock, no_end: CalendarX, empty_roles: UserCog, page_views: Activity }
const DRAFT_KEY = 'tp.console.accessReviewDraft.v1'
const PAGE = 50

function fmtLast(p) {
  if (!p.last_sign_in_at) {
    const made = p.created_at ? new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null
    return made ? `Never, made ${made}` : 'Never'
  }
  const d = new Date(p.last_sign_in_at)
  const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000))
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${days} days`
}

function readDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') } catch { return null }
}

function quarterName(now = new Date()) {
  return `Quarterly access review, Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`
}

export function ReviewDrawer({ open, onClose, summary, initialScope = 'all', onStarted }) {
  const { logAction } = useConsoleAuth()
  const [scope, setScope] = useState(initialScope)
  const [decisions, setDecisions] = useState({})
  const [name, setName] = useState(quarterName())
  const [reason, setReason] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    if (!open) return
    setScope(initialScope); setError(null); setNotice(null); setLimit(PAGE)
    const d = readDraft()
    if (d && typeof d === 'object') {
      setDecisions(d.decisions || {}); setName(d.name || quarterName()); setReason(d.reason || '')
    } else { setDecisions({}); setName(quarterName()); setReason('') }
  }, [open, initialScope])

  const people = useMemo(() => summary?.people || [], [summary])
  const now = useMemo(() => new Date(), [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const suggestions = useMemo(() => Object.fromEntries(people.map((p) => [p.id, suggestDecision(p, now, summary?.idleDays)])), [people, now, summary])
  const scoped = useMemo(() => people.filter((p) => inScope(p, scope, now, summary?.idleDays)), [people, scope, now, summary])
  const scopeCounts = useMemo(() => Object.fromEntries(REVIEW_SCOPES.map((s) => [s.key, people.filter((p) => inScope(p, s.key, now, summary?.idleDays)).length])), [people, now, summary])
  const counts = decisionCounts(decisions)
  const suggestRemove = people.filter((p) => suggestions[p.id] === 'remove')
  const suggestAsk = people.filter((p) => suggestions[p.id] === 'ask').length
  const activeIds = people.filter((p) => suggestions[p.id] === 'keep' && p.last_sign_in_at).map((p) => p.id)
  const neverDrivers = people.filter((p) => !p.last_sign_in_at && p.role === 'Driver').length

  const setOne = (id, d) => setDecisions((cur) => {
    const n = { ...cur }
    if (n[id] === d) delete n[id]; else n[id] = d
    return n
  })
  const keepActive = () => setDecisions((cur) => {
    const n = { ...cur }
    for (const id of activeIds) if (!n[id]) n[id] = 'keep'
    return n
  })

  const saveDraft = () => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ decisions, name, reason })); setNotice('Draft saved in this browser. Nothing was sent.') } catch { setNotice('This browser would not save the draft.') }
  }

  const exportEvidence = async () => {
    await exportConsoleRows({
      rows: scoped.map((p) => ({ ...p, suggestion: SUGGESTION_META[suggestions[p.id]]?.label, decision: decisions[p.id] || 'Undecided' })),
      title: 'Access review evidence', format: 'excel',
      columns: [
        { key: 'name', header: 'Person' }, { key: 'email', header: 'Email (masked)' }, { key: 'role', header: 'Role' },
        { key: 'last', header: 'Last sign-in', value: (p) => fmtLast(p) }, { key: 'rules', header: 'Personal rules' },
        { key: 'suggestion', header: 'Suggestion' }, { key: 'decision', header: 'Decision' },
      ],
    })
  }

  const start = async () => {
    setBusy(true); setError(null)
    try {
      const mapped = Object.fromEntries(Object.entries(decisions).map(([id, d]) => [id, toReviewDecision(d)]).filter(([, d]) => d))
      const res = await startReviewWithDecisions({ name: name.trim() || quarterName(), reason, decisions: mapped })
      try { await logAction?.('access_review_started', res.campaignId, 'access_review_campaign', { reason: reason.trim(), recorded: res.recorded, failed: res.failed }) } catch { /* audit best effort */ }
      try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
      onStarted?.(`Review started. ${res.recorded} decisions recorded${res.failed ? `, ${res.failed} could not be recorded` : ''}. Nothing is locked until you apply it on Access Reviews.`)
      onClose()
    } catch (e) {
      setError(toUserMessage(e, 'The review could not be started.'))
    } finally { setBusy(false) }
  }

  const reasonOk = reason.trim().length >= 3
  return (
    <Drawer open={open} onClose={busy ? () => {} : onClose} width="max-w-3xl"
      title={name || 'Access review'}
      subtitle={`Draft, not started. Snapshot of ${people.length} people. Suggestions come from sign-in dates only; the reviewer decides.`}
      footer={<>
        <Btn icon={Download} onClick={exportEvidence} disabled={!scoped.length}>Export evidence</Btn>
        <Btn icon={Save} onClick={saveDraft}>Save draft</Btn>
        <Btn variant="primary" icon={ClipboardCheck} busy={busy} disabled={!reasonOk} onClick={start}>Start review</Btn>
      </>}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-lg overflow-hidden border border-gray-800 bg-gray-800">
        {[
          ['People', people.length, ''],
          ['Suggested remove', suggestRemove.length, suggestRemove.slice(0, 2).map((p) => p.name).join(', ')],
          ['Suggested ask', suggestAsk, ''],
          ['Decided', counts.decided, `${counts.keep} keep, ${counts.edit} edit, ${counts.remove} remove`],
        ].map(([l, v, s]) => (
          <div key={l} className="bg-gray-900/70 px-3 py-2">
            <p className="text-[11px] text-gray-500">{l}</p>
            <p className="text-base font-semibold text-gray-100 tabular-nums">{v}</p>
            {s && <p className="text-[10px] text-gray-500 truncate" title={s}>{s}</p>}
          </div>
        ))}
      </div>

      <label className="block">
        <span className="block text-[11px] font-semibold text-gray-400 mb-1">Review name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
          className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500" />
      </label>

      <div>
        <p className="text-xs font-semibold text-gray-300 mb-1.5">Who is in scope</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Review scope">
          {REVIEW_SCOPES.map((s) => (
            <button key={s.key} type="button" aria-pressed={scope === s.key} onClick={() => { setScope(s.key); setLimit(PAGE) }}
              className={`px-2.5 py-1 rounded-full border text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
                scope === s.key ? 'border-orange-600/60 bg-orange-500/15 text-orange-300' : 'border-gray-800 text-gray-400 hover:text-gray-200'}`}>
              {s.label} {scopeCounts[s.key]}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-gray-500 mt-1">Scope narrows this list only. The review snapshot always covers every approved person.</p>
      </div>

      <Table>
        <THead><Th>Person</Th><Th>Last sign-in</Th><Th>Suggestion</Th><Th align="right">Decision</Th></THead>
        <tbody>
          {scoped.slice(0, limit).map((p) => {
            const sug = SUGGESTION_META[suggestions[p.id]]
            const dec = decisions[p.id]
            return (
              <Tr key={p.id}>
                <Td>
                  <div className="text-gray-200">{p.name}</div>
                  <div className="text-[11px] text-gray-500">{p.role || 'No role'}, {p.rules} personal {p.rules === 1 ? 'rule' : 'rules'}</div>
                </Td>
                <Td nowrap><span className="text-xs text-gray-400">{fmtLast(p)}</span></Td>
                <Td><Badge tone={sug?.tone}>{sug?.label}</Badge></Td>
                <Td align="right">
                  <span className="inline-flex rounded-md border border-gray-800 overflow-hidden" role="group" aria-label={`Decision for ${p.name}`}>
                    {[['keep', 'Keep'], ['edit', 'Edit'], ['remove', 'Remove']].map(([k, label]) => (
                      <button key={k} type="button" aria-pressed={dec === k} onClick={() => setOne(p.id, k)}
                        className={`px-2 py-1 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
                          dec === k ? (k === 'remove' ? 'bg-red-500/20 text-red-300' : 'bg-orange-500/20 text-orange-300') : 'text-gray-400 hover:text-gray-200'}`}>
                        {label}
                      </button>
                    ))}
                  </span>
                </Td>
              </Tr>
            )
          })}
        </tbody>
      </Table>
      {scoped.length > limit && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Showing {limit} of {scoped.length}.</span>
          <Btn size="xs" onClick={() => setLimit((l) => l + PAGE * 4)}>Show more</Btn>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-gray-300 mb-1.5">Bulk</p>
        <div className="flex flex-wrap gap-2">
          <Btn size="sm" onClick={keepActive} disabled={!activeIds.length}>Keep all {activeIds.length} active in {summary?.idleDays ?? 30} days</Btn>
          <Btn size="sm" disabled title="Locking the Drivers who never signed in waits on an owner decision">Lock all {neverDrivers} Drivers never signed in</Btn>
          <Badge tone="warning">Needs owner decision</Badge>
        </div>
        <p className="text-[11px] text-gray-500 mt-1">Bulk actions only fill in decisions. Nothing happens until Start review, and nothing is locked until the review is applied.</p>
      </div>

      <ImpactBox tone="info"
        what="This review has not started. No review has been completed before."
        change="Starting takes a snapshot of every approved person and records your decisions on it as evidence. Nobody is locked or changed yet."
        who={`Only people you mark Remove are locked, and only when you apply the review on Access Reviews (${counts.remove} marked now). Admins are never suggested for removal.`}
        undo="Yes. Decisions can change until the review is applied. A person locked by a review can be unlocked from Users with the same access." />

      <label className="block">
        <span className="block text-[11px] font-semibold text-gray-400 mb-1">Reason (goes to the audit log)</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="For example: quarterly access review"
          className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500" />
      </label>
      {notice && <Note icon={Info}>{notice}</Note>}
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
    </Drawer>
  )
}

export default function UnusedAccess({ onGoTab }) {
  const [state, setState] = useState({ loading: true, error: null, data: null })
  const [drawer, setDrawer] = useState(null) // scope or null
  const [flash, setFlash] = useState(null)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try { setState({ loading: false, error: null, data: shapeUnusedSummary(await getAccessUnusedSummary()) }) } catch (e) {
      setState({ loading: false, error: toUserMessage(e, 'Unused access could not be read.'), data: null })
    }
  }, [])
  useEffect(() => { load() }, [load])

  const s = state.data
  const kpis = unusedKpis(s) || []
  const findings = unusedFindings(s)

  const act = (f) => {
    if (f.action === 'review_never') setDrawer('never')
    else if (f.action === 'review_idle') setDrawer('idle')
    else if (f.action === 'end_dates') onGoTab?.('people')
    else if (f.action === 'roles') onGoTab?.('custom')
  }
  const ACTION_LABEL = { review_never: 'Include in a review', review_idle: 'Include in a review', end_dates: 'Add end dates', roles: 'Review roles' }

  return (
    <Panel>
      <PanelHeader icon={UserX} title="Unused and risky access"
        subtitle="Read live from sign-in dates and saved rules. Nothing changes until you decide."
        actions={<Btn variant="primary" icon={ClipboardCheck} disabled={!s} onClick={() => setDrawer('all')}>Start a review with these</Btn>} />
      {flash && <div className="mb-3"><Note icon={Info} tone="accent">{flash} <Link className="underline" to="/console/access-reviews">Open Access Reviews</Link></Note></div>}
      {state.loading ? <LoadingState label="Reading sign-in dates" rows={3} /> : state.error ? <ErrorState message={state.error} onRetry={load} /> : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-px rounded-lg overflow-hidden border border-gray-800 bg-gray-800">
            {kpis.map((k) => (
              <div key={k.key} className="bg-gray-900/70 px-3 py-2.5 min-w-0">
                <p className="text-[11px] text-gray-500">{k.label}</p>
                <p className="text-lg font-semibold text-gray-100 tabular-nums">{k.value === null || k.value === undefined ? 'N/A' : k.value}</p>
                <p className="text-[10px] text-gray-500 truncate" title={k.sub}>{k.sub}</p>
              </div>
            ))}
          </div>
          <ul className="divide-y divide-gray-800 rounded-lg border border-gray-800">
            {findings.map((f) => {
              const Icon = FINDING_ICON[f.key] || Info
              return (
                <li key={f.key} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <Icon size={14} className={f.tone === 'danger' ? 'text-red-400' : f.tone === 'warning' ? 'text-amber-400' : 'text-gray-400'} aria-hidden="true" />
                  <div className="flex-1 min-w-[12rem]">
                    <p className="text-sm font-semibold text-gray-200">{f.title}</p>
                    {f.detail && <p className="text-[11px] text-gray-500">{f.detail}</p>}
                  </div>
                  <span className="text-[11px] text-gray-400">Suggested: {f.suggestion}</span>
                  {f.na ? <Badge tone="quiet">N/A</Badge> : f.action && <Btn size="xs" onClick={() => act(f)}>{ACTION_LABEL[f.action]}</Btn>}
                </li>
              )
            })}
          </ul>
          <ImpactBox tone="warning"
            what={`${s?.never ?? 'N/A'} approved accounts have never been used, and ${s && s.rulesTotal ? `${(s.rulesTotal - (s.rulesWithEnd || 0))} of ${s.rulesTotal}` : 'N/A'} personal rules never end.`}
            change="A review lists these people with a suggested decision. You keep, change or remove each one; nothing is removed until you apply the review."
            who={`Up to ${s ? (s.never || 0) + (s.idle || 0) : 'N/A'} people (${s?.never ?? 'N/A'} never signed in, ${s?.idle ?? 'N/A'} idle). Admins are never auto-suggested for removal.`}
            undo="Yes. A removed person is locked, not deleted; unlocking restores the same access." />
          <p className="text-[11px] text-gray-500 flex items-start gap-1.5">
            <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            Suggestions are a hint for the reviewer, never an automatic change. Unused areas inside a role need page-view logging first.
          </p>
        </div>
      )}
      <ReviewDrawer open={!!drawer} initialScope={drawer || 'all'} summary={s} onClose={() => setDrawer(null)}
        onStarted={(msg) => { setFlash(msg); load() }} />
    </Panel>
  )
}
