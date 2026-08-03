/**
 * ConsoleCorrectionCenter.jsx - governance for a number that looks wrong.
 *
 * The rule this page enforces: do NOT edit a dashboard total directly. Open a
 * case instead. Opening a case freezes the value that was on screen, then the
 * case moves through investigate -> propose -> approve -> apply -> reconcile ->
 * close, with every step and note kept as history. The case is the audit trail
 * and the rollback record; it does not itself mutate business tables - the
 * actual fix is applied through the linked data tool.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ClipboardList, Plus, RefreshCw, ArrowRight, Check, AlertTriangle,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, Badge, Btn, Select, Toolbar,
  Table, THead, Th, Tr, Td, Modal,
  LoadingState, EmptyState, ErrorState,
} from '../components/ui'
import {
  listCorrectionCases, getCorrectionCase, openCorrectionCase,
  transitionCorrectionCase, updateCorrectionCase,
} from '../../lib/api/dataTrustOps'
import {
  CASE_STATUSES, CASE_STATUS_LABEL, nextStatuses, caseStatusTone,
  ROOT_CAUSE_CATEGORIES, CASE_SEVERITIES,
} from '../../lib/dataTrustOps'
import { COUNTRIES } from '../../contexts/SettingsContext'
import { toUserMessage } from '../../lib/safeError'

function when(ts) {
  if (!ts) return 'N/A'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 19).replace('T', ' ')
  return d.toLocaleString()
}
const show = (v) => (v === null || v === undefined || v === '' ? 'N/A' : String(v))

const COUNTRY_OPTS = [{ value: 'All', label: 'All countries' }, ...COUNTRIES.map((x) => ({ value: x, label: x }))]
const STATUS_FILTER_OPTS = [{ value: 'all', label: 'All statuses' }, ...CASE_STATUSES.map((s) => ({ value: s, label: CASE_STATUS_LABEL[s] || s }))]
const SEVERITY_OPTS = CASE_SEVERITIES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))
const ROOT_CAUSE_OPTS = ROOT_CAUSE_CATEGORIES.map((r) => ({ value: r, label: r }))

const EMPTY_NEW = { title: '', metricId: '', suspectedCause: '', severity: 'medium', originalValue: '' }

export default function ConsoleCorrectionCenter() {
  const [country, setCountry] = useState('All')
  const [status, setStatus] = useState('all')
  const [state, setState] = useState({ loading: true, error: null, cases: [] })
  const [flash, setFlash] = useState(null)

  // Create modal
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState(EMPTY_NEW)
  const [busyNew, setBusyNew] = useState(false)

  // Detail modal
  const [detail, setDetail] = useState(null)   // { case, events, loading, error }
  const [edit, setEdit] = useState({ root_cause_category: '', proposed_action: '', corrected_value: '' })
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const cases = await listCorrectionCases({ country, status })
      setState({ loading: false, error: null, cases })
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e), cases: [] })
    }
  }, [country, status])

  useEffect(() => { load() }, [load])

  const cases = useMemo(() => state.cases || [], [state.cases])

  const submitNew = async () => {
    if (!form.title.trim()) return
    setBusyNew(true)
    try {
      const res = await openCorrectionCase({
        title: form.title.trim(),
        metricId: form.metricId.trim() || null,
        country,
        suspectedCause: form.suspectedCause.trim() || null,
        severity: form.severity,
        originalValue: form.originalValue.trim() === '' ? null : form.originalValue.trim(),
      })
      setFlash({ tone: 'ok', text: `Opened case ${res.case_no || ''}. The value is frozen; investigate before proposing a fix.` })
      setCreating(false)
      setForm(EMPTY_NEW)
      await load()
    } catch (e) {
      setFlash({ tone: 'bad', text: toUserMessage(e) })
    } finally {
      setBusyNew(false)
    }
  }

  const openDetail = async (row) => {
    setDetail({ case: row, events: [], loading: true, error: null })
    setNote('')
    try {
      const { case: kase, events } = await getCorrectionCase(row.id)
      const c = kase || row
      setDetail({ case: c, events, loading: false, error: null })
      setEdit({
        root_cause_category: c.root_cause_category || '',
        proposed_action: c.proposed_action || '',
        corrected_value: c.corrected_value == null ? '' : String(c.corrected_value),
      })
    } catch (e) {
      setDetail({ case: row, events: [], loading: false, error: toUserMessage(e) })
    }
  }

  const saveEdit = async () => {
    if (!detail?.case) return
    setBusy('save')
    try {
      const patch = {
        root_cause_category: edit.root_cause_category || null,
        proposed_action: edit.proposed_action.trim() || null,
        corrected_value: edit.corrected_value.trim() === '' ? null : edit.corrected_value.trim(),
      }
      await updateCorrectionCase(detail.case.id, patch)
      setFlash({ tone: 'ok', text: 'Case updated.' })
      await openDetail({ ...detail.case, ...patch })
      await load()
    } catch (e) {
      setFlash({ tone: 'bad', text: toUserMessage(e) })
    } finally {
      setBusy('')
    }
  }

  const doTransition = async (toStatus) => {
    if (!detail?.case) return
    setBusy(`t:${toStatus}`)
    try {
      await transitionCorrectionCase(detail.case.id, toStatus, note.trim() || null)
      setFlash({ tone: 'ok', text: `Case moved to ${CASE_STATUS_LABEL[toStatus] || toStatus}.` })
      setNote('')
      await openDetail({ ...detail.case, status: toStatus })
      await load()
    } catch (e) {
      setFlash({ tone: 'bad', text: toUserMessage(e) })
    } finally {
      setBusy('')
    }
  }

  const kase = detail?.case
  const context = kase?.dashboard_context && typeof kase.dashboard_context === 'object' ? kase.dashboard_context : null

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          icon={ClipboardList}
          title="Correction & Investigation Center"
          subtitle="Do not edit a dashboard total directly. Open a case: freeze the value, investigate, propose, approve, apply, reconcile, close - with full history and rollback."
          actions={(
            <Toolbar>
              <Select value={country} onChange={setCountry} options={COUNTRY_OPTS} className="w-40" />
              <Select value={status} onChange={setStatus} options={STATUS_FILTER_OPTS} className="w-44" />
              <Btn icon={RefreshCw} onClick={load} busy={state.loading}>Refresh</Btn>
              <Btn variant="primary" icon={Plus} onClick={() => { setForm(EMPTY_NEW); setCreating(true) }}>New case</Btn>
            </Toolbar>
          )}
        />

        {flash && (
          <div className="px-4 pb-3">
            <Note icon={flash.tone === 'ok' ? Check : AlertTriangle} tone={flash.tone === 'ok' ? 'accent' : 'danger'}>
              {flash.text}
            </Note>
          </div>
        )}

        <div className="px-4 pb-4">
          <Note>
            A case is governance and audit - it records the decision and the original value. It does not itself mutate
            business tables; apply the actual fix through the linked data tool, then reconcile and close the case here.
          </Note>
        </div>
      </Panel>

      {state.error && <Panel><ErrorState message={state.error} onRetry={load} /></Panel>}

      <Panel>
        <PanelHeader icon={ClipboardList} title="Correction cases" subtitle="Newest first. Click a case to investigate and move it forward." />
        {state.loading ? (
          <LoadingState label="Reading correction cases" rows={5} />
        ) : cases.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No correction cases yet"
            reason={status !== 'all' ? 'No case matches this status filter.' : 'When a number looks wrong, open a case here instead of editing the total.'}
          />
        ) : (
          <Table>
            <THead>
              <Th>Case no</Th>
              <Th>Title</Th>
              <Th>Metric</Th>
              <Th>Status</Th>
              <Th>Severity</Th>
              <Th>Created</Th>
            </THead>
            <tbody>
              {cases.map((r) => (
                <Tr key={r.id} onClick={() => openDetail(r)}>
                  <Td nowrap><span className="font-mono text-gray-300">{r.case_no || 'N/A'}</span></Td>
                  <Td><span className="text-gray-100">{r.title || 'Untitled'}</span></Td>
                  <Td>{show(r.metric_id)}</Td>
                  <Td><Badge tone={caseStatusTone(r.status)}>{CASE_STATUS_LABEL[r.status] || r.status || 'N/A'}</Badge></Td>
                  <Td>{show(r.severity)}</Td>
                  <Td nowrap>{when(r.created_at)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {/* ── New case ─────────────────────────────────────────────────────────── */}
      <Modal
        open={creating}
        title="Open a correction case"
        subtitle="This freezes the value that is on screen so it cannot be lost while the number is investigated."
        onClose={() => setCreating(false)}
        width="max-w-xl"
        footer={(
          <Toolbar className="justify-end">
            <Btn onClick={() => setCreating(false)}>Cancel</Btn>
            <Btn variant="primary" icon={Plus} onClick={submitNew} busy={busyNew} disabled={!form.title.trim()}>
              Open case
            </Btn>
          </Toolbar>
        )}
      >
        <div className="space-y-3">
          <Field label="Title">
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="What number looks wrong?"
              className={INPUT}
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Metric id (optional)">
              <input
                value={form.metricId}
                onChange={(e) => setForm((f) => ({ ...f, metricId: e.target.value }))}
                placeholder="e.g. fleet_cpk"
                className={INPUT}
              />
            </Field>
            <Field label="Severity">
              <Select value={form.severity} onChange={(v) => setForm((f) => ({ ...f, severity: v }))} options={SEVERITY_OPTS} />
            </Field>
          </div>
          <Field label="Original value (optional)">
            <input
              value={form.originalValue}
              onChange={(e) => setForm((f) => ({ ...f, originalValue: e.target.value }))}
              placeholder="The value on screen right now"
              className={INPUT}
            />
          </Field>
          <Field label="Suspected cause (optional)">
            <textarea
              value={form.suspectedCause}
              onChange={(e) => setForm((f) => ({ ...f, suspectedCause: e.target.value }))}
              placeholder="Your first read on why it is wrong"
              rows={2}
              className={INPUT}
            />
          </Field>
          <Note>Country is taken from the filter above ({country}).</Note>
        </div>
      </Modal>

      {/* ── Case detail ──────────────────────────────────────────────────────── */}
      <Modal
        open={!!detail}
        title={kase ? `${kase.case_no || 'Case'} - ${kase.title || 'Untitled'}` : 'Case'}
        subtitle={kase ? `${CASE_STATUS_LABEL[kase.status] || kase.status || ''} | ${show(kase.country)}` : ''}
        onClose={() => setDetail(null)}
        width="max-w-3xl"
      >
        {detail?.loading && <LoadingState label="Reading case" rows={4} />}
        {detail?.error && <ErrorState message={detail.error} />}
        {kase && !detail.loading && !detail.error && (
          <div className="space-y-4">
            {/* frozen facts */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <KV label="Metric" value={show(kase.metric_id)} />
              <KV label="Severity" value={show(kase.severity)} />
              <KV label="Original value" value={show(kase.original_value)} />
              <KV label="Corrected value" value={show(kase.corrected_value)} />
              <KV label="Created" value={when(kase.created_at)} />
              <KV label="Status" value={CASE_STATUS_LABEL[kase.status] || show(kase.status)} />
            </div>

            {context && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">Frozen dashboard context</p>
                <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {Object.entries(context).map(([k, v]) => (
                    <div key={k} className="flex items-baseline gap-2 text-xs">
                      <span className="text-gray-500 shrink-0">{k}:</span>
                      <span className="text-gray-300 break-all">{typeof v === 'object' ? JSON.stringify(v) : show(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* status stepper */}
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">Progress</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {CASE_STATUSES.map((s, i) => (
                  <span key={s} className="inline-flex items-center gap-1.5">
                    <Badge tone={s === kase.status ? caseStatusTone(s) : 'quiet'}>
                      {s === kase.status ? <Check size={10} /> : null}
                      {CASE_STATUS_LABEL[s] || s}
                    </Badge>
                    {i < CASE_STATUSES.length - 1 && <ArrowRight size={11} className="text-gray-700" />}
                  </span>
                ))}
              </div>
            </div>

            {/* investigation edit */}
            <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 space-y-3">
              <p className="text-xs font-semibold text-gray-300">Investigation</p>
              <Field label="Root cause">
                <Select
                  value={edit.root_cause_category}
                  onChange={(v) => setEdit((e) => ({ ...e, root_cause_category: v }))}
                  options={ROOT_CAUSE_OPTS}
                  placeholder="Not set"
                />
              </Field>
              <Field label="Proposed action">
                <textarea
                  value={edit.proposed_action}
                  onChange={(e) => setEdit((s) => ({ ...s, proposed_action: e.target.value }))}
                  placeholder="What should be done to fix it, in the linked data tool"
                  rows={2}
                  className={INPUT}
                />
              </Field>
              <Field label="Corrected value">
                <input
                  value={edit.corrected_value}
                  onChange={(e) => setEdit((s) => ({ ...s, corrected_value: e.target.value }))}
                  placeholder="The value it should be"
                  className={INPUT}
                />
              </Field>
              <Toolbar className="justify-end">
                <Btn variant="primary" icon={Check} onClick={saveEdit} busy={busy === 'save'}>Save</Btn>
              </Toolbar>
            </div>

            {/* transitions */}
            <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 space-y-3">
              <p className="text-xs font-semibold text-gray-300">Move this case forward</p>
              {nextStatuses(kase.status).length === 0 ? (
                <Note>This case is in a terminal state. There is no next step.</Note>
              ) : (
                <>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Note for this step (optional)"
                    className={INPUT}
                  />
                  <Toolbar className="justify-end">
                    {nextStatuses(kase.status).map((s) => (
                      <Btn
                        key={s}
                        variant={s === 'rejected' ? 'danger' : 'primary'}
                        icon={ArrowRight}
                        onClick={() => doTransition(s)}
                        busy={busy === `t:${s}`}
                      >
                        {CASE_STATUS_LABEL[s] || s}
                      </Btn>
                    ))}
                  </Toolbar>
                </>
              )}
            </div>

            {/* timeline */}
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">History</p>
              {detail.events.length === 0 ? (
                <Note>No events recorded yet.</Note>
              ) : (
                <Table>
                  <THead>
                    <Th>Event</Th>
                    <Th>Change</Th>
                    <Th>Note</Th>
                    <Th>When</Th>
                  </THead>
                  <tbody>
                    {detail.events.map((ev, i) => (
                      <Tr key={`${ev.event_type || 'ev'}:${ev.created_at || i}:${i}`}>
                        <Td>{show(ev.event_type)}</Td>
                        <Td nowrap>
                          {ev.from_status || ev.to_status
                            ? <span className="text-gray-400">{show(ev.from_status)} <ArrowRight size={10} className="inline" /> {show(ev.to_status)}</span>
                            : <span className="text-gray-600">N/A</span>}
                        </Td>
                        <Td>{show(ev.note)}</Td>
                        <Td nowrap>{when(ev.created_at)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

const INPUT = 'w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-600 focus:border-gray-700 focus:outline-none'

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  )
}

function KV({ label, value }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-2.5">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-sm text-gray-200 mt-0.5 break-all">{value}</p>
    </div>
  )
}
