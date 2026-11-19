/**
 * Physical audits: create (scope, counter, reviewer, due date), start (the
 * server takes the snapshot and cutoff), blind counting, reviewer
 * reconciliation, recount, then adjustment approval in Discrepancies.
 *
 * Role views are decided by `availableActions` (auditView.js): a counter only
 * ever gets the blind count screen for their own audit, never reconcile or
 * approve. The inv_* RPCs enforce the same rules server-side.
 */
import { useEffect, useMemo, useState } from 'react'
import { Plus, Play, CheckCircle2, XCircle, ClipboardList, Calculator, Scale } from 'lucide-react'
import Modal from '../ui/Modal'
import SideDrawer from '../ui/SideDrawer'
import DateField from '../ui/DateField'
import { useLanguage } from '../../contexts/LanguageContext'
import {
  listAudits, createAudit, startAudit, closeAudit, cancelAudit, listAssignablePeople, newIdempotencyKey,
} from '../../lib/api/inventory'
import {
  AUDIT_TYPES, AUDIT_STATUSES, AUDIT_STATUS_TONE, validateAuditDraft, availableActions, auditRolesFor,
} from '../../lib/inventory/auditView'
import { toUserMessage } from '../../lib/safeError'
import { useInvQuery, PagedTable, Field, ErrorNote, Note, StatusPill, fmtDate, fmtDateTime } from './InvUi'
import AuditCounterView from './AuditCounterView'
import AuditReconciliation from './AuditReconciliation'

const EMPTY = { audit_type: 'cycle', site: '', counter_id: '', reviewer_id: '', approver_id: '', due_at: '', instructions: '', high_value_only: false }

