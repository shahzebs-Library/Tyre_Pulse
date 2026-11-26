/**
 * Investigation of a scrapped-but-active tyre (20261120114000):
 * open -> investigating (assigned Tyre / PMV engineer) -> findings -> proposed
 * correction -> independent PMV Manager approval (Controls > Approvals) ->
 * closed as a decision. Nothing here changes tyre_records or the scrap marks;
 * the tyre team applies the approved correction in tyre records afterwards.
 * Each step is enforced by its RPC; this panel only offers the step that applies.
 */
import { useEffect, useMemo, useState } from 'react'
import { UserCheck, FileSearch, Send, CheckCircle2 } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import {
  getConflictCase, listAssignablePeople, assignConflictInvestigator, recordConflictFinding,
  proposeConflictCorrection, closeConflictCase, CORRECTION_ACTIONS, newIdempotencyKey,
} from '../../lib/api/inventory'
import { toUserMessage } from '../../lib/inventory/errorText'
import { investigationActions, investigatorCandidates } from '../../lib/inventory/tyreInventoryView'
import { Note, ErrorNote, StatusPill, Field, fmtDateTime } from './InvUi'

const STEP_TONE = { open: 'bad', investigating: 'warning', proposed: 'info', approved: 'good', rejected: 'muted', closed: 'muted' }
const fresh = () => ({ key: newIdempotencyKey(), busy: false, err: '' })

