import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2, Circle, SkipForward, Loader2, ChevronRight, AlertTriangle,
  Clock, Users, Save, ArrowRight,
} from 'lucide-react'
import { caseProgress, teamForRole } from '../../lib/accidentStages'
import { useAuth } from '../../contexts/AuthContext'
import { listCaseStageEvents, saveStageFields, advanceStage } from '../../lib/api/accidentStages'
import { nextStages } from '../../lib/accidentWorkflow'
import { toUserMessage } from '../../lib/safeError'

/**
 * One claim, divided among the teams that work it.
 *
 * Each stage row names the team that owns it, how long they have held the case,
 * and exactly which of THEIR fields are filled and which are missing - then lets
 * that team fill only their own fields. Fleet, Insurance, Workshop and Final
 * Inspection each see their part and nobody else's.
 *
 * THE STATE THAT MATTERS IS "SKIPPED". The register's Status dropdown can move a
 * case to Closed in one write, passing over every intermediate stage, which is
 * why cases were arriving at the closed section having been worked by nobody.
 * A skipped stage is drawn as skipped, never as done, and the panel says which
 * team never got the case.
 */

const STATE_META = {
  done:    { icon: CheckCircle2, tone: 'text-emerald-400', ring: 'border-emerald-700/50 bg-emerald-950/20', label: 'Done' },
  current: { icon: Loader2,      tone: 'text-orange-400',  ring: 'border-orange-600/60 bg-orange-950/20',   label: 'Here now' },
  skipped: { icon: SkipForward,  tone: 'text-amber-400',   ring: 'border-amber-700/50 bg-amber-950/20',     label: 'Skipped' },
  pending: { icon: Circle,       tone: 'text-[var(--text-muted)]', ring: 'border-[var(--input-border)]',    label: 'Not started' },
}

const dayLabel = (d, estimated) => {
  if (d == null) return 'not recorded'
  const n = d < 1 ? `${Math.round(d * 24)}h` : `${d} day${d === 1 ? '' : 's'}`
  return estimated ? `about ${n}` : n
}

const INPUT = 'w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--text-primary)]'

/** Input shaped by the column it writes. Money and dates are the ones that go
 *  wrong when everything is a text box. */
function StageField({ field, value, onChange }) {
  const common = { className: INPUT, value: value ?? '', onChange: (e) => onChange(field.key, e.target.value) }
  if (field.kind === 'bool') {
    return (
      <select {...common} value={value === true ? 'yes' : value === false ? 'no' : ''}
        onChange={(e) => onChange(field.key, e.target.value === '' ? null : e.target.value === 'yes')}>
        <option value="">Not recorded</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    )
  }
  if (field.money) return <input type="number" step="0.01" min="0" {...common} />
  if (/_date$|_at$/.test(field.key)) return <input type="date" {...common} />
  if (['description', 'root_cause', 'corrective_action', 'preventive_action',
    'hse_investigation', 'closure_evidence'].includes(field.key)) {
    return <textarea rows={2} {...common} />
  }
  return <input type="text" {...common} />
}