export default function AuditsSection({ scope, can, userId, onNavigate }) {
  const { t } = useLanguage()
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [status, setStatus] = useState('open')
  const [mine, setMine] = useState(false)
  const [creating, setCreating] = useState(null)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(null)
  const [mode, setMode] = useState('details')
  const [people, setPeople] = useState([])
  const [peopleErr, setPeopleErr] = useState('')

  const q = useInvQuery(() => listAudits({ ...scope, page, pageSize, status, mine, userId }),
    [scope.country, scope.site, page, pageSize, status, mine, userId])

  useEffect(() => {
    let live = true
    listAssignablePeople().then((p) => { if (live) setPeople(p) }).catch((e) => { if (live) setPeopleErr(toUserMessage(e)) })
    return () => { live = false }
  }, [])
  const nameOf = useMemo(() => {
    const m = new Map(people.map((p) => [p.id, p.full_name || p.username]))
    return (id) => (id ? m.get(id) || t('inventory.common.unknownPerson') : t('inventory.common.notAssigned'))
  }, [people, t])

  const columns = [
    { key: 'ref', header: t('inventory.audits.ref'), cell: (a) => <span className="inv-mono">{a.ref || a.id?.slice(0, 8)}</span> },
    { key: 'audit_type', header: t('inventory.audits.type'), cell: (a) => t(`inventory.auditTypes.${a.audit_type}`) },
    { key: 'site', header: t('inventory.scope.site'), cell: (a) => a.site || <span className="cc-na">N/A</span> },
    { key: 'status', header: t('inventory.common.status'), cell: (a) => <StatusPill value={a.status} tone={AUDIT_STATUS_TONE[a.status]} label={t(`inventory.auditStatus.${a.status}`)} /> },
    { key: 'counter_id', header: t('inventory.audits.counter'), cell: (a) => nameOf(a.counter_id) },
    { key: 'reviewer_id', header: t('inventory.audits.reviewer'), cell: (a) => nameOf(a.reviewer_id) },
    { key: 'due_at', header: t('inventory.audits.due'), cell: (a) => fmtDate(a.due_at) },
  ]

  const openCreate = () => {
    setErrors({}); setErr('')
    setCreating({ draft: { ...EMPTY, site: scope.site !== 'all' ? scope.site : '' }, key: newIdempotencyKey() })
  }
  const set = (k) => (v) => setCreating((c) => ({ ...c, draft: { ...c.draft, [k]: v } }))

  const submit = async () => {
    const v = validateAuditDraft(creating.draft)
    setErrors(v.errors)
    if (!v.ok) return
    setBusy(true); setErr('')
    try {
      await createAudit({ ...creating.draft, country: scope.country }, creating.key)
      setCreating(null); q.retry()
    } catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false) }
  }

  const act = async (fn) => {
    setBusy(true); setErr('')
    try { await fn(newIdempotencyKey()); setOpen(null); q.retry() } catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false) }
  }

  const actions = open ? availableActions(open, userId, can) : []
  const roles = open ? [...auditRolesFor(open, userId)] : []

  return (
    <div className="inv-hub">
      <div className="cc-filters">
        <label className="cc-field">
          <span>{t('inventory.common.status')}</span>
          <select className="cc-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}>
            <option value="open">{t('inventory.audits.openOnly')}</option>
            <option value="all">{t('inventory.common.all')}</option>
            {AUDIT_STATUSES.map((s) => <option key={s} value={s}>{t(`inventory.auditStatus.${s}`)}</option>)}
          </select>
        </label>
        <label className="inv-check">
          <input type="checkbox" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(0) }} /> {t('inventory.audits.mine')}
        </label>
        {can('audit_create') && (
          <button type="button" className="cc-btn-primary" onClick={openCreate}><Plus size={14} aria-hidden="true" /> {t('inventory.audits.new')}</button>
        )}
      </div>
      <Note>{t('inventory.audits.howItWorks')}</Note>
      <PagedTable query={q} columns={columns} page={page} pageSize={pageSize} onPage={setPage}
        onPageSize={(s) => { setPageSize(s); setPage(0) }} empty={t('inventory.audits.empty')}
        what={t('inventory.objects.inventory_audits')} noun={t('inventory.audits.noun')}
        onRowClick={(a) => { setOpen(a); setMode('details'); setErr('') }} />

      <Modal open={!!creating} onClose={() => !busy && setCreating(null)} size="lg" title={t('inventory.audits.newTitle')}
        subtitle={t('inventory.audits.newSub')}
        footer={(
          <div className="inv-actions">
            <button type="button" className="cc-btn-ghost" onClick={() => setCreating(null)} disabled={busy}>{t('inventory.actions.cancel')}</button>
            <button type="button" className="cc-btn-primary" onClick={submit} disabled={busy}>{busy ? t('inventory.actions.saving') : t('inventory.audits.create')}</button>
          </div>
        )}>
        {creating && (
          <div className="inv-form">
            <Field label={t('inventory.audits.type')} error={errors.audit_type && t(errors.audit_type)}>
              <select className="cc-select" value={creating.draft.audit_type} onChange={(e) => set('audit_type')(e.target.value)}>
                {AUDIT_TYPES.map((ty) => <option key={ty} value={ty}>{t(`inventory.auditTypes.${ty}`)}</option>)}
              </select>
            </Field>
            <Field label={t('inventory.scope.site')} error={errors.site && t(errors.site)}>
              <input className="inv-input" value={creating.draft.site} onChange={(e) => set('site')(e.target.value)} maxLength={80} />
            </Field>
            <Field label={t('inventory.audits.counter')} error={errors.counter_id && t(errors.counter_id)}>
              <select className="cc-select" value={creating.draft.counter_id} onChange={(e) => set('counter_id')(e.target.value)}>
                <option value="">{t('inventory.common.choose')}</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.username} ({p.role})</option>)}
              </select>
            </Field>
            <Field label={t('inventory.audits.reviewer')} error={errors.reviewer_id && t(errors.reviewer_id)}>
              <select className="cc-select" value={creating.draft.reviewer_id} onChange={(e) => set('reviewer_id')(e.target.value)}>
                <option value="">{t('inventory.common.choose')}</option>
                {people.filter((p) => p.id !== creating.draft.counter_id).map((p) => <option key={p.id} value={p.id}>{p.full_name || p.username} ({p.role})</option>)}
              </select>
            </Field>
            <Field label={t('inventory.audits.approver')}>
              <select className="cc-select" value={creating.draft.approver_id} onChange={(e) => set('approver_id')(e.target.value)}>
                <option value="">{t('inventory.audits.approverPolicy')}</option>
                {people.filter((p) => p.id !== creating.draft.counter_id && p.id !== userId).map((p) => <option key={p.id} value={p.id}>{p.full_name || p.username} ({p.role})</option>)}
              </select>
            </Field>
            <Field label={t('inventory.audits.due')} error={errors.due_at && t(errors.due_at)}>
              <DateField value={creating.draft.due_at} onChange={set('due_at')} />
            </Field>
            <label className="inv-check inv-full">
              <input type="checkbox" checked={creating.draft.high_value_only} onChange={(e) => set('high_value_only')(e.target.checked)} /> {t('inventory.audits.highValueOnly')}
            </label>
            <Field label={t('inventory.audits.instructions')} error={errors.instructions && t(errors.instructions)} full>
              <textarea className="inv-input" value={creating.draft.instructions} maxLength={2000} onChange={(e) => set('instructions')(e.target.value)} />
            </Field>
            {peopleErr && <div className="inv-full"><ErrorNote error={peopleErr} /></div>}
            {err && <div className="inv-full"><ErrorNote error={err} /></div>}
          </div>
        )}
      </Modal>

      <SideDrawer open={!!open} onClose={() => setOpen(null)} busy={busy} size="xl"
        title={open ? `${t('inventory.audits.audit')} ${open.ref || open.id?.slice(0, 8)}` : ''}
        subtitle={open ? `${t(`inventory.auditTypes.${open.audit_type}`)} | ${open.site || ''}` : ''}
        closeLabel={t('inventory.actions.close')}>
        {open && (
          <div className="inv-hub" style={{ gap: 12 }}>
            <div className="inv-actions" role="toolbar" aria-label={t('inventory.audits.actionsLabel')}>
              <button type="button" className={mode === 'details' ? 'cc-btn-primary' : 'cc-btn-ghost'} onClick={() => setMode('details')}><ClipboardList size={14} aria-hidden="true" /> {t('inventory.audits.details')}</button>
              {actions.includes('count') && <button type="button" className={mode === 'count' ? 'cc-btn-primary' : 'cc-btn-ghost'} onClick={() => setMode('count')}><ClipboardList size={14} aria-hidden="true" /> {t('inventory.audits.countNow')}</button>}
              {actions.includes('reconcile') && <button type="button" className={mode === 'reconcile' ? 'cc-btn-primary' : 'cc-btn-ghost'} onClick={() => setMode('reconcile')}><Calculator size={14} aria-hidden="true" /> {t('inventory.audits.reconcile')}</button>}
              {actions.includes('start') && <button type="button" className="cc-btn-ghost" disabled={busy} onClick={() => act((k) => startAudit(open.id, k))}><Play size={14} aria-hidden="true" /> {t('inventory.audits.start')}</button>}
              {actions.includes('approve') && <button type="button" className="cc-btn-ghost" onClick={() => onNavigate('discrepancies')}><Scale size={14} aria-hidden="true" /> {t('inventory.audits.toApproval')}</button>}
              {actions.includes('close') && <button type="button" className="cc-btn-ghost" disabled={busy} onClick={() => act((k) => closeAudit(open.id, k))}><CheckCircle2 size={14} aria-hidden="true" /> {t('inventory.audits.close')}</button>}
              {actions.includes('cancel') && <button type="button" className="cc-btn-ghost" disabled={busy} onClick={() => act((k) => cancelAudit(open.id, 'Cancelled from web', k))}><XCircle size={14} aria-hidden="true" /> {t('inventory.audits.cancel')}</button>}
            </div>
            {err && <ErrorNote error={err} />}
            {mode === 'details' && (
              <>
                <dl className="inv-dl">
                  <dt>{t('inventory.common.status')}</dt><dd><StatusPill value={open.status} tone={AUDIT_STATUS_TONE[open.status]} label={t(`inventory.auditStatus.${open.status}`)} /></dd>
                  <dt>{t('inventory.audits.counter')}</dt><dd>{nameOf(open.counter_id)}</dd>
                  <dt>{t('inventory.audits.reviewer')}</dt><dd>{nameOf(open.reviewer_id)}</dd>
                  <dt>{t('inventory.audits.approver')}</dt><dd>{open.approver_id ? nameOf(open.approver_id) : t('inventory.audits.approverPolicy')}</dd>
                  <dt>{t('inventory.audits.due')}</dt><dd>{fmtDate(open.due_at)}</dd>
                  <dt>{t('inventory.audits.snapshot')}</dt><dd>{open.snapshot_at ? fmtDateTime(open.snapshot_at) : t('inventory.audits.noSnapshot')}</dd>
                  <dt>{t('inventory.audits.yourRole')}</dt><dd>{roles.length ? roles.map((r) => t(`inventory.roles.${r}`)).join(', ') : t('inventory.roles.none')}</dd>
                  <dt>{t('inventory.audits.instructions')}</dt><dd>{open.instructions || <span className="cc-na">N/A</span>}</dd>
                </dl>
                {roles.includes('counter') && <Note>{t('inventory.audits.counterNote')}</Note>}
                {actions.length === 0 && <Note>{t('inventory.audits.noActions')}</Note>}
              </>
            )}
            {mode === 'count' && <AuditCounterView audit={open} round={open.status === 'recount' ? 2 : 1} onSubmitted={() => { setOpen(null); q.retry() }} />}
            {mode === 'reconcile' && <AuditReconciliation audit={open} can={can} userId={userId} people={people} onChanged={() => q.retry()} />}
          </div>
        )}
      </SideDrawer>
    </div>
  )
}
