/**
 * Driver Concerns inbox (web). Who sees what is decided by the database:
 * the fleet pool (Supervisor / Foreman / Incharge) never receives a sensitive
 * case; HR Officer, Manager and Admin do. This page only offers the actions the
 * server will accept (lib/driverConcerns.allowedActions) and reloads on a stale
 * write (PT409).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { MessageSquare, ShieldAlert, AlertTriangle, Clock, FileDown, Link2 } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import SideDrawer from '../components/ui/SideDrawer'
import { useLanguage } from '../contexts/LanguageContext'
import { useAuth } from '../contexts/AuthContext'
import { toUserMessage } from '../lib/safeError'
import {
  CATEGORIES, LANG_NAMES, LEVELS, STATUSES,
  allowedActions, deadlineState, filterConcerns, hoursLeft, isTerminal,
  sortInbox, summarize,
} from '../lib/driverConcerns'
import {
  listConcerns, getConcern, concernCommand, isStale,
  setConcernPdf, signedPhotoUrl,
} from '../lib/api/driverConcerns'

const TONE = { overdue: 'var(--danger, #dc2626)', due_soon: 'var(--warning, #d97706)', ok: 'var(--success, #16a34a)' }

function DeadlineCell({ row, t }) {
  const state = deadlineState(row)
  if (!state) return <span className="text-xs" style={{ color: 'var(--text-dim)' }}>{t('driverConcerns.deadline.none')}</span>
  const h = hoursLeft(row)
  return (
    <span className="text-xs font-medium" style={{ color: TONE[state] }}>
      {t(`driverConcerns.deadline.${state}`)}
      {h !== null && <> · {h >= 0 ? t('driverConcerns.deadline.left', { n: h }) : t('driverConcerns.deadline.over', { n: -h })}</>}
    </span>
  )
}

function Chip({ children, tone }) {
  return <span className="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium me-1" style={{ background: 'var(--surface-raised, rgba(0,0,0,0.06))', color: tone || 'var(--text-secondary)' }}>{children}</span>
}

export default function DriverConcerns() {
  const { t, language } = useLanguage()
  const [state, setState] = useState({ loading: true, rows: [], error: null, notSetUp: false })
  const [filters, setFilters] = useState({ search: '', status: 'open', category: 'all', level: 'all', deadline: 'all', sensitive: 'all' })
  const [openId, setOpenId] = useState(null)

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }))
    try {
      const { rows, notProvisioned } = await listConcerns()
      setState({ loading: false, rows, error: null, notSetUp: notProvisioned })
    } catch (e) {
      setState({ loading: false, rows: [], error: toUserMessage(e, t('driverConcerns.loadError')), notSetUp: false })
    }
  }, [t])
  useEffect(() => { load() }, [load])

  const visible = useMemo(() => sortInbox(filterConcerns(state.rows, filters)), [state.rows, filters])
  const kpi = useMemo(() => summarize(state.rows), [state.rows])
  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }))

  const columns = useMemo(() => [
    { accessorKey: 'case_no', header: t('driverConcerns.columns.case'), cell: ({ row }) => (
      <span className="font-mono text-xs">
        {row.original.case_no}
        {row.original.sensitive && <ShieldAlert className="inline w-3.5 h-3.5 ms-1" aria-label={t('driverConcerns.badge.sensitive')} />}
      </span>) },
    { accessorKey: 'driver_name', header: t('driverConcerns.columns.driver'), cell: ({ row }) => row.original.driver_name || row.original.driver_code || '-' },
    { id: 'category', header: t('driverConcerns.columns.category'), accessorFn: r => `${r.category} ${r.subtype}`, cell: ({ row }) => (
      <span>{t(`driverConcerns.categories.${row.original.category}`)} · <span style={{ color: 'var(--text-secondary)' }}>{t(`driverConcerns.subtypes.${row.original.subtype}`)}</span></span>) },
    { accessorKey: 'level', header: t('driverConcerns.columns.level'), cell: ({ row }) => (
      <span>
        {t(`driverConcerns.levels.${row.original.level}`)}
        {row.original.escalation_count > 0 && <Chip tone="var(--warning, #d97706)">{t('driverConcerns.badge.escalated', { n: row.original.escalation_count })}</Chip>}
      </span>) },
    { accessorKey: 'status', header: t('driverConcerns.columns.status'), cell: ({ row }) => (
      <span>
        {t(`driverConcerns.statuses.${row.original.status}`)}
        {row.original.entered_verbally && <Chip>{t('driverConcerns.badge.verbal')}</Chip>}
        {row.original.duplicate_of && <Chip>{t('driverConcerns.badge.duplicate')}</Chip>}
      </span>) },
    { id: 'deadline', header: t('driverConcerns.columns.deadline'), accessorFn: r => r.due_at || '', cell: ({ row }) => <DeadlineCell row={row.original} t={t} /> },
    { accessorKey: 'site', header: t('driverConcerns.columns.site'), cell: ({ row }) => [row.original.site, row.original.country].filter(Boolean).join(', ') || '-' },
    { accessorKey: 'created_at', header: t('driverConcerns.columns.raised'), cell: ({ row }) => String(row.original.created_at || '').slice(0, 10) },
  ], [t])

  const select = (key, options) => (
    <label className="text-xs flex flex-col gap-1">
      <span style={{ color: 'var(--text-secondary)' }}>{t(`driverConcerns.filters.${key}`)}</span>
      <select className="input text-sm" value={filters[key]} onChange={e => set(key, e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
  const all = ['all', t('driverConcerns.filters.all')]

  return (
    <div className="space-y-4">
      <PageHeader title={t('driverConcerns.title')} subtitle={t('driverConcerns.subtitle')} icon={MessageSquare} onRefresh={load} refreshing={state.loading} />
      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('driverConcerns.voiceSoon')}</p>

      {state.notSetUp && <div className="card p-4 text-sm">{t('driverConcerns.notSetUp')}</div>}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[['open', kpi.open, Clock], ['overdue', kpi.overdue, AlertTriangle], ['awaitingApproval', kpi.awaitingApproval, Clock], ['awaitingDriver', kpi.awaitingDriver, Clock], ['sensitive', kpi.sensitive, ShieldAlert]].map(([k, v, Icon]) => (
          <button type="button" key={k} className="card p-3 text-start"
            onClick={() => {
              if (k === 'overdue') setFilters(f => ({ ...f, status: 'open', deadline: 'overdue' }))
              else if (k === 'awaitingApproval') setFilters(f => ({ ...f, status: 'proposed', deadline: 'all' }))
              else if (k === 'awaitingDriver') setFilters(f => ({ ...f, status: 'outcome_shared', deadline: 'all' }))
              else if (k === 'sensitive') setFilters(f => ({ ...f, status: 'open', sensitive: 'yes' }))
              else setFilters(f => ({ ...f, status: 'open', deadline: 'all', sensitive: 'all' }))
            }}>
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}><Icon className="w-4 h-4" />{t(`driverConcerns.kpi.${k}`)}</div>
            <div className="text-2xl font-semibold mt-1">{state.loading ? '...' : v}</div>
          </button>
        ))}
      </div>

      <div className="card p-3 flex flex-wrap gap-3 items-end">
        <label className="text-xs flex flex-col gap-1 flex-1 min-w-[200px]">
          <span style={{ color: 'var(--text-secondary)' }}>{t('driverConcerns.search')}</span>
          <input className="input text-sm" value={filters.search} onChange={e => set('search', e.target.value)} />
        </label>
        {select('status', [all, ['open', t('driverConcerns.filters.open')], ['closed', t('driverConcerns.filters.closed')], ...STATUSES.map(s => [s, t(`driverConcerns.statuses.${s}`)])])}
        {select('category', [all, ...CATEGORIES.map(c => [c.key, t(`driverConcerns.categories.${c.key}`)])])}
        {select('level', [all, ...LEVELS.map(l => [l, t(`driverConcerns.levels.${l}`)])])}
        {select('deadline', [all, ...['overdue', 'due_soon', 'ok'].map(d => [d, t(`driverConcerns.deadline.${d}`)])])}
        {select('sensitive', [all, ['yes', t('driverConcerns.filters.yes')], ['no', t('driverConcerns.filters.no')]])}
        <button type="button" className="btn-secondary text-sm" onClick={() => setFilters({ search: '', status: 'all', category: 'all', level: 'all', deadline: 'all', sensitive: 'all' })}>{t('driverConcerns.clear')}</button>
      </div>

      <EnterpriseTable
        columns={columns}
        data={visible}
        getRowId={r => r.id}
        loading={state.loading}
        error={state.error}
        onRetry={load}
        emptyMessage={state.rows.length ? t('driverConcerns.emptyFiltered') : t('driverConcerns.empty')}
        enableGlobalFilter={false}
        exportFileName="Driver concerns"
        onRowClick={r => setOpenId(r.id)}
        viewKey="driverConcerns.inbox"
      />

      {openId && <ConcernDrawer id={openId} t={t} language={language} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  )
}

function ConcernDrawer({ id, t, language, onClose, onChanged }) {
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [note, setNote] = useState('')
  const [noteVisible, setNoteVisible] = useState(false)
  const [proposal, setProposal] = useState('')
  const [linkCase, setLinkCase] = useState('')
  const [linkKind, setLinkKind] = useState('related')
  const [photoUrls, setPhotoUrls] = useState([])

  const reload = useCallback(async () => {
    setError(null)
    try {
      const d = await getConcern(id)
      setDetail(d)
    } catch (e) {
      setError(toUserMessage(e, t('driverConcerns.drawer.loadError')))
    }
  }, [id, t])
  useEffect(() => { reload() }, [reload])

  const c = detail?.concern
  useEffect(() => {
    let live = true
    Promise.all((c?.photos || []).map(p => signedPhotoUrl(p))).then(urls => { if (live) setPhotoUrls(urls.filter(Boolean)) })
    return () => { live = false }
  }, [c?.photos])

  const { user } = useAuth()
  const actions = useMemo(() => allowedActions(c, { rank: detail?.my_rank || 0, isDriver: detail?.is_driver, userId: user?.id || null }), [c, detail, user?.id])

  const run = async (action, payload = {}) => {
    setBusy(true); setMsg(null)
    try {
      await concernCommand(id, action, payload, c?.version ?? null)
      setMsg(t('driverConcerns.drawer.done'))
      setNote(''); setProposal(''); setLinkCase('')
      await reload(); onChanged?.()
    } catch (e) {
      if (isStale(e)) { setMsg(t('driverConcerns.drawer.stale')); await reload() }
      else setMsg(toUserMessage(e, t('driverConcerns.drawer.loadError')))
    } finally { setBusy(false) }
  }

  const pdf = async () => {
    setBusy(true)
    try {
      const { renderDriverConcernPdf } = await import('../lib/driverConcernPdf')
      const labels = {
        category: v => t(`driverConcerns.categories.${v}`),
        subtype: v => t(`driverConcerns.subtypes.${v}`),
        status: v => t(`driverConcerns.statuses.${v}`),
        event: v => t(`driverConcerns.events.${v}`),
      }
      const { sha256 } = await renderDriverConcernPdf(detail, { labels })
      await setConcernPdf(id, sha256)
      setMsg(t('driverConcerns.drawer.pdfSaved'))
      await reload()
    } catch (e) { setMsg(toUserMessage(e, t('driverConcerns.drawer.loadError'))) }
    finally { setBusy(false) }
  }

  const linkTarget = async () => {
    // The target must be a case the caller can see; resolve the case number via RLS.
    const { supabase } = await import('../lib/supabase')
    const { data } = await supabase.from('driver_concerns').select('id').eq('case_no', linkCase.trim().toUpperCase()).maybeSingle()
    if (!data?.id) { setMsg(t('driverConcerns.drawer.loadError')); return }
    run('link', { target_id: data.id, kind: linkKind })
  }

  const can = a => actions.has(a)

  return (
    <SideDrawer open onClose={onClose} size="lg" busy={busy}
      title={c?.case_no || '...'}
      subtitle={c ? `${t(`driverConcerns.categories.${c.category}`)} · ${t(`driverConcerns.subtypes.${c.subtype}`)} · ${detail?.driver_name || ''}` : ''}>
      {error && <div className="text-sm" role="alert">{error} <button type="button" className="underline" onClick={reload}>{t('driverConcerns.retry')}</button></div>}
      {!c && !error && <div className="text-sm">...</div>}
      {c && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-1">
            <Chip>{t(`driverConcerns.statuses.${c.status}`)}</Chip>
            <Chip>{t(`driverConcerns.levels.${c.level}`)}</Chip>
            {c.sensitive && <Chip tone="var(--danger, #dc2626)">{t('driverConcerns.badge.sensitive')}</Chip>}
            {!isTerminal(c) && <DeadlineCell row={c} t={t} />}
          </div>
          {c.entered_verbally && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('driverConcerns.drawer.verbal')}</p>}
          {detail.chain_ok === false && <p className="text-xs" role="alert" style={{ color: 'var(--danger, #dc2626)' }}>{t('driverConcerns.drawer.chainBroken')}</p>}

          <section>
            <h3 className="font-semibold mb-1">{t('driverConcerns.drawer.original')}</h3>
            <p className="whitespace-pre-wrap" dir="auto">{c.original_text}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>{t('driverConcerns.drawer.originalLang', { lang: LANG_NAMES[c.original_lang] || '?' })}</p>
          </section>


          <section>
            <h3 className="font-semibold mb-1">{t('driverConcerns.drawer.photos')}</h3>
            {photoUrls.length ? <div className="flex gap-2 flex-wrap">{photoUrls.map(u => <a key={u} href={u} target="_blank" rel="noopener noreferrer"><img src={u} alt="" className="w-24 h-24 object-cover rounded" /></a>)}</div>
              : <p className="text-xs" style={{ color: 'var(--text-dim)' }}>{t('driverConcerns.drawer.noPhotos')}</p>}
          </section>

          {c.proposed_solution && (
            <section><h3 className="font-semibold mb-1">{t('driverConcerns.drawer.proposal')}</h3><p className="whitespace-pre-wrap" dir="auto">{c.proposed_solution}</p></section>
          )}
          {c.outcome_text && (
            <section>
              <h3 className="font-semibold mb-1">{t('driverConcerns.drawer.outcome')}</h3>
              <p className="whitespace-pre-wrap" dir="auto">{c.outcome_text}</p>
              {c.outcome_seen_at && <p className="text-xs mt-1">{t('driverConcerns.drawer.seen', { at: String(c.outcome_seen_at).slice(0, 16).replace('T', ' ') })}</p>}
            </section>
          )}
          {c.driver_decision && (
            <section>
              <h3 className="font-semibold mb-1">{t('driverConcerns.drawer.decision')}: {t(`driverConcerns.statuses.${c.driver_decision}`)}</h3>
              {c.signed_at && <p className="text-xs">{t('driverConcerns.drawer.signed', { at: String(c.signed_at).slice(0, 16).replace('T', ' ') })}</p>}
              {c.driver_signature?.startsWith('data:image/') && <img src={c.driver_signature} alt="" className="h-16 mt-1 bg-white rounded" />}
            </section>
          )}
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('driverConcerns.drawer.labourOffice')}</p>

          <section className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {can('acknowledge') && <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={() => run('acknowledge')}>{t('driverConcerns.drawer.acknowledge')}</button>}
              {can('escalate') && <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={() => run('escalate')}>{t('driverConcerns.drawer.escalate')}</button>}
              {can('approve') && <button type="button" className="btn-primary text-sm" disabled={busy} onClick={() => run('approve')}>{t('driverConcerns.drawer.approve')}</button>}
              {can('return') && <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={() => run('return', { text: note })}>{t('driverConcerns.drawer.return')}</button>}
              {can('reclassify') && <button type="button" className="btn-secondary text-sm" disabled={busy}
                onClick={() => { if (window.confirm(t('driverConcerns.drawer.reclassifyConfirm'))) run('reclassify') }}>
                <ShieldAlert className="inline w-4 h-4 me-1" />{t('driverConcerns.drawer.reclassify')}</button>}
              {isTerminal(c) && detail.my_rank > 0 && <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={pdf}><FileDown className="inline w-4 h-4 me-1" />{t('driverConcerns.pdf')}</button>}
            </div>
            {!isTerminal(c) && detail.my_rank > 0 && <p className="text-xs" style={{ color: 'var(--text-dim)' }}>{t('driverConcerns.drawer.pdfOnlyClosed')}</p>}

            {can('propose') && (
              <div className="space-y-1">
                <textarea className="input w-full text-sm" rows={3} value={proposal} onChange={e => setProposal(e.target.value)} placeholder={t('driverConcerns.drawer.proposePlaceholder')} dir="auto" />
                <button type="button" className="btn-primary text-sm" disabled={busy || !proposal.trim()} onClick={() => run('propose', { text: proposal, lang: language })}>{t('driverConcerns.drawer.propose')}</button>
              </div>
            )}
            {can('note') && (
              <div className="space-y-1">
                <textarea className="input w-full text-sm" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder={t('driverConcerns.drawer.notePlaceholder')} dir="auto" />
                <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={noteVisible} onChange={e => setNoteVisible(e.target.checked)} />{t('driverConcerns.drawer.visibleToDriver')}</label>
                <button type="button" className="btn-secondary text-sm" disabled={busy || !note.trim()} onClick={() => run('note', { text: note, lang: language, visible_to_driver: noteVisible })}>{t('driverConcerns.drawer.addNote')}</button>
              </div>
            )}
            {can('link') && (
              <div className="flex gap-2 items-center flex-wrap">
                <Link2 className="w-4 h-4" />
                <input className="input text-sm" value={linkCase} onChange={e => setLinkCase(e.target.value)} placeholder={t('driverConcerns.drawer.linkPlaceholder')} aria-label={t('driverConcerns.drawer.link')} />
                <select className="input text-sm" value={linkKind} onChange={e => setLinkKind(e.target.value)}>
                  <option value="related">{t('driverConcerns.drawer.related')}</option>
                  <option value="duplicate">{t('driverConcerns.drawer.duplicate')}</option>
                </select>
                <button type="button" className="btn-secondary text-sm" disabled={busy || !linkCase.trim()} onClick={linkTarget}>{t('driverConcerns.drawer.link')}</button>
              </div>
            )}
            {msg && <p className="text-xs" role="status">{msg}</p>}
          </section>

          <section>
            <h3 className="font-semibold mb-2">{t('driverConcerns.drawer.timeline')}</h3>
            <ol className="space-y-2">
              {(detail.events || []).map(e => (
                <li key={e.id} className="border-s-2 ps-3" style={{ borderColor: 'var(--border-subtle, #e5e7eb)' }}>
                  <div className="text-xs" style={{ color: 'var(--text-dim)' }}>{String(e.created_at).slice(0, 16).replace('T', ' ')} · {e.actor_role || ''}</div>
                  <div className="font-medium">{t(`driverConcerns.events.${e.event_type}`)}</div>
                  {e.note && <div className="whitespace-pre-wrap" dir="auto">{e.note}</div>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </SideDrawer>
  )
}