function StageRow({ row, record, canEdit, onSaved, onAdvance, advancing }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const meta = STATE_META[row.state] || STATE_META.pending
  const Icon = meta.icon
  const fields = [...(row.required || []), ...(row.optional || [])]

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }))
  const valueOf = (k) => (k in draft ? draft[k] : (record?.[k] ?? ''))
  const dirty = Object.keys(draft).length > 0

  async function save() {
    setBusy(true); setMsg(null)
    try {
      const res = await saveStageFields(record.id, row.stage, draft)
      if (!res.written.length) { setMsg({ ok: false, text: 'Nothing to save.' }); return }
      setDraft({})
      // A rejected key means the caller tried to write a column this stage does
      // not own. Saying so beats silently dropping it.
      setMsg({
        ok: true,
        text: `Saved ${res.written.length} field${res.written.length === 1 ? '' : 's'}.`
          + (res.rejected.length ? ` ${res.rejected.length} not owned by this stage were not written.` : ''),
      })
      onSaved?.()
    } catch (e) {
      setMsg({ ok: false, text: toUserMessage(e, 'could not save') })
    } finally { setBusy(false) }
  }

  return (
    <div className={`border rounded-xl ${meta.ring}`}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 px-3 py-2.5 text-left">
        <Icon size={16} className={`${meta.tone} mt-0.5 shrink-0 ${row.state === 'current' ? 'animate-spin' : ''}`}
          style={row.state === 'current' ? { animationDuration: '3s' } : undefined} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium text-[var(--text-primary)]">{row.label}</span>
            <span className="text-xs text-[var(--text-dim)] flex items-center gap-1">
              <Users size={11} /> {row.department || 'Unassigned'}
            </span>
            <span className={`text-[11px] uppercase tracking-wide ${meta.tone}`}>{meta.label}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-[var(--text-muted)]">
            {(row.state === 'done' || row.state === 'current') && (
              <span className="flex items-center gap-1">
                <Clock size={11} /> held {dayLabel(row.heldDays, row.estimated)}
                {row.visits > 1 && <> over {row.visits} visits</>}
              </span>
            )}
            {row.total > 0 && (
              <span className={row.missing.length ? 'text-amber-400' : 'text-emerald-400'}>
                {row.filled.length} of {row.total} required fields
              </span>
            )}
            {row.state === 'skipped' && <span className="text-amber-400">nobody worked this stage</span>}
          </div>
        </div>
        <ChevronRight size={15}
          className={`text-[var(--text-muted)] mt-0.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-[var(--input-border)]/60 space-y-3">
          {row.intent && <p className="text-xs text-[var(--text-dim)]">{row.intent}</p>}

          {row.state === 'skipped' && (
            <p className="text-xs text-amber-300 flex items-start gap-1.5">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              The case moved past this stage without stopping, so {row.department || 'this team'} never
              worked it. Their fields below are still empty and can be filled now.
            </p>
          )}
          {row.estimated && (
            <p className="text-[11px] text-[var(--text-muted)]">
              The time shown starts from when this record was last changed, not from a watched
              transition. Durations become exact from the next stage change onward.
            </p>
          )}

          {fields.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">This stage has no fields of its own.</p>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {fields.map((f) => {
                const isReq = (row.required || []).some((r) => r.key === f.key)
                const filled = isReq
                  ? row.filled.some((x) => x.key === f.key)
                  : row.optionalFilled.some((x) => x.key === f.key)
                return (
                  <div key={f.key}>
                    <label className="block text-[11px] mb-1">
                      <span className="text-[var(--text-dim)]">{f.label}</span>
                      {isReq && <span className="text-orange-400 ml-1">required</span>}
                      {!filled && isReq && <span className="text-amber-400 ml-1">missing</span>}
                    </label>
                    {canEdit
                      ? <StageField field={f} value={valueOf(f.key)} onChange={set} />
                      : (
                        <p className="text-sm text-[var(--text-primary)] px-2.5 py-1.5 bg-[var(--input-bg)]/50
                          border border-[var(--input-border)] rounded-lg truncate">
                          {String(record?.[f.key] ?? '') || 'N/A'}
                        </p>
                      )}
                  </div>
                )
              })}
            </div>
          )}

          {msg && (
            <p className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>
          )}

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={save} disabled={!dirty || busy}
                className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                Save this team's fields
              </button>
              {row.state === 'current' && nextStages(row.stage).map((n) => (
                <button key={n} type="button" onClick={() => onAdvance(n)} disabled={advancing}
                  className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50">
                  <ArrowRight size={13} /> Hand over to next stage
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function CaseProgressPanel({ record, canEdit = false, onChanged }) {
  const { profile } = useAuth()
  // The team this user belongs to, so Workshop opens on Workshop rather than on
  // eleven stages of which two are theirs. Everything stays reachable - this is
  // a default focus, not a permission.
  const myTeam = teamForRole(profile?.role)
  const [mineOnly, setMineOnly] = useState(!!myTeam)
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [advancing, setAdvancing] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!record?.id) { setLoading(false); return }
    let alive = true
    setLoading(true); setErr(null)
    listCaseStageEvents(record.id)
      .then((rows) => { if (alive) setEvents(rows || []) })
      .catch((e) => { if (alive) setErr(toUserMessage(e, 'could not load the case history')) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [record?.id, tick])

  const progress = useMemo(() => caseProgress(record || {}, events), [record, events])

  async function handleAdvance(stage) {
    setAdvancing(true)
    try {
      await advanceStage(record.id, stage)
      setTick((t) => t + 1)
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'could not move the case'))
    } finally { setAdvancing(false) }
  }

  if (!record?.id) return null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-sm font-semibold text-[var(--text-primary)]">Who has worked this claim</p>
        {progress.holdingTeam && (
          <span className="text-xs text-[var(--text-dim)]">
            {progress.holdingTeam} is holding it, {dayLabel(progress.heldDays, progress.estimated)} so far
          </span>
        )}
        {progress.reachedPct != null && (
          <span className="text-xs text-[var(--text-muted)] ml-auto">
            {progress.reachedFilled} of {progress.reachedRequired} required fields recorded across the
            stages reached ({progress.reachedPct}%)
          </span>
        )}
      </div>

      {progress.waived.length > 0 && (
        <p className="text-xs text-[var(--text-muted)]">
          {progress.waived.length} stage{progress.waived.length === 1 ? '' : 's'} marked not required for
          this case and hidden: {progress.waived.map((w) => w.label
            + (w.remark ? ` (${w.remark})` : '')).join(', ')}. Change that on the incident form.
        </p>
      )}

      {progress.skipped.length > 0 && (
        <div className="text-xs border border-amber-700/50 bg-amber-950/25 text-amber-200 rounded-lg px-3 py-2">
          <p className="flex items-start gap-1.5">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>
              This case passed {progress.skipped.length} stage{progress.skipped.length === 1 ? '' : 's'} without
              anyone working {progress.skipped.length === 1 ? 'it' : 'them'}:{' '}
              {progress.skipped.map((r) => `${r.label} (${r.department})`).join(', ')}. Setting the case
              status straight to a later stage moves it past everything in between.
            </span>
          </p>
        </div>
      )}

      {progress.outstanding.length > 0 && (
        <div className="text-xs border border-[var(--input-border)] bg-[var(--input-bg)]/40 rounded-lg px-3 py-2">
          <p className="text-[var(--text-dim)] mb-1">Still owed by the teams that have had this case:</p>
          <ul className="space-y-0.5">
            {progress.outstanding.map((o) => (
              <li key={o.stage} className="text-[var(--text-muted)]">
                <span className="text-[var(--text-primary)]">{o.department}</span> at {o.label}:{' '}
                {o.missing.map((f) => f.label).join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {err && <p className="text-xs text-red-300">{err}</p>}
      {loading && <p className="text-xs text-[var(--text-muted)]">Loading the case history...</p>}

      {!loading && events.length === 0 && (
        <p className="text-xs text-[var(--text-muted)]">
          No stage history has been recorded for this case yet, so the ladder below shows where it sits
          but not how long each team held it. Timings are captured from the next stage change onward.
        </p>
      )}

      {myTeam && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button type="button" onClick={() => setMineOnly((v) => !v)}
            className={`px-2.5 py-1 rounded-md border font-medium transition-colors ${
              mineOnly
                ? 'bg-orange-500/15 text-orange-300 border-orange-500/30'
                : 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--input-border)]'}`}>
            {mineOnly ? `Showing ${myTeam} only` : 'Showing every team'}
          </button>
          <span className="text-[var(--text-muted)]">
            {mineOnly
              ? 'Your team\u2019s stages. Switch to see the whole case.'
              : `Every stage on the case. ${myTeam} owns the highlighted ones.`}
          </span>
        </div>
      )}

      <div className="space-y-1.5">
        {progress.rows
          .filter((row) => !mineOnly || !myTeam || row.department === myTeam)
          .map((row) => (
          <StageRow key={row.stage} row={row} record={record} canEdit={canEdit}
            onSaved={() => { setTick((t) => t + 1); onChanged?.() }}
            onAdvance={handleAdvance} advancing={advancing} />
          ))}
        {mineOnly && myTeam && !progress.rows.some((r) => r.department === myTeam) && (
          <p className="text-xs text-[var(--text-muted)] px-1">
            No stage on this case belongs to {myTeam}. Switch to every team to see the rest.
          </p>
        )}
      </div>
    </div>
  )
}
