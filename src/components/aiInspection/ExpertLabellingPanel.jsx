import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, RefreshCw, ShieldCheck, AlertTriangle, Users } from 'lucide-react'
import Card from '../ui/Card'
import LazyTyrePhoto from './LazyTyrePhoto'
import { useAuth } from '../../contexts/AuthContext'
import { toUserMessage } from '../../lib/safeError'
import { DANGEROUS_TYPES } from '../../lib/aiTyreAdjudication'
import {
  STRATA, EXPERT_DEFECT_TYPES, LABEL_TARGETS, buildLabellingQueue, consensusLabels, agreementStats,
  labellingProgress, splitLeaks, buildLabelPayload, verdictProblems, expectedFromVerdicts,
  buildBenchmarkExport, labelledToCsv, runReleaseGate,
} from '../../lib/aiTyreExpertLabels'
import { listLabellingCandidates, listExpertLabels, saveExpertLabel, reviewerNames } from '../../lib/api/aiTyreExpertLabels'

const pct = (v) => (v == null ? 'N/A' : `${(v * 100).toFixed(1)}%`)
const human = (t) => String(t || '').replace(/_/g, ' ')
const STRATUM_LABEL = Object.fromEntries(STRATA.map((s) => [s.id, s.label]))
const VERDICT_LABEL = { correct: 'Correct', wrong: 'Wrong (not present)', wrong_type: 'Wrong type' }

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Progress({ label, value, target, pctValue, note }) {
  return <div className="rounded-lg border border-[var(--border-dim)] bg-[var(--panel-2)] p-3">
    <div className="text-xs text-[var(--text-muted)]">{label}</div>
    <div className="text-xl font-bold mt-1">{value} <span className="text-sm font-normal text-[var(--text-muted)]">of {target}</span></div>
    <div className="h-1.5 rounded bg-[var(--border-dim)] mt-2" role="progressbar" aria-valuenow={pctValue} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-1.5 rounded bg-brand-bright" style={{ width: pctValue + '%' }}/>
    </div>
    {note && <div className="text-xs text-[var(--text-muted)] mt-1">{note}</div>}
  </div>
}

