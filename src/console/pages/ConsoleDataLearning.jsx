/**
 * ConsoleDataLearning.jsx - the Tyre Data Learning surface (V471).
 *
 * The model: a person CONFIRMS a fact once (this serial is brand X, or the raw
 * token "TRAINGLE" means "TRIANGLE") and the server (a) fills every matching row
 * NOW and (b) auto-applies it to FUTURE imports via a BEFORE trigger. Confirm
 * once, fix everywhere, keep fixing.
 *
 * Four questions, in the order they matter:
 *   1. Where is the gap?          field-level blank vs recoverable counts
 *   2. What can be recovered?     serial suggestions to confirm one click
 *   3. Teach it directly.         manual fact by serial or spelling
 *   4. What has it learned?       the learned rules + master-file trust report
 *
 * This page never shows money - the learning layer deliberately never touches
 * cost. ASCII only; honest empty states (a missing value is "N/A", never a
 * fabricated zero).
 *
 * Layout: header, the gap tiles (click one to see its suggestions), what needs
 * attention, then tabs (?tab=suggestions|teach|rules|master). The teach form
 * stays usable when the reads fail; read-derived tabs say they could not load.
 *
 * Control Center round 2 added: the status strip, a dry-run Preview before a
 * taught fact is confirmed, a confirm with an audited reason on teach / turn
 * off / undo, and a Change history tab (?tab=history) that lists every batch
 * from the apply log with its own Undo, not only the last one.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  GraduationCap, Sparkles, Check, X, AlertTriangle, BookOpen,
  Wand2, ListChecks, FileSpreadsheet, Undo2, History, Eye,
} from 'lucide-react'
import {
  Panel, PanelHeader, StatTile, Badge, Btn, Select, SearchInput, Note, Segmented,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, ConfirmImpactDialog,
} from '../components/ui'
import { useConsoleAuth } from '../ConsoleAuthContext'
import { StatusStrip, ImpactLine } from './dataOps/DataOpsParts'
import { listLearnBatches } from '../../lib/api/dataOpsCenter'
import {
  listTyreSuggestions, listLearnedFacts, confirmTyreFact, undoTyreBatch,
  deactivateLearnedFact, reactivateLearnedFact, getTyreGapOverview, getMasterCompleteness,
} from '../../lib/api/tyreLearning'
import {
  shapeSuggestions, suggestionSummary, shapeGapOverview, shapeMasterCompleteness,
  normalizeBrandToken, MATCH_TYPES, TARGET_FIELDS, SUGGESTABLE_FIELDS,
} from '../../lib/tyreLearning'
import { toUserMessage } from '../../lib/safeError'
import { COUNTRIES } from '../../contexts/SettingsContext'
import { sortRows, searchRows, useTableSort } from '../../lib/consoleTable'
import ExportButtons from './shared/ExportButtons'
import { PageHeader, useUrlTab, usePaged, Pager, AttentionList, TabBar, fmtDateTime } from './shared/pageKit'

const nf = new Intl.NumberFormat('en-US')
const num = (v) => (v === null || v === undefined ? 'N/A' : nf.format(Number(v)))
const pct = (v) => (v === null || v === undefined ? 'N/A' : `${v}%`)

const COUNTRY_OPTS = [{ value: 'All', label: 'All countries' }, ...COUNTRIES.map((c) => ({ value: c, label: c }))]
const FIELD_OPTS = SUGGESTABLE_FIELDS.map((f) => ({ value: f, label: TARGET_FIELDS[f] || f }))
const MATCH_OPTS = Object.entries(MATCH_TYPES).map(([value, label]) => ({ value, label }))
const TARGET_OPTS = Object.entries(TARGET_FIELDS).map(([value, label]) => ({ value, label }))

// A learned rule with a low fill percentage on its column is the least
// trustworthy; anything below this is flagged in the completeness report.
const LOW_FILL_PCT = 60

function pctTone(p) {
  if (p === null || p === undefined) return 'default'
  if (p >= 90) return 'good'
  if (p >= LOW_FILL_PCT) return 'warning'
  return 'danger'
}

const matchTypeLabel = (t) => (t === 'serial' ? 'Serial' : 'Spelling')
const FACT_ACCESSORS = { field: (f) => TARGET_FIELDS[f.target_field] || f.target_field, state: (f) => (f.active ? 1 : 0) }
const TABS = ['suggestions', 'teach', 'rules', 'master', 'history']
const BATCH_EXPORT = [
  { key: 'at', header: 'When', value: (b) => (b.at ? fmtDateTime(b.at) : 'N/A') },
  { key: 'rule', header: 'Rule', value: (b) => b.rule || 'Not recorded' },
  { key: 'fields', header: 'Fields', value: (b) => b.fields.map((f) => TARGET_FIELDS[f] || f).join(', ') },
  { key: 'rows', header: 'Rows changed' },
]
const FACT_EXPORT = [
  { key: 'match', header: 'Rule', value: (f) => `${matchTypeLabel(f.match_type)} ${f.match_value}` },
  { key: 'value', header: 'Fills with', value: (f) => f.target_value },
  { key: 'field', header: 'Field', value: (f) => TARGET_FIELDS[f.target_field] || f.target_field },
  { key: 'country', header: 'Country', value: (f) => f.country || 'All' },
  { key: 'state', header: 'State', value: (f) => (f.active ? 'On' : 'Off') },
]
const COLUMN_EXPORT = [
  { key: 'column', header: 'Column' },
  { key: 'filled', header: 'Filled' },
  { key: 'blank', header: 'Blank' },
  { key: 'pct', header: '% filled', value: (c) => c.pct ?? 'N/A' },
]

export default function ConsoleDataLearning({ tabParam = 'tab' } = {}) {
  const [country, setCountry] = useState('All')
  const [field, setField] = useState(SUGGESTABLE_FIELDS[0] || 'brand')

  const [state, setState] = useState({ loading: true, error: null, at: null })
  const [tab, setTab] = useUrlTab(TABS, 'suggestions', tabParam)
  const [gap, setGap] = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [facts, setFacts] = useState([])
  const [master, setMaster] = useState({ total: 0, columns: [] })

  const [busy, setBusy] = useState('')          // key of the row/button working
  const [flash, setFlash] = useState(null)       // { tone, text }
  const [lastBatch, setLastBatch] = useState(null)
  const [suggestSearch, setSuggestSearch] = useState('')
  const [factSearch, setFactSearch] = useState('')
  const [lowFillOnly, setLowFillOnly] = useState(false)

  const { logAction } = useConsoleAuth()
  const [history, setHistory] = useState({ batches: [], capped: false, loading: false, error: '' })
  const [teachPreview, setTeachPreview] = useState(null)   // dry-run result for the teach form
  const [dialog, setDialog] = useState(null)               // { kind: teach|off|undo|undoBatch, fact?, batchId?, rows? }

  // manual teach form
  const [teach, setTeach] = useState({
    matchType: 'serial', targetField: 'brand', matchValue: '', targetValue: '',
  })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const [gapJson, sugRaw, factRaw, masterJson] = await Promise.all([
        getTyreGapOverview({ country }),
        listTyreSuggestions({ country, field }),
        listLearnedFacts({ country }),
        getMasterCompleteness(),
      ])
      setGap(shapeGapOverview(gapJson))
      setSuggestions(shapeSuggestions(sugRaw))
      setFacts(Array.isArray(factRaw) ? factRaw : [])
      setMaster(shapeMasterCompleteness(masterJson))
      setState({ loading: false, error: null, at: new Date() })
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e), at: null })
    }
  }, [country, field])

  useEffect(() => { load() }, [load])

  const loadHistory = useCallback(async () => {
    setHistory((h) => ({ ...h, loading: true, error: '' }))
    try {
      const res = await listLearnBatches(facts, 1000)
      setHistory({ ...res, loading: false, error: '' })
    } catch (e) {
      setHistory({ batches: [], capped: false, loading: false, error: toUserMessage(e, 'Could not read the learning history.') })
    }
  }, [facts])
  useEffect(() => { if (tab === 'history') loadHistory() }, [tab, loadHistory])

  const sugSummary = useMemo(() => suggestionSummary(suggestions), [suggestions])
  const shownSuggestions = useMemo(() => searchRows(suggestions, suggestSearch, ['serialNo', 'value']), [suggestions, suggestSearch])

  const fieldLabel = TARGET_FIELDS[field] || field

  const sugSort = useTableSort({ key: 'rows', dir: 'desc' })
  const sugSorted = useMemo(() => sortRows(shownSuggestions, sugSort.sort), [shownSuggestions, sugSort.sort])
  const sugPaged = usePaged(sugSorted, 25)
  const shownFacts = useMemo(() => searchRows(facts, factSearch, ['match_value', 'target_value', 'country']), [facts, factSearch])
  const factSort = useTableSort({ key: 'match_value', dir: 'asc' })
  const factSorted = useMemo(() => sortRows(shownFacts, factSort.sort, FACT_ACCESSORS), [shownFacts, factSort.sort])
  const factPaged = usePaged(factSorted, 25)
  const shownColumns = useMemo(() => (lowFillOnly
    ? master.columns.filter((c) => c.pct != null && c.pct < LOW_FILL_PCT)
    : master.columns), [master.columns, lowFillOnly])
  const colSort = useTableSort({ key: 'pct', dir: 'asc' })
  const colSorted = useMemo(() => sortRows(shownColumns, colSort.sort), [shownColumns, colSort.sort])
  const colPaged = usePaged(colSorted, 20)
  const lowFillCount = useMemo(() => master.columns.filter((c) => c.pct != null && c.pct < LOW_FILL_PCT).length, [master.columns])
  const offRules = useMemo(() => facts.filter((f) => !f.active).length, [facts])

  const suggestionExport = useMemo(() => [
    { key: 'serial', header: 'Serial', value: (r) => r.serialNo },
    { key: 'country', header: 'Country', value: (r) => r.country || 'All' },
    { key: 'rows', header: 'Rows' },
    { key: 'value', header: `Suggested ${fieldLabel}` },
    { key: 'source', header: 'Source', value: (r) => (r.source === 'self' ? 'Same serial' : 'Master') },
  ], [fieldLabel])

  const attention = useMemo(() => {
    const out = []
    const recoverable = gap.filter((g) => g.recoverable > 0).sort((a, b) => b.recoverable - a.recoverable)
    if (recoverable[0]) {
      const g = recoverable[0]
      out.push({ key: `rec:${g.field}`, tone: 'warning', title: `${num(g.recoverable)} blank ${String(g.label).toLowerCase()} values can be recovered`,
        detail: 'Confirm the suggestions to fill them now and on future imports.',
        action: SUGGESTABLE_FIELDS.includes(g.field)
          ? { label: 'Review', onClick: () => { setField(g.field); setTab('suggestions') } }
          : { label: 'Teach it', onClick: () => setTab('teach') } })
    }
    if (lowFillCount) out.push({ key: 'low', tone: 'info', title: `${lowFillCount} master-file column${lowFillCount === 1 ? '' : 's'} filled below ${LOW_FILL_PCT}%`,
      detail: 'Learn from those columns with care.', action: { label: 'Show them', onClick: () => { setLowFillOnly(true); setTab('master') } } })
    return out
  }, [gap, lowFillCount, setTab])

  /* ── confirm a serial suggestion ──────────────────────────────────────── */
  const confirmSuggestion = async (row) => {
    const key = `sug:${row.serialNo}:${row.country}`
    setBusy(key)
    setFlash(null)
    try {
      const res = await confirmTyreFact({
        matchType: 'serial',
        matchValue: row.serialNo,
        targetField: field,
        targetValue: row.value,
        country: row.country,
        dryRun: false,
      })
      setLastBatch(res?.batch_id || null)
      try { await logAction?.('learn_confirm', res?.batch_id || null, 'tyre_learned_facts', { filled: res?.filled, field, country: row.country || 'all' }) } catch { /* audit best effort */ }
      setFlash({
        tone: 'accent',
        text: `Filled ${num(res?.filled ?? 0)} ${fieldLabel.toLowerCase()} `
          + `row${res?.filled === 1 ? '' : 's'} for serial ${row.serialNo} now. `
          + 'Future imports auto-fill this serial.',
      })
      await load()
    } catch (e) {
      setFlash({ tone: 'danger', text: toUserMessage(e) })
    } finally {
      setBusy('')
    }
  }

  const undoLast = async (reason = null, batchId = lastBatch) => {
    if (!batchId) return
    setBusy('undo')
    try {
      const res = await undoTyreBatch(batchId)
      try { await logAction?.('learn_undo', batchId, 'tyre_learned_facts', { restored: res?.restored, reason }) } catch { /* audit best effort */ }
      setDialog(null)
      if (tab === 'history') loadHistory()
      setFlash({
        tone: 'default',
        text: `Undone. Restored ${num(res?.restored ?? 0)} row${res?.restored === 1 ? '' : 's'} and turned the rule off.`,
      })
      if (batchId === lastBatch) setLastBatch(null)
      await load()
    } catch (e) {
      setFlash({ tone: 'danger', text: toUserMessage(e) })
    } finally {
      setBusy('')
    }
  }

  /* ── manual teach ─────────────────────────────────────────────────────── */
  const teachValid = () => {
    const cleanTarget = normalizeBrandToken(teach.targetValue)
    const matchValue = teach.matchValue.trim()
    if (!matchValue) { setFlash({ tone: 'danger', text: 'Enter the serial number or the spelling to teach.' }); return null }
    if (!cleanTarget) { setFlash({ tone: 'danger', text: 'Enter a real target value. Blank placeholders like NULL or N/A are not accepted.' }); return null }
    return { cleanTarget, matchValue }
  }

  // Dry run: how many rows the fact would fill, nothing written.
  const previewTeach = async () => {
    const v = teachValid()
    if (!v) return
    setBusy('teach-preview'); setFlash(null)
    try {
      const res = await confirmTyreFact({ matchType: teach.matchType, matchValue: v.matchValue, targetField: teach.targetField, targetValue: v.cleanTarget, country, dryRun: true })
      setTeachPreview({ ...res, key: `${teach.matchType}|${v.matchValue}|${teach.targetField}|${v.cleanTarget}|${country}` })
      return res
    } catch (e) {
      setFlash({ tone: 'danger', text: toUserMessage(e) })
      return null
    } finally { setBusy('') }
  }

  const askTeach = async () => {
    const v = teachValid()
    if (!v) return
    const key = `${teach.matchType}|${v.matchValue}|${teach.targetField}|${v.cleanTarget}|${country}`
    if (!teachPreview || teachPreview.key !== key) await previewTeach()
    setDialog({ kind: 'teach' })
  }

  const submitTeach = async (reason = null) => {
    const cleanTarget = normalizeBrandToken(teach.targetValue)
    const matchValue = teach.matchValue.trim()
    if (!matchValue) {
      setFlash({ tone: 'danger', text: 'Enter the serial number or the spelling to teach.' })
      return
    }
    if (!cleanTarget) {
      setFlash({ tone: 'danger', text: 'Enter a real target value. Blank placeholders like NULL or N/A are not accepted.' })
      return
    }
    setBusy('teach')
    setFlash(null)
    try {
      const res = await confirmTyreFact({
        matchType: teach.matchType,
        matchValue,
        targetField: teach.targetField,
        targetValue: cleanTarget,
        country,
        dryRun: false,
      })
      setLastBatch(res?.batch_id || null)
      try { await logAction?.('learn_confirm', res?.batch_id || null, 'tyre_learned_facts', { filled: res?.filled, field: teach.targetField, country, reason }) } catch { /* audit best effort */ }
      setDialog(null); setTeachPreview(null)
      setFlash({
        tone: 'accent',
        text: `Learned. Filled ${num(res?.filled ?? 0)} row${res?.filled === 1 ? '' : 's'} now and future imports will apply this too.`,
      })
      setTeach((t) => ({ ...t, matchValue: '', targetValue: '' }))
      await load()
    } catch (e) {
      setFlash({ tone: 'danger', text: toUserMessage(e) })
    } finally {
      setBusy('')
    }
  }

  /* ── rule on/off ──────────────────────────────────────────────────────── */
  const toggleRule = async (fact, reason = null) => {
    if (fact.active && reason == null) { setDialog({ kind: 'off', fact }); return }
    const key = `rule:${fact.id}`
    setBusy(key)
    try {
      if (fact.active) await deactivateLearnedFact(fact.id)
      else await reactivateLearnedFact(fact.id)
      try { await logAction?.(fact.active ? 'learn_rule_off' : 'learn_rule_on', fact.id, 'tyre_learned_facts', { rule: `${fact.match_value} -> ${fact.target_value}`, reason }) } catch { /* audit best effort */ }
      setDialog(null)
      await load()
    } catch (e) {
      setFlash({ tone: 'danger', text: toUserMessage(e) })
    } finally {
      setBusy('')
    }
  }


  const header = (
    <PageHeader
      icon={GraduationCap}
      title="Data Learning"
      purpose="Confirm once: fix every matching row now and auto-apply to future imports. Never touches cost."
      refreshedAt={state.at}
      onRefresh={load}
      refreshing={state.loading}
      actions={<Select ariaLabel="Country" value={country} onChange={setCountry} options={COUNTRY_OPTS} className="w-40" />}
    />
  )

  const readFailed = (
    <Panel><Note icon={AlertTriangle} tone="danger">This view could not be loaded, so it is not shown rather than shown empty. Use Retry above.</Note></Panel>
  )

  const gapOf = (f) => gap.find((g) => g.field === f)
  const recoverableTotal = gap.some((g) => g.recoverable != null) ? gap.reduce((a, g) => a + (g.recoverable || 0), 0) : null
  const na = state.error ? 'N/A' : null
  const strip = [
    { label: 'Blank brand', value: na || num(gapOf('brand')?.blank ?? null) },
    { label: 'Blank size', value: na || num(gapOf('size')?.blank ?? null) },
    { label: 'Blank removal reason', value: na || num(gapOf('removal_reason')?.blank ?? null) },
    { label: 'Recoverable now', value: na || num(recoverableTotal), tone: recoverableTotal ? 'warning' : undefined },
    { label: `${fieldLabel} suggestions`, value: na || num(suggestions.length) },
    { label: 'Rules on', value: na || num(facts.length - offRules), tone: 'good' },
    { label: 'Rules off', value: na || num(offRules) },
    { label: 'Master columns low fill', value: na || num(lowFillCount), sub: `Below ${LOW_FILL_PCT}%`, tone: lowFillCount ? 'warning' : undefined },
  ]

  if (state.loading && !state.at) return <div className="space-y-4">{header}<LoadingState label="Reading tyre data gaps and learned facts" rows={6} /></div>

  return (
    <div className="space-y-4">
      {header}
      <StatusStrip label="Data learning status" cells={strip} />
      <ImpactLine change="Confirming a fact fills matching blank rows now and on every future import. Cost is never touched."
        who="Every report that reads tyre brand, size or removal reason." undo="Undo a batch on the Change history tab, or turn the rule off." />
      {flash && (
        <div role="status">
          <Note icon={flash.tone === 'accent' ? Check : AlertTriangle} tone={flash.tone}>
            {flash.text}
          </Note>
        </div>
      )}
      {state.error && <ErrorState message={state.error} onRetry={load} />}

      {/* A failed read hides the read-derived panels: an empty gap list or
          suggestion list would claim "nothing to fix". The error + Retry above
          says what happened; the manual teach form stays usable. */}
      {!state.error && (
        gap.length === 0 ? (
          <Panel>
            <EmptyState
              icon={ListChecks}
              title="No gap data"
              reason="There are no learnable fields for this country, or the gap overview function is not deployed in this workspace yet."
            />
          </Panel>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {gap.map((g) => {
              const suggestable = SUGGESTABLE_FIELDS.includes(g.field)
              return (
                <StatTile
                  key={g.field}
                  label={`${g.label}: blank`}
                  value={num(g.blank)}
                  icon={ListChecks}
                  sub={
                    (g.recoverable != null ? `${num(g.recoverable)} recoverable` : 'recoverable N/A')
                    + ` | ${pct(g.pct)} filled of ${num(g.total)}`
                  }
                  tone={g.blank > 0 ? (g.recoverable ? 'warning' : 'default') : 'good'}
                  onClick={suggestable ? () => { setField(g.field); setTab('suggestions') } : undefined}
                  active={suggestable && field === g.field && tab === 'suggestions'}
                />
              )
            })}
          </div>
        )
      )}

      {!state.error && <AttentionList quiet items={attention} />}

      <TabBar ariaLabel="Data learning views" value={tab} onChange={setTab} tabs={[
        { key: 'suggestions', label: 'Suggestions', icon: Sparkles, count: state.error ? undefined : suggestions.length },
        { key: 'teach', label: 'Teach it directly', icon: Wand2 },
        { key: 'rules', label: 'What it has learned', icon: BookOpen, count: state.error ? undefined : facts.length },
        { key: 'master', label: 'Master file completeness', icon: FileSpreadsheet, count: state.error ? undefined : master.columns.length },
        { key: 'history', label: 'Change history', icon: History },
      ]} />

      {/* ── suggestions ──────────────────────────────────────────────────── */}
      {tab === 'suggestions' && (state.error ? readFailed : (
      <Panel flush>
        <div className="p-4 pb-3">
          <PanelHeader
            icon={Sparkles}
            title="Suggestions to confirm"
            subtitle="Blank serials whose value can be recovered. Confirm one and every row of that serial is filled now, and future imports too."
            actions={(
              <div className="flex items-center gap-2">
                <Select ariaLabel="Field to learn" value={field} onChange={setField} options={FIELD_OPTS} className="w-32" />
                {lastBatch && (
                  <Btn icon={Undo2} onClick={() => setDialog({ kind: 'undo', batchId: lastBatch })} busy={busy === 'undo'}>Undo last</Btn>
                )}
                <ExportButtons rows={sugSorted} columns={suggestionExport} title={`TyrePulse Learning Suggestions ${fieldLabel} ${country}`} />
              </div>
            )}
          />
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput
              value={suggestSearch}
              onChange={setSuggestSearch}
              placeholder="Search serial or value"
              className="w-full sm:w-64"
            />
            <div className="text-[11px] text-gray-400">
              {num(sugSummary.serials)} serial{sugSummary.serials === 1 ? '' : 's'}
              {' | '}
              {num(sugSummary.rows)} row{sugSummary.rows === 1 ? '' : 's'} affected
              {' | '}
              {num(sugSummary.fromSelf)} self, {num(sugSummary.fromMaster)} master
            </div>
          </div>
        </div>

        {shownSuggestions.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title={suggestions.length ? 'No match' : `No ${fieldLabel.toLowerCase()} suggestions`}
            reason={
              suggestions.length
                ? 'No serial or value matches your search.'
                : `Every blank ${fieldLabel.toLowerCase()} in this scope either has no recoverable source, or has already been learned.`
            }
          />
        ) : (
          <div className="px-4 pb-4">
          <Table>
            <THead>
              <Th sortKey="serialNo" sort={sugSort.sort} onSort={sugSort.onSort}>Serial</Th>
              <Th sortKey="country" sort={sugSort.sort} onSort={sugSort.onSort}>Country</Th>
              <Th sortKey="rows" sort={sugSort.sort} onSort={sugSort.onSort} align="right">Rows</Th>
              <Th sortKey="value" sort={sugSort.sort} onSort={sugSort.onSort}>Suggested {fieldLabel.toLowerCase()}</Th>
              <Th sortKey="source" sort={sugSort.sort} onSort={sugSort.onSort}>Source</Th>
              <Th align="right">Confirm</Th>
            </THead>
            <tbody>
              {sugPaged.pageRows.map((r) => {
                const key = `sug:${r.serialNo}:${r.country}`
                return (
                  <Tr key={key}>
                    <Td nowrap><span className="font-medium text-gray-100">{r.serialNo}</span></Td>
                    <Td>{r.country || 'All'}</Td>
                    <Td align="right">{num(r.rows)}</Td>
                    <Td><span className="text-gray-100">{r.value}</span></Td>
                    <Td>
                      <Badge tone={r.source === 'self' ? 'info' : 'accent'} title={r.sourceLabel}>
                        {r.source === 'self' ? 'Same serial' : 'Master'}
                      </Badge>
                    </Td>
                    <Td align="right">
                      <Btn
                        variant="primary"
                        icon={Check}
                        onClick={() => confirmSuggestion(r)}
                        busy={busy === key}
                      >
                        Confirm
                      </Btn>
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
          <Pager {...sugPaged} label="serials" />
          </div>
        )}
      </Panel>
      ))}

      {/* ── manual teach ─────────────────────────────────────────────────── */}
      {tab === 'teach' && (
      <Panel>
        <PanelHeader
          icon={Wand2}
          title="Teach it directly"
          subtitle="By serial fills every row of that serial. Normalize a spelling fixes that raw value everywhere, now and on future imports."
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label htmlFor="dl-match-by" className="text-[11px] uppercase tracking-wide text-gray-500 block mb-1">Match by</label>
            <Select id="dl-match-by"
              value={teach.matchType}
              onChange={(v) => setTeach((t) => ({ ...t, matchType: v }))}
              options={MATCH_OPTS}
            />
          </div>
          <div>
            <label htmlFor="dl-fix-field" className="text-[11px] uppercase tracking-wide text-gray-500 block mb-1">Fix field</label>
            <Select id="dl-fix-field"
              value={teach.targetField}
              onChange={(v) => setTeach((t) => ({ ...t, targetField: v }))}
              options={TARGET_OPTS}
            />
          </div>
          <div>
            <label htmlFor="dl-match-value" className="text-[11px] uppercase tracking-wide text-gray-500 block mb-1">
              {teach.matchType === 'serial' ? 'Serial number' : 'Wrong spelling'}
            </label>
            <input
              id="dl-match-value"
              value={teach.matchValue}
              onChange={(e) => setTeach((t) => ({ ...t, matchValue: e.target.value }))}
              placeholder={teach.matchType === 'serial' ? 'e.g. EP060420711' : 'e.g. TRAINGLE'}
              className="w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-600 focus:border-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
            />
          </div>
          <div>
            <label htmlFor="dl-target-value" className="text-[11px] uppercase tracking-wide text-gray-500 block mb-1">Correct value</label>
            <input
              id="dl-target-value"
              value={teach.targetValue}
              onChange={(e) => setTeach((t) => ({ ...t, targetValue: e.target.value }))}
              placeholder="e.g. TRIANGLE"
              className="w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-600 focus:border-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-gray-400">
            Applies to {country === 'All' ? 'all countries' : country}. Cost is never changed.
            {teachPreview && ` Preview: ${num(teachPreview.matched ?? null)} rows match, ${num(teachPreview.filled ?? null)} would be filled.`}
          </p>
          <span className="flex flex-wrap items-center gap-2">
            <Btn icon={Eye} onClick={previewTeach} busy={busy === 'teach-preview'}>Preview</Btn>
            <Btn variant="primary" icon={Check} onClick={askTeach} busy={busy === 'teach'}>
              Confirm and learn
            </Btn>
          </span>
        </div>
      </Panel>
      )}

      {/* ── learned rules ────────────────────────────────────────────────── */}
      {tab === 'rules' && (state.error ? readFailed : (
      <Panel flush>
        <div className="p-4 pb-0">
          <PanelHeader
            icon={BookOpen}
            title="What it has learned"
            subtitle={`Confirmed rules that fill new rows automatically. Turn one off to stop future auto-fill; past fills stay.${offRules ? ` ${offRules} turned off.` : ''}`}
            actions={<>
              <SearchInput value={factSearch} onChange={setFactSearch} placeholder="Search rules" className="w-48" />
              <ExportButtons rows={factSorted} columns={FACT_EXPORT} title={`TyrePulse Learned Rules ${country}`} />
            </>}
          />
        </div>
        {facts.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="Nothing learned yet"
            reason="Confirm a suggestion or teach a fact above and it will be recorded here."
          />
        ) : factSorted.length === 0 ? (
          <EmptyState icon={BookOpen} title="No rules match your search" reason="Clear the search to see every learned rule." />
        ) : (
          <div className="px-4 pb-4">
          <Table>
            <THead>
              <Th sortKey="match_value" sort={factSort.sort} onSort={factSort.onSort}>Rule</Th>
              <Th sortKey="field" sort={factSort.sort} onSort={factSort.onSort}>Fills</Th>
              <Th sortKey="country" sort={factSort.sort} onSort={factSort.onSort}>Country</Th>
              <Th sortKey="state" sort={factSort.sort} onSort={factSort.onSort}>State</Th>
              <Th align="right">Action</Th>
            </THead>
            <tbody>
              {factPaged.pageRows.map((f) => (
                <Tr key={f.id}>
                  <Td>
                    <span className="text-gray-400">{matchTypeLabel(f.match_type)}</span>{' '}
                    <span className="font-medium text-gray-100">{f.match_value}</span>
                    <span className="text-gray-400"> {'->'} </span>
                    <span className="text-gray-100">{f.target_value}</span>
                  </Td>
                  <Td>{TARGET_FIELDS[f.target_field] || f.target_field}</Td>
                  <Td>{f.country || 'All'}</Td>
                  <Td>
                    <Badge tone={f.active ? 'good' : 'quiet'}>
                      {f.active ? 'On' : 'Off'}
                    </Badge>
                  </Td>
                  <Td align="right">
                    <Btn
                      icon={f.active ? X : Check}
                      onClick={() => toggleRule(f)}
                      busy={busy === `rule:${f.id}`}
                    >
                      {f.active ? 'Turn off' : 'Turn on'}
                    </Btn>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pager {...factPaged} label="rules" />
          </div>
        )}
      </Panel>
      ))}

      {/* ── master file completeness ─────────────────────────────────────── */}
      {tab === 'master' && (state.error ? readFailed : (
      <Panel flush>
        <div className="p-4 pb-3">
          <PanelHeader
            icon={FileSpreadsheet}
            title="Master file completeness"
            subtitle={`Per-column fill of the KSA master upload${master.total ? ` (${num(master.total)} rows)` : ''}. The columns you can trust most.`}
            actions={<>
              {lowFillCount > 0 && (
                <Btn onClick={() => setLowFillOnly((v) => !v)} aria-pressed={lowFillOnly}>
                  {lowFillOnly ? 'Show all columns' : `Only low fill (${lowFillCount})`}
                </Btn>
              )}
              <ExportButtons rows={colSorted} columns={COLUMN_EXPORT} title="TyrePulse Master File Completeness" />
            </>}
          />
          <Note icon={AlertTriangle} tone="warning">
            Columns filled below {LOW_FILL_PCT}% are the least trustworthy; treat their values with care before learning from them.
          </Note>
        </div>
        {master.columns.length === 0 ? (
          <EmptyState
            icon={FileSpreadsheet}
            title="No completeness data"
            reason="The master upload staging table holds no rows, or its completeness function is not deployed in this workspace yet."
          />
        ) : (
          <div className="px-4 pb-4">
            <Table>
              <THead>
                <Th sortKey="column" sort={colSort.sort} onSort={colSort.onSort}>Column</Th>
                <Th sortKey="filled" sort={colSort.sort} onSort={colSort.onSort} align="right">Filled</Th>
                <Th sortKey="blank" sort={colSort.sort} onSort={colSort.onSort} align="right">Blank</Th>
                <Th sortKey="pct" sort={colSort.sort} onSort={colSort.onSort} align="right">% filled</Th>
              </THead>
              <tbody>
                {colPaged.pageRows.map((c) => (
                  <Tr key={c.column}>
                    <Td><span className="font-mono text-[11px] text-gray-300">{c.column}</span></Td>
                    <Td align="right">{num(c.filled)}</Td>
                    <Td align="right">{num(c.blank)}</Td>
                    <Td align="right">
                      <Badge tone={pctTone(c.pct)}>{pct(c.pct)}</Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pager {...colPaged} label="columns" />
          </div>
        )}
      </Panel>
      ))}

      {/* ── change history ───────────────────────────────────────────────── */}
      {tab === 'history' && (
      <Panel flush>
        <div className="p-4 pb-3">
          <PanelHeader icon={History} title="Change history"
            subtitle="Every batch the learning layer wrote, newest first, from the apply log. Undo restores the old values and turns that rule off."
            actions={<ExportButtons rows={history.batches} columns={BATCH_EXPORT} title="TyrePulse Data Learning History" disabled={!!history.error} />} />
          <ImpactLine change="Reading changes nothing. Undo puts back the values a batch replaced." who="Reports that read the restored field." undo="Confirm the fact again." />
          {history.capped && (
            <Note icon={AlertTriangle} tone="warning">Only the latest 1,000 changed rows were read, so the oldest batch here may show part of its row count.</Note>
          )}
        </div>
        {history.loading && !history.batches.length ? <div className="px-4 pb-4"><LoadingState label="Loading the learning history" rows={3} /></div>
          : history.error ? <div className="px-4 pb-4"><ErrorState message={history.error} onRetry={loadHistory} /></div>
            : history.batches.length === 0 ? (
              <EmptyState icon={History} title="Nothing has been learned yet" reason="Confirm a suggestion or teach a fact and its batch is listed here with an Undo." />
            ) : (
              <div className="px-4 pb-4">
                <Table>
                  <THead><Th>When</Th><Th>Rule</Th><Th>Fields</Th><Th align="right">Rows changed</Th><Th align="right">Action</Th></THead>
                  <tbody>
                    {history.batches.map((b) => (
                      <Tr key={b.batchId}>
                        <Td nowrap><span className="text-gray-400 tabular-nums">{b.at ? fmtDateTime(b.at) : 'N/A'}</span></Td>
                        <Td><span className="text-gray-200 break-words">{b.rule || 'Rule not recorded'}</span></Td>
                        <Td>{b.fields.map((f) => TARGET_FIELDS[f] || f).join(', ') || 'N/A'}</Td>
                        <Td align="right">{num(b.rows)}</Td>
                        <Td align="right">
                          <Btn size="xs" icon={Undo2} onClick={() => setDialog({ kind: 'undoBatch', batchId: b.batchId, rows: b.rows })} busy={busy === 'undo'}>Undo</Btn>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
      </Panel>
      )}

      <ConfirmImpactDialog open={!!dialog} requireReason busy={busy === 'teach' || busy === 'undo' || (dialog?.fact && busy === `rule:${dialog.fact.id}`)}
        onCancel={() => { if (!busy) setDialog(null) }}
        title={!dialog ? '' : dialog.kind === 'teach' ? 'Confirm and learn' : dialog.kind === 'off' ? 'Turn this rule off' : 'Undo this batch'}
        confirmLabel={!dialog ? 'Confirm' : dialog.kind === 'teach' ? 'Learn it' : dialog.kind === 'off' ? 'Turn off' : 'Undo batch'}
        danger={dialog?.kind === 'undo' || dialog?.kind === 'undoBatch'}
        onConfirm={({ reason }) => {
          if (!dialog) return
          if (dialog.kind === 'teach') submitTeach(reason)
          else if (dialog.kind === 'off') toggleRule(dialog.fact, reason)
          else undoLast(reason, dialog.batchId)
        }}
        impact={!dialog ? null : dialog.kind === 'teach' ? {
          tone: 'info',
          what: `${teach.matchType === 'serial' ? 'Serial' : 'Spelling'} ${teach.matchValue.trim() || 'N/A'} will fill ${TARGET_FIELDS[teach.targetField] || teach.targetField} with ${normalizeBrandToken(teach.targetValue) || 'N/A'}.`,
          change: 'Matching blank rows are filled now, and every future import that matches is filled automatically.',
          who: `${country === 'All' ? 'All countries' : country}: reports that read this field. Cost is never changed.`,
          undo: 'Yes, from the Change history tab.',
          stats: [
            { label: 'Rows matching', value: teachPreview?.matched ?? null },
            { label: 'Would be filled', value: teachPreview?.filled ?? null },
            { label: 'Country', value: country === 'All' ? 'All' : country },
          ],
        } : dialog.kind === 'off' ? {
          tone: 'warning',
          what: `Stop "${dialog.fact.match_value} -> ${dialog.fact.target_value}" filling new rows.`,
          change: 'Future imports are no longer filled by this rule. Rows it already filled keep their value.',
          who: 'Future imports that match this rule.',
          undo: 'Turn it on again from this tab.',
        } : {
          tone: 'danger',
          what: `Undo ${dialog.rows != null ? `${num(dialog.rows)} changed row(s)` : 'the last learning batch'}.`,
          change: 'Every value this batch filled goes back to what it was, and its rule is turned off.',
          who: 'Reports that read the restored field.',
          undo: 'Confirm the fact again.',
        }} />
    </div>
  )
}
