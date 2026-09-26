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
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  GraduationCap, RefreshCw, Sparkles, Check, X, AlertTriangle, BookOpen,
  Wand2, ListChecks, FileSpreadsheet, Undo2, Download,
} from 'lucide-react'
import {
  Panel, PanelHeader, StatTile, Badge, Btn, Select, SearchInput, Note,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState,
} from '../components/ui'
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
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import { useTableSort } from '../../lib/useTableSort'

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

export default function ConsoleDataLearning() {
  const [country, setCountry] = useState('All')
  const [field, setField] = useState(SUGGESTABLE_FIELDS[0] || 'brand')

  const [state, setState] = useState({ loading: true, error: null })
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

  // manual teach form
  const [teach, setTeach] = useState({
    matchType: 'serial', targetField: 'brand', matchValue: '', targetValue: '',
  })

  const load = useCallback(async () => {
    setState({ loading: true, error: null })
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
      setState({ loading: false, error: null })
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e) })
    }
  }, [country, field])

  useEffect(() => { load() }, [load])

  const sugSummary = useMemo(() => suggestionSummary(suggestions), [suggestions])
  const shownSuggestions = useMemo(() => {
    const q = suggestSearch.trim().toUpperCase()
    if (!q) return suggestions
    return suggestions.filter(
      (r) => String(r.serialNo).toUpperCase().includes(q) || String(r.value).toUpperCase().includes(q),
    )
  }, [suggestions, suggestSearch])

  const fieldLabel = TARGET_FIELDS[field] || field

  const sugSort = useTableSort(shownSuggestions, { key: 'rows', dir: 'desc' })
  const shownFacts = useMemo(() => {
    const q = factSearch.trim().toUpperCase()
    if (!q) return facts
    return facts.filter((f) => [f.match_value, f.target_value, f.country].some((v) => String(v || '').toUpperCase().includes(q)))
  }, [facts, factSearch])
  const factSort = useTableSort(shownFacts, { key: 'match_value', dir: 'asc' }, FACT_ACCESSORS)
  const shownColumns = useMemo(() => (lowFillOnly
    ? master.columns.filter((c) => c.pct != null && c.pct < LOW_FILL_PCT)
    : master.columns), [master.columns, lowFillOnly])
  const colSort = useTableSort(shownColumns, { key: 'pct', dir: 'asc' })
  const lowFillCount = useMemo(() => master.columns.filter((c) => c.pct != null && c.pct < LOW_FILL_PCT).length, [master.columns])

  const exportSuggestions = () => exportToExcel(
    sugSort.sorted.map((r) => ({ serial: r.serialNo, country: r.country || 'All', rows: r.rows, value: r.value, source: r.source === 'self' ? 'Same serial' : 'Master' })),
    ['serial', 'country', 'rows', 'value', 'source'], ['Serial', 'Country', 'Rows', `Suggested ${fieldLabel}`, 'Source'],
    reportFileName('TyrePulse Learning Suggestions', fieldLabel, country),
  )
  const exportFacts = () => exportToExcel(
    factSort.sorted.map((f) => ({ match: `${matchTypeLabel(f.match_type)} ${f.match_value}`, value: f.target_value, field: TARGET_FIELDS[f.target_field] || f.target_field, country: f.country || 'All', state: f.active ? 'On' : 'Off' })),
    ['match', 'value', 'field', 'country', 'state'], ['Rule', 'Fills with', 'Field', 'Country', 'State'],
    reportFileName('TyrePulse Learned Rules', country),
  )
  const exportColumns = () => exportToExcel(
    colSort.sorted.map((c) => ({ column: c.column, filled: c.filled, blank: c.blank, pct: c.pct ?? 'N/A' })),
    ['column', 'filled', 'blank', 'pct'], ['Column', 'Filled', 'Blank', '% filled'],
    reportFileName('TyrePulse Master File Completeness'),
  )

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

  const undoLast = async () => {
    if (!lastBatch) return
    setBusy('undo')
    try {
      const res = await undoTyreBatch(lastBatch)
      setFlash({
        tone: 'default',
        text: `Undone. Restored ${num(res?.restored ?? 0)} row${res?.restored === 1 ? '' : 's'} and turned the rule off.`,
      })
      setLastBatch(null)
      await load()
    } catch (e) {
      setFlash({ tone: 'danger', text: toUserMessage(e) })
    } finally {
      setBusy('')
    }
  }

  /* ── manual teach ─────────────────────────────────────────────────────── */
  const submitTeach = async () => {
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
  const toggleRule = async (fact) => {
    const key = `rule:${fact.id}`
    setBusy(key)
    try {
      if (fact.active) await deactivateLearnedFact(fact.id)
      else await reactivateLearnedFact(fact.id)
      await load()
    } catch (e) {
      setFlash({ tone: 'danger', text: toUserMessage(e) })
    } finally {
      setBusy('')
    }
  }


  const header = (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h1 className="text-lg font-semibold text-white flex items-center gap-2">
          <GraduationCap size={18} className="text-orange-400" aria-hidden="true" /> Data Learning
        </h1>
        <p className="text-xs text-gray-400 mt-1">
          Confirm once: fix every matching row now and auto-apply to future imports. Never touches cost.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Select ariaLabel="Country" value={country} onChange={setCountry} options={COUNTRY_OPTS} className="w-40" />
        <Btn icon={RefreshCw} onClick={load} busy={state.loading}>Refresh</Btn>
      </div>
    </div>
  )

  if (state.loading) return <div className="space-y-4">{header}<LoadingState label="Reading tyre data gaps and learned facts" rows={6} /></div>

  return (
    <div className="space-y-4">
      {header}
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
      {!state.error && (<>
      {/* ── gap overview ─────────────────────────────────────────────────── */}
      <Panel flush>
        <div className="p-4 pb-0">
          <PanelHeader
            icon={ListChecks}
            title="Where the gaps are"
            subtitle="Blank values per field and how many can be recovered from another row of the same serial or the master upload."
          />
        </div>
        {gap.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="No gap data"
            reason="There are no learnable fields for this country, or the gap overview function is not deployed in this workspace yet."
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
            {gap.map((g) => (
              <StatTile
                key={g.field}
                label={`${g.label}: blank`}
                value={num(g.blank)}
                sub={
                  (g.recoverable != null ? `${num(g.recoverable)} recoverable` : 'recoverable N/A')
                  + ` | ${pct(g.pct)} filled of ${num(g.total)}`
                }
                tone={g.blank > 0 ? (g.recoverable ? 'warning' : 'default') : 'good'}
              />
            ))}
          </div>
        )}
      </Panel>

      {/* ── suggestions ──────────────────────────────────────────────────── */}
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
                  <Btn icon={Undo2} onClick={undoLast} busy={busy === 'undo'}>Undo last</Btn>
                )}
                <Btn icon={Download} onClick={exportSuggestions} disabled={!sugSort.sorted.length}>Excel</Btn>
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
              {sugSort.sorted.map((r) => {
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
        )}
      </Panel>
      </>)}

      {/* ── manual teach ─────────────────────────────────────────────────── */}
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
          </p>
          <Btn variant="primary" icon={Check} onClick={submitTeach} busy={busy === 'teach'}>
            Confirm and learn
          </Btn>
        </div>
      </Panel>

      {!state.error && (<>
      {/* ── learned rules ────────────────────────────────────────────────── */}
      <Panel flush>
        <div className="p-4 pb-0">
          <PanelHeader
            icon={BookOpen}
            title="What it has learned"
            subtitle="Confirmed rules that fill new rows automatically. Turn one off to stop future auto-fill; past fills stay."
            actions={<>
              <SearchInput value={factSearch} onChange={setFactSearch} placeholder="Search rules" className="w-48" />
              <Btn icon={Download} onClick={exportFacts} disabled={!factSort.sorted.length}>Excel</Btn>
            </>}
          />
        </div>
        {facts.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="Nothing learned yet"
            reason="Confirm a suggestion or teach a fact above and it will be recorded here."
          />
        ) : factSort.sorted.length === 0 ? (
          <EmptyState icon={BookOpen} title="No rules match your search" reason="Clear the search to see every learned rule." />
        ) : (
          <Table>
            <THead>
              <Th sortKey="match_value" sort={factSort.sort} onSort={factSort.onSort}>Rule</Th>
              <Th sortKey="field" sort={factSort.sort} onSort={factSort.onSort}>Fills</Th>
              <Th sortKey="country" sort={factSort.sort} onSort={factSort.onSort}>Country</Th>
              <Th sortKey="state" sort={factSort.sort} onSort={factSort.onSort}>State</Th>
              <Th align="right">Action</Th>
            </THead>
            <tbody>
              {factSort.sorted.map((f) => (
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
        )}
      </Panel>

      {/* ── master file completeness ─────────────────────────────────────── */}
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
              <Btn icon={Download} onClick={exportColumns} disabled={!colSort.sorted.length}>Excel</Btn>
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
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <THead>
                <Th sortKey="column" sort={colSort.sort} onSort={colSort.onSort}>Column</Th>
                <Th sortKey="filled" sort={colSort.sort} onSort={colSort.onSort} align="right">Filled</Th>
                <Th sortKey="blank" sort={colSort.sort} onSort={colSort.onSort} align="right">Blank</Th>
                <Th sortKey="pct" sort={colSort.sort} onSort={colSort.onSort} align="right">% filled</Th>
              </THead>
              <tbody>
                {colSort.sorted.map((c) => (
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
          </div>
        )}
      </Panel>
      </>)}
    </div>
  )
}