/** The labelling form for one photograph: inspector finding beside the AI, per-defect verdicts, missed defects. */
function LabelForm({ item, reviewerId, onSaved, onSkip }) {
  const { job, inspection, inspector, stratum, reasons } = item
  const aiDefects = Array.isArray(job.analysis?.defects) ? job.analysis.defects : []
  const [assessable, setAssessable] = useState(job.analysis?.assessable !== false)
  const [verdicts, setVerdicts] = useState([])
  const [missed, setMissed] = useState([])
  const [serial, setSerial] = useState(inspector.serial || '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setAssessable(job.analysis?.assessable !== false); setVerdicts([]); setMissed([]); setSerial(inspector.serial || ''); setNote(''); setError('') }, [job.id, inspector.serial, job.analysis?.assessable])
  const verdictOf = (i) => verdicts.find((v) => v.index === i) || {}
  const setVerdict = (i, patch) => setVerdicts((vs) => [...vs.filter((v) => v.index !== i), { ...verdictOf(i), index: i, ...patch }])
  const expected = expectedFromVerdicts(aiDefects, verdicts, missed, assessable)
  const problems = verdictProblems(aiDefects, verdicts, assessable)
  const save = async () => {
    if (problems.length) { setError(problems.join('. ')); return }
    setBusy(true); setError('')
    try {
      await saveExpertLabel(buildLabelPayload({ job, reviewerId, assessable, verdicts, missed, tyreSerial: serial, inspectorCondition: inspector.condition, note }))
      onSaved()
    } catch (err) { setError(toUserMessage(err, 'Could not save the label')) }
    finally { setBusy(false) }
  }
  return <Card>
    <div className="flex flex-wrap justify-between gap-2">
      <div>
        <h3 className="font-semibold">{inspection?.asset_no || 'Vehicle not recorded'} | {job.tyre_position}</h3>
        <p className="text-xs text-[var(--text-muted)]">{inspection?.vehicle_type || 'Type not recorded'} | {inspection?.site || 'Site not recorded'} | {inspection?.inspection_date || 'Date not recorded'} | {STRATUM_LABEL[stratum]}</p>
        {reasons.length > 0 && <p className="text-xs text-amber-500 mt-1">Why it is in the dangerous stratum: {reasons.join('; ')}</p>}
      </div>
    </div>
    <div className="grid gap-4 lg:grid-cols-2 mt-3">
      <div>
        <LazyTyrePhoto photoRef={job.photo_ref} alt={'Original tyre photograph at ' + job.tyre_position} className="w-full h-72 object-contain rounded-lg border border-[var(--border-dim)] bg-[var(--panel-2)]"/>
        <p className="text-xs text-[var(--text-muted)] mt-1">Original photograph, unmodified. Open it full size before deciding. Do not judge tread depth from a photo.</p>
      </div>
      <div className="space-y-3 text-sm">
        <div className="rounded-lg border border-[var(--border-dim)] p-3">
          <div className="font-semibold mb-1">Inspector recorded</div>
          {inspector.recorded ? <>
            <div>Condition: {inspector.condition || 'Not recorded'}</div>
            <div>Notes: {inspector.notes || 'None'}</div>
            <div>Serial: {inspector.serial || 'Not recorded'}</div>
          </> : <div className="text-[var(--text-muted)]">No inspector entry for this position.</div>}
        </div>
        <div className="rounded-lg border border-[var(--border-dim)] p-3">
          <div className="font-semibold mb-1">AI said ({job.model_version || 'model not recorded'})</div>
          <div className="text-xs text-[var(--text-muted)] mb-2">{job.analysis?.assessable === false ? (job.analysis?.reason || 'AI marked the photo unassessable') : 'AI marked the photo assessable'}</div>
          {!aiDefects.length && <div className="text-[var(--text-muted)]">AI reported no defect.</div>}
          {aiDefects.map((d, i) => <div key={i} className="border-l-2 border-amber-500 pl-3 mb-2">
            <div><strong>{human(d.type)}</strong> ({d.severity || 'severity not given'}): {d.description || 'No description'}</div>
            {assessable && <div className="flex flex-wrap gap-2 mt-1" role="group" aria-label={'Verdict for AI finding ' + (i + 1)}>
              {Object.entries(VERDICT_LABEL).map(([v, label]) => <button key={v} type="button" aria-pressed={verdictOf(i).verdict === v}
                className={'rounded-md border px-2 py-1 text-xs ' + (verdictOf(i).verdict === v ? 'bg-brand-subtle border-brand-bright text-brand-bright' : 'border-[var(--border-dim)]')}
                onClick={() => setVerdict(i, { verdict: v })}>{label}</button>)}
              {verdictOf(i).verdict === 'wrong_type' && <select className="input text-xs" aria-label={'Correct type for AI finding ' + (i + 1)} value={verdictOf(i).corrected_type || ''} onChange={(e) => setVerdict(i, { corrected_type: e.target.value })}>
                <option value="">Choose the visible defect</option>
                {EXPERT_DEFECT_TYPES.map((t) => <option key={t} value={t}>{human(t)}</option>)}
              </select>}
            </div>}
          </div>)}
        </div>
        <fieldset className="rounded-lg border border-[var(--border-dim)] p-3">
          <legend className="px-1 font-semibold">Expert assessment</legend>
          <div className="flex gap-2 mb-2" role="group" aria-label="Is the photo assessable">
            {[[true, 'Assessable'], [false, 'Not assessable']].map(([v, label]) => <button key={label} type="button" aria-pressed={assessable === v}
              className={'rounded-md border px-3 py-1 text-xs ' + (assessable === v ? 'bg-brand-subtle border-brand-bright text-brand-bright' : 'border-[var(--border-dim)]')}
              onClick={() => setAssessable(v)}>{label}</button>)}
          </div>
          {assessable && <>
            <div className="text-xs text-[var(--text-secondary)] mb-1">Defects visible that the AI missed</div>
            <div className="flex flex-wrap gap-1.5">
              {EXPERT_DEFECT_TYPES.map((t) => <label key={t} className={'text-xs rounded-md border px-2 py-1 cursor-pointer ' + (DANGEROUS_TYPES.includes(t) ? 'border-red-500/50' : 'border-[var(--border-dim)]')}>
                <input type="checkbox" className="mr-1" checked={missed.includes(t)} onChange={(e) => setMissed((m) => e.target.checked ? [...m, t] : m.filter((x) => x !== t))}/>{human(t)}
              </label>)}
            </div>
          </>}
          <label className="block text-xs text-[var(--text-secondary)] mt-3">Tyre serial (keeps one tyre in one benchmark split)
            <input className="input w-full mt-1" value={serial} onChange={(e) => setSerial(e.target.value)} maxLength={80} placeholder="Leave blank if not readable"/>
          </label>
          <label className="block text-xs text-[var(--text-secondary)] mt-2">Note
            <textarea className="input w-full mt-1" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Blur, glare, what is visible"/>
          </label>
          <p className="text-xs mt-2">Expected label: <strong>{assessable ? (expected.length ? expected.map(human).join(', ') : 'no visible defect') : 'not assessable'}</strong></p>
        </fieldset>
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <button type="button" className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving' : 'Save label and next'}</button>
          <button type="button" className="btn-secondary" onClick={onSkip} disabled={busy}>Skip</button>
        </div>
      </div>
    </div>
  </Card>
}

/**
 * Expert labelling queue for the 500-photo AI benchmark. EVALUATION DATA ONLY: labels never change
 * the AI job review, never train a model, and never state that a tyre is fit for service.
 */
export default function ExpertLabellingPanel() {
  const { user } = useAuth()
  const reviewerId = user?.id || ''
  const [state, setState] = useState({ loading: true, error: '', candidates: [], labels: [], provisioned: true, truncated: false, names: new Map() })
  const [mode, setMode] = useState('first')
  const [skipped, setSkipped] = useState(() => new Set())
  const [selectedId, setSelectedId] = useState(null)
  const [requireAgreement, setRequireAgreement] = useState(false)
  const [gate, setGate] = useState(null)
  const [exportNote, setExportNote] = useState('')

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const [{ candidates, truncated }, labelRes] = await Promise.all([listLabellingCandidates(), listExpertLabels()])
      const names = await reviewerNames(labelRes.rows.map((l) => l.reviewer_id))
      setState({ loading: false, error: '', candidates, labels: labelRes.rows, provisioned: labelRes.provisioned, truncated: truncated || labelRes.truncated, names })
    } catch (err) { setState((s) => ({ ...s, loading: false, error: toUserMessage(err, 'Could not load the labelling queue') })) }
  }, [])
  useEffect(() => { load() }, [load])

  const queue = useMemo(() => buildLabellingQueue(state.candidates, state.labels, { reviewerId, mode, limit: 60 }), [state.candidates, state.labels, reviewerId, mode])
  const items = useMemo(() => queue.items.filter((i) => !skipped.has(i.job.id)), [queue, skipped])
  const current = items.find((i) => i.job.id === selectedId) || items[0] || null
  const consensus = useMemo(() => consensusLabels(state.labels), [state.labels])
  const progress = useMemo(() => labellingProgress(consensus), [consensus])
  const agreement = useMemo(() => agreementStats(state.labels), [state.labels])
  const leaks = useMemo(() => splitLeaks(consensus), [consensus])
  const jobsById = useMemo(() => new Map(state.candidates.map((c) => [c.job.id, c.job])), [state.candidates])
  const inspectionsById = useMemo(() => new Map(state.candidates.filter((c) => c.inspection).map((c) => [c.inspection.id, c.inspection])), [state.candidates])
  const disagreements = useMemo(() => consensus.filter((r) => r.status === 'disagreement'), [consensus])
  const exportSet = useMemo(() => buildBenchmarkExport({ consensus, jobsById, inspectionsById, names: state.names, requireAgreement }), [consensus, jobsById, inspectionsById, state.names, requireAgreement])

  const onSaved = async () => {
    setSelectedId(null)
    try { const res = await listExpertLabels(); setState((s) => ({ ...s, labels: res.rows, provisioned: res.provisioned })) }
    catch (err) { setState((s) => ({ ...s, error: toUserMessage(err, 'Saved, but the queue could not refresh') })) }
  }
  const stamp = new Date().toISOString().slice(0, 10)
  const doExport = (kind) => {
    const { labelled, predictions, excludedDisagreement, excludedSingle, duplicatePhoto } = exportSet
    if (kind === 'json') download(`AI tyre labelled set ${stamp}.json`, JSON.stringify(labelled, null, 2), 'application/json')
    if (kind === 'csv') download(`AI tyre labelled set ${stamp}.csv`, labelledToCsv(labelled), 'text/csv')
    if (kind === 'pred') download(`AI tyre predictions ${stamp}.json`, JSON.stringify(predictions, null, 2), 'application/json')
    setExportNote(`${labelled.length} photographs exported. Left out: ${excludedDisagreement} with reviewer disagreement${requireAgreement ? `, ${excludedSingle} reviewed only once` : ''}${duplicatePhoto ? `, ${duplicatePhoto} repeated photographs (latest label kept)` : ''}.`)
  }
  const checkGate = () => setGate(runReleaseGate(exportSet))

  if (state.loading) return <Card><p role="status" className="text-sm text-[var(--text-muted)]">Loading the labelling queue</p></Card>
  return <div className="space-y-4">
    <Card>
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="font-semibold">Expert labelling for the AI accuracy benchmark</h2>
          <p className="text-xs text-[var(--text-muted)] mt-1 max-w-3xl">Mark each AI finding correct or wrong, add defects it missed and say whether the photo can be assessed at all. Labels are evaluation data only: they do not change the AI review, do not train a model and do not certify any tyre. Photos are shown unmodified; tread depth is never read from a photograph.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={load}><RefreshCw size={14}/> Refresh</button>
      </div>
      {state.error && <p role="alert" className="text-sm text-red-500 mt-3">{state.error}</p>}
      {!state.provisioned && <p role="note" className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">Labels cannot be saved yet: the expert label table (migration 20261112104000) has not been applied to the database. The queue below is read only until it is.</p>}
      {state.truncated && <p role="note" className="mt-3 text-xs text-amber-500">The candidate list reached its read limit; some photographs are not in this queue.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mt-4">
        <Progress label="Labelled photographs" value={progress.cases} target={LABEL_TARGETS.cases} pctValue={progress.casesPct} note={`${progress.assessable} assessable`}/>
        <Progress label="With a dangerous defect" value={progress.dangerous} target={LABEL_TARGETS.dangerous} pctValue={progress.dangerousPct} note="Exposed cord, bulge or suspected separation"/>
        <div className="rounded-lg border border-[var(--border-dim)] bg-[var(--panel-2)] p-3">
          <div className="text-xs text-[var(--text-muted)] flex items-center gap-1"><Users size={13}/> Two-reviewer agreement</div>
          <div className="text-xl font-bold mt-1">{pct(agreement.exactAgreement)}</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">{agreement.pairs} photos reviewed twice | assessable {pct(agreement.assessableAgreement)} | overlap {pct(agreement.meanJaccard)}</div>
          {agreement.dangerousDisagreements > 0 && <div className="text-xs text-red-500 mt-1">{agreement.dangerousDisagreements} disagree on a dangerous defect</div>}
        </div>
        <div className="rounded-lg border border-[var(--border-dim)] bg-[var(--panel-2)] p-3">
          <div className="text-xs text-[var(--text-muted)]">Benchmark splits</div>
          <div className="text-sm mt-1">Train {progress.splits.train} | Validation {progress.splits.validation} | Holdout {progress.splits.holdout}</div>
          <div className={'text-xs mt-1 ' + (leaks.length ? 'text-red-500' : 'text-[var(--text-muted)]')}>{leaks.length ? `${leaks.length} tyres appear in more than one split` : 'No tyre appears in more than one split'}</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">{progress.reviewers} reviewers | {progress.disagreements} disagreements to settle</div>
        </div>
      </div>
    </Card>

    <Card>
      <div className="flex flex-wrap justify-between gap-3 items-center">
        <div role="tablist" aria-label="Labelling queue" className="flex gap-2">
          {[['first', 'New photographs'], ['second', 'Second opinion']].map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={mode === id}
            className={'text-xs rounded-md px-3 py-2 border ' + (mode === id ? 'bg-brand-subtle border-brand-bright text-brand-bright' : 'border-[var(--border-dim)] text-[var(--text-secondary)]')}
            onClick={() => { setMode(id); setSelectedId(null); setSkipped(new Set()) }}>{label}</button>)}
        </div>
        <span className="text-xs text-[var(--text-muted)]">Available: {STRATA.map((s) => `${s.label} ${queue.available[s.id] || 0}`).join(' | ')}</span>
      </div>
      <p className="text-xs text-[var(--text-muted)] mt-2">The queue oversamples suspected dangerous photographs (exposed cord, bulge, suspected separation, or the inspector recorded damage) so the benchmark reaches {LABEL_TARGETS.dangerous} dangerous cases. Photographs from a tyre or inspection not yet labelled come first.</p>
      {!items.length && <p className="text-sm text-[var(--text-muted)] mt-3">{mode === 'first' ? 'No unlabelled completed AI photographs remain.' : 'No photographs are waiting for a second opinion.'}</p>}
      {items.length > 0 && <div className="flex flex-wrap gap-1.5 mt-3" aria-label="Queue">
        {items.slice(0, 30).map((i) => <button key={i.job.id} type="button" onClick={() => setSelectedId(i.job.id)} aria-current={current?.job.id === i.job.id}
          className={'text-xs rounded-md border px-2 py-1 ' + (current?.job.id === i.job.id ? 'border-brand-bright text-brand-bright' : i.stratum === 'dangerous' ? 'border-red-500/50' : 'border-[var(--border-dim)]')}>
          {(i.inspection?.asset_no || 'N/A') + ' ' + i.job.tyre_position}</button>)}
      </div>}
    </Card>
    {current && state.provisioned && <LabelForm key={current.job.id} item={current} reviewerId={reviewerId} onSaved={onSaved} onSkip={() => { setSkipped((s) => new Set([...s, current.job.id])); setSelectedId(null) }}/>}

    {disagreements.length > 0 && <Card>
      <h3 className="font-semibold flex items-center gap-2"><AlertTriangle size={15}/> Reviewer disagreements ({disagreements.length})</h3>
      <p className="text-xs text-[var(--text-muted)] mb-2">These are left out of the benchmark until one reviewer revises their label to match.</p>
      <ul className="text-sm space-y-1">{disagreements.slice(0, 20).map((r) => <li key={r.jobId}>
        {(inspectionsById.get(jobsById.get(r.jobId)?.inspection_id)?.asset_no || 'N/A')} {jobsById.get(r.jobId)?.tyre_position || ''}: {r.labels.map((l) => `${state.names.get(l.reviewer_id) || 'Reviewer'}: ${l.assessable ? ((l.expected_defects || []).map(human).join(', ') || 'no defect') : 'not assessable'}`).join(' vs ')}
      </li>)}</ul>
    </Card>}

    <Card>
      <h3 className="font-semibold flex items-center gap-2"><ShieldCheck size={15}/> Benchmark export and release gate</h3>
      <p className="text-xs text-[var(--text-muted)] mt-1">Files match scripts/ai-accuracy.mjs: node scripts/ai-accuracy.mjs --labelled labelled.json --predictions predictions.json --release</p>
      <label className="flex items-center gap-2 text-xs mt-3"><input type="checkbox" checked={requireAgreement} onChange={(e) => setRequireAgreement(e.target.checked)}/> Only photographs two reviewers agreed on</label>
      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" className="btn-secondary" disabled={!exportSet.labelled.length} onClick={() => doExport('json')}><Download size={14}/> Labelled set (JSON)</button>
        <button type="button" className="btn-secondary" disabled={!exportSet.labelled.length} onClick={() => doExport('csv')}><Download size={14}/> Labelled set (CSV)</button>
        <button type="button" className="btn-secondary" disabled={!exportSet.labelled.length} onClick={() => doExport('pred')}><Download size={14}/> Predictions (JSON)</button>
        <button type="button" className="btn-primary" onClick={checkGate}>Check release gate</button>
      </div>
      {exportNote && <p role="status" className="text-sm mt-2">{exportNote}</p>}
      {gate && <div className="mt-3 rounded-lg border border-[var(--border-dim)] p-3 text-sm">
        <div className="font-semibold">Gate ({gate.profile}): <span className={gate.gate.status === 'pass' ? 'text-emerald-500' : gate.gate.status === 'fail' ? 'text-red-500' : 'text-amber-500'}>{gate.gate.status.toUpperCase()}</span></div>
        {gate.gate.status !== 'pass' && <p className="text-xs text-[var(--text-muted)] mt-1">{gate.gate.status === 'insufficient' ? 'Not enough expert-labelled data yet to judge the AI. This is not a pass.' : 'The AI does not meet the release targets on the labelled set.'}</p>}
        <ul className="mt-2 space-y-0.5 text-xs">{gate.gate.checks.map((c) => <li key={c.id}>[{c.status}] {c.label}: {c.value ?? 'N/A'}</li>)}</ul>
        <p className="text-xs mt-2">Micro precision {pct(gate.report.micro.precision)} | recall {pct(gate.report.micro.recall)} | dangerous misses {gate.report.dangerousMisses} | cases scored {gate.report.scored}</p>
      </div>}
    </Card>
  </div>
}