export default function TyreInvestigationPanel({ conflictId, who, onChanged, onNavigate }) {
  const { t } = useLanguage()
  const [row, setRow] = useState(undefined)
  const [loadErr, setLoadErr] = useState('')
  const [people, setPeople] = useState([])
  const [peopleErr, setPeopleErr] = useState('')
  const [peopleNonce, setPeopleNonce] = useState(0)
  const [nonce, setNonce] = useState(0)
  const [assign, setAssign] = useState({ investigatorId: '', note: '', ...fresh() })
  const [finding, setFinding] = useState({ note: '', ...fresh() })
  const [proposal, setProposal] = useState({ action: 'no_change', detail: '', reason: '', ...fresh() })
  const [closing, setClosing] = useState({ note: '', ...fresh() })

  useEffect(() => {
    let live = true
    setLoadErr('')
    getConflictCase(conflictId)
      .then((r) => { if (live) setRow(r) })
      .catch((e) => { if (live) { setRow(null); setLoadErr(toUserMessage(e)) } })
    return () => { live = false }
  }, [conflictId, nonce])

  const acts = investigationActions(row, who)
  useEffect(() => {
    if (!acts.assign) return undefined
    let live = true
    setPeopleErr('')
    listAssignablePeople()
      .then((p) => { if (live) setPeople(p) })
      .catch((e) => { if (live) { setPeople([]); setPeopleErr(toUserMessage(e)) } })
    return () => { live = false }
  }, [acts.assign, peopleNonce])
  const candidates = useMemo(() => investigatorCandidates(people), [people])
  const nameOf = (id) => people.find((p) => p.id === id)?.full_name || (id ? t('inventory.tyres.inv.assignedSomeone') : t('wmsfloor.common.na'))

  const refresh = () => { setNonce((n) => n + 1); onChanged?.() }
  const run = async (setter, state, call) => {
    setter((s) => ({ ...s, busy: true, err: '' }))
    try {
      await call(state.key)
      setter((s) => ({ ...s, ...fresh(), note: '', detail: '', reason: '' }))
      refresh()
    } catch (e) { setter((s) => ({ ...s, busy: false, err: toUserMessage(e) })) }
  }

  if (row === undefined) return <p className="cc-card-sub">{t('inventory.actions.searching')}</p>
  if (loadErr) return <ErrorNote error={loadErr} onRetry={() => setNonce((n) => n + 1)} />
  if (!row) return <Note tone="warn">{t('inventory.tyres.investigationRule')}</Note>

  const step = row.investigation_status || 'open'
  const notes = Array.isArray(row.investigation_notes) ? row.investigation_notes : []
  const corr = row.proposed_correction || null

  return (
    <div className="inv-hub" style={{ gap: 12 }}>
      <Note tone="warn">{t('inventory.tyres.investigationRule')}</Note>
      <dl className="inv-dl">
        <dt>{t('inventory.tyres.inv.step')}</dt>
        <dd><StatusPill value={step} tone={STEP_TONE[step]} label={t(`inventory.tyres.inv.steps.${step}`)} /></dd>
        <dt>{t('inventory.tyres.inv.investigator')}</dt><dd>{row.investigator_id ? nameOf(row.investigator_id) : t('wmsfloor.common.na')}</dd>
        <dt>{t('inventory.tyres.inv.assignedAt')}</dt><dd>{fmtDateTime(row.assigned_at)}</dd>
        {corr && (<><dt>{t('inventory.tyres.inv.proposed')}</dt>
          <dd>{t(`inventory.tyres.inv.actions.${corr.action}`)}: {corr.detail || t('wmsfloor.common.na')}</dd></>)}
        {row.approval_request_id && (<><dt>{t('inventory.tyres.inv.approval')}</dt><dd>{row.approval_status || t('wmsfloor.common.na')}</dd></>)}
      </dl>

      {notes.length > 0 && (
        <div>
          <p className="cc-card-sub">{t('inventory.tyres.inv.findings')}</p>
          <ul className="inv-list">
            {notes.map((n, i) => (
              <li key={i}>
                <span className="cc-card-sub">{fmtDateTime(n?.at)} {n?.kind === 'assigned' || n?.kind === 'finding' ? t(`inventory.tyres.inv.kinds.${n.kind}`) : ''}</span>{' '}
                {typeof n === 'object' ? (n?.note || t('wmsfloor.common.na')) : String(n)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {acts.assign && (
        <div className="inv-form">
          <Field label={t('inventory.tyres.inv.investigator')}>
            <select className="cc-select" value={assign.investigatorId} onChange={(e) => setAssign((s) => ({ ...s, investigatorId: e.target.value }))}>
              <option value="">{t('inventory.tyres.inv.choose')}</option>
              {candidates.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.username} ({p.role})</option>)}
            </select>
          </Field>
          <Field label={t('inventory.tyres.inv.note')} full>
            <textarea className="inv-input" maxLength={500} value={assign.note} onChange={(e) => setAssign((s) => ({ ...s, note: e.target.value }))} />
          </Field>
          {peopleErr
            ? <div className="inv-full"><ErrorNote error={peopleErr} onRetry={() => setPeopleNonce((n) => n + 1)} /></div>
            : !candidates.length && <p className="cc-card-sub inv-full">{t('inventory.tyres.inv.noCandidates')}</p>}
          <div className="inv-actions inv-full">
            <button type="button" className="cc-btn-primary" disabled={assign.busy || !assign.investigatorId}
              onClick={() => run(setAssign, assign, (k) => assignConflictInvestigator({ conflictId: row.id, investigatorId: assign.investigatorId, note: assign.note }, k))}>
              <UserCheck size={14} aria-hidden="true" /> {assign.busy ? t('inventory.actions.saving') : t('inventory.tyres.inv.assign')}
            </button>
          </div>
          {assign.err && <div className="inv-full"><ErrorNote error={assign.err} /></div>}
        </div>
      )}

      {acts.investigate && (
        <div className="inv-form">
          <Field label={t('inventory.tyres.inv.findingLabel')} full>
            <textarea className="inv-input" maxLength={1000} value={finding.note} onChange={(e) => setFinding((s) => ({ ...s, note: e.target.value }))} />
          </Field>
          <div className="inv-actions inv-full">
            <button type="button" className="cc-btn-ghost" disabled={finding.busy || !finding.note.trim()}
              onClick={() => run(setFinding, finding, (k) => recordConflictFinding({ conflictId: row.id, note: finding.note }, k))}>
              <FileSearch size={14} aria-hidden="true" /> {finding.busy ? t('inventory.actions.saving') : t('inventory.tyres.inv.record')}
            </button>
          </div>
          {finding.err && <div className="inv-full"><ErrorNote error={finding.err} /></div>}
        </div>
      )}

      {acts.investigate && !acts.propose && <p className="cc-card-sub">{t('inventory.tyres.inv.needFinding')}</p>}

      {acts.propose && (
        <div className="inv-form">
          <Field label={t('inventory.tyres.inv.correction')}>
            <select className="cc-select" value={proposal.action} onChange={(e) => setProposal((s) => ({ ...s, action: e.target.value }))}>
              {CORRECTION_ACTIONS.map((a) => <option key={a} value={a}>{t(`inventory.tyres.inv.actions.${a}`)}</option>)}
            </select>
          </Field>
          <Field label={t('inventory.tyres.inv.detail')} full>
            <textarea className="inv-input" maxLength={1000} value={proposal.detail} onChange={(e) => setProposal((s) => ({ ...s, detail: e.target.value }))} />
          </Field>
          <Field label={t('inventory.tyres.inv.reason')} full>
            <input className="inv-input" maxLength={300} value={proposal.reason} onChange={(e) => setProposal((s) => ({ ...s, reason: e.target.value }))} />
          </Field>
          <p className="cc-card-sub inv-full">{t('inventory.tyres.inv.proposeRule')}</p>
          <div className="inv-actions inv-full">
            <button type="button" className="cc-btn-primary" disabled={proposal.busy || !proposal.detail.trim()}
              onClick={() => run(setProposal, proposal, (k) => proposeConflictCorrection({ conflictId: row.id, action: proposal.action, detail: proposal.detail, reason: proposal.reason }, k))}>
              <Send size={14} aria-hidden="true" /> {proposal.busy ? t('inventory.actions.saving') : t('inventory.tyres.inv.propose')}
            </button>
          </div>
          {proposal.err && <div className="inv-full"><ErrorNote error={proposal.err} /></div>}
        </div>
      )}

      {acts.waitingApproval && (
        <Note action={onNavigate ? (
          <button type="button" className="cc-btn-ghost" onClick={() => onNavigate('controls', 'approvals')}>{t('inventory.tyres.inv.openApprovals')}</button>
        ) : null}>{t('inventory.tyres.inv.waiting')}</Note>
      )}

      {acts.close && (
        <div className="inv-form">
          <Field label={t('inventory.tyres.inv.note')} full>
            <textarea className="inv-input" maxLength={500} value={closing.note} onChange={(e) => setClosing((s) => ({ ...s, note: e.target.value }))} />
          </Field>
          <div className="inv-actions inv-full">
            <button type="button" className="cc-btn-primary" disabled={closing.busy}
              onClick={() => run(setClosing, closing, (k) => closeConflictCase({ conflictId: row.id, note: closing.note }, k))}>
              <CheckCircle2 size={14} aria-hidden="true" /> {closing.busy ? t('inventory.actions.saving') : t('inventory.tyres.inv.close')}
            </button>
          </div>
          {closing.err && <div className="inv-full"><ErrorNote error={closing.err} /></div>}
        </div>
      )}
    </div>
  )
}
