/**
 * Coverage gaps - the two questions the PDFs cannot answer.
 *
 *   1. Which fleet assets have NO row on any insurance schedule? Potentially
 *      uninsured machines that are working today.
 *   2. Which schedule rows name an asset the fleet register does not hold?
 *      Premium may be being paid on something sold, scrapped or transferred.
 *
 * The comparison is the pure engine's `reconcileCoverage`. Its third bucket is
 * carried through deliberately: a row whose key was unusable is UNRESOLVED, not
 * an orphan, and is shown separately so our own matching gap is never presented
 * to the customer as wasted premium. Where the register's key coverage is thin
 * the engine says so and this screen repeats it above the list.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldOff, ShieldQuestion, HelpCircle, FileSpreadsheet, FileText, AlertTriangle } from 'lucide-react'
import { exportToExcel, exportToPdf, reportFileName } from '../../lib/exportUtils'
import {
  SectionCard, DataState, Kpi, SortTable, SearchBox, Picker, ToolButton, Pill,
  money, count, textOr, dateText, n, optionsFrom, pct,
} from './InsuranceUi'

const REASON_LABEL = {
  no_key: 'No asset code, plate or chassis on the row',
  ambiguous: 'The key matches more than one fleet asset',
  mangled: 'The identifier is corrupted in the source file',
  not_in_fleet: 'Not in the fleet register',
}

function classOf(code) {
  const c = String(code || '').trim().toUpperCase()
  const m = c.match(/^([A-Z]+)/)
  return m ? m[1] : (c || '(no code)')
}

export default function CoverageGapsSection({ coverage, loading, error, onRetry, country = 'All' }) {
  const [view, setView] = useState('uninsured')
  const [search, setSearch] = useState('')
  const [site, setSite] = useState('')
  const [cls, setCls] = useState('')

  const uninsured = useMemo(() => coverage?.uninsured || [], [coverage])
  const orphans = useMemo(() => coverage?.orphanSchedule || [], [coverage])
  const unresolved = useMemo(() => coverage?.unresolved || [], [coverage])
  const analysisMissing = !loading && !error && !coverage

  const base = view === 'uninsured' ? uninsured : view === 'orphans' ? orphans : unresolved
  const withClass = useMemo(() => base.map((r) => ({ ...r, _class: classOf(r.asset_no) })), [base])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return withClass.filter((r) => {
      if (site && String(r.site || r.location || '') !== site) return false
      if (cls && r._class !== cls) return false
      if (!q) return true
      return [r.asset_no, r.plate_no, r.registration_no, r.chassis_no, r.description, r.vehicle_type, r.make, r.policy_no]
        .some((v) => String(v || '').toLowerCase().includes(q))
    })
  }, [withClass, search, site, cls])

  const keyCoverage = coverage?.basis?.fleetKeyCoverage
  const thinKeys = keyCoverage != null && keyCoverage < 0.5

  const VIEWS = [
    { key: 'uninsured', label: `Uninsured (${uninsured.length})`, icon: ShieldOff },
    { key: 'orphans', label: `Not in fleet (${orphans.length})`, icon: ShieldQuestion },
    { key: 'unresolved', label: `Unresolved (${unresolved.length})`, icon: HelpCircle },
  ]

  const uninsuredCols = [
    {
      key: 'asset_no',
      header: 'Asset',
      render: (r) => (r.asset_no
        ? <Link to={`/assets/${encodeURIComponent(r.asset_no)}`} className="font-mono text-xs text-emerald-400 hover:underline">{r.asset_no}</Link>
        : <span className="text-[var(--text-muted)]">N/A</span>),
    },
    { key: 'vehicle_type', header: 'Type' },
    { key: 'make', header: 'Make / model', sortValue: (r) => [r.make, r.model].filter(Boolean).join(' '), render: (r) => textOr([r.make, r.model].filter(Boolean).join(' ')) },
    { key: 'registration_no', header: 'Plate', render: (r) => textOr(r.registration_no || r.plate_no) },
    { key: 'site', header: 'Site' },
    { key: 'status', header: 'Fleet status', render: (r) => <Pill tone={/inactive|retired|transfer/i.test(String(r.status || '')) ? 'neutral' : 'warn'}>{textOr(r.status)}</Pill> },
  ]

  const scheduleCols = [
    { key: 'asset_no', header: 'Asset on schedule', render: (r) => <span className="font-mono text-xs text-[var(--text-primary)]">{textOr(r.asset_no)}</span> },
    { key: 'plate_no', header: 'Plate' },
    { key: 'description', header: 'Description', render: (r) => <span className="block max-w-[20rem] truncate" title={r.description || ''}>{textOr(r.description)}</span> },
    { key: 'policy_no', header: 'Policy', render: (r) => <span className="font-mono text-xs">{textOr(r.policy_no)}</span> },
    { key: 'cover_type', header: 'Cover' },
    { key: 'sum_insured', header: 'Sum insured', align: 'right', sortValue: (r) => n(r.sum_insured), render: (r) => money(r.sum_insured, r.currency) },
    { key: 'premium', header: 'Premium', align: 'right', sortValue: (r) => n(r.premium), render: (r) => money(r.premium, r.currency) },
    { key: 'cover_to', header: 'Cover to', sortValue: (r) => r.cover_to || '', render: (r) => dateText(r.cover_to, country) },
  ]

  const unresolvedCols = [
    ...scheduleCols.slice(0, 5),
    { key: '_reason', header: 'Why', render: (r) => <Pill tone="neutral">{REASON_LABEL[r._reason] || textOr(r._reason)}</Pill> },
    scheduleCols[5],
  ]

  const cols = view === 'uninsured' ? uninsuredCols : view === 'orphans' ? scheduleCols : unresolvedCols
  const keys = view === 'uninsured'
    ? ['asset_no', 'vehicle_type', 'make', 'model', 'registration_no', 'site', 'status']
    : ['asset_no', 'plate_no', 'chassis_no', 'description', 'policy_no', 'cover_type', 'sum_insured', 'premium', 'currency', 'cover_from', 'cover_to', '_reason']
  const headers = view === 'uninsured'
    ? ['Asset', 'Type', 'Make', 'Model', 'Plate', 'Site', 'Fleet status']
    : ['Asset', 'Plate', 'Chassis', 'Description', 'Policy', 'Cover', 'Sum insured', 'Premium', 'Currency', 'Cover from', 'Cover to', 'Reason']
  const title = view === 'uninsured' ? 'Fleet assets with no cover record'
    : view === 'orphans' ? 'Schedule rows with no fleet asset'
      : 'Schedule rows that could not be resolved'

  const exportRows = () => rows.map((r) => {
    const o = {}
    for (const k of keys) o[k] = k === '_reason' ? (REASON_LABEL[r._reason] || r._reason || '') : (r[k] ?? '')
    return o
  })

  const orphanPremium = useMemo(() => {
    const map = new Map()
    for (const r of orphans) {
      const v = n(r.premium)
      if (v == null) continue
      const c = (r.currency || 'SAR').toUpperCase()
      map.set(c, (map.get(c) || 0) + v)
    }
    const parts = [...map.entries()].sort((a, b) => b[1] - a[1])
    return parts.length ? parts.map(([c, v]) => money(v, c)).join(' + ') : 'N/A'
  }, [orphans])

  return (
    <DataState
      loading={loading}
      error={error}
      empty={analysisMissing}
      emptyTitle="The coverage comparison could not be produced."
      emptyHint="It needs both the fleet register and the insurer's schedule. One of them returned nothing, so no gap list is shown rather than an empty one that would read as a clean bill of health."
      onRetry={onRetry}
    >
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Fleet assets on file" value={count(coverage?.fleetCount)} basis="The register this comparison ran against" />
          <Kpi label="Assets with a cover record" value={count(coverage?.insuredCount)}
            tone={coverage?.coveragePct != null && coverage.coveragePct >= 0.95 ? 'good' : 'warn'}
            basis={coverage?.coveragePct == null ? 'Coverage share not measurable' : `${pct(coverage.coveragePct * 100)} of the register`} />
          <Kpi label="Potentially uninsured" value={count(coverage?.uninsuredCount)} tone={uninsured.length ? 'bad' : 'good'}
            icon={ShieldOff} basis="In the fleet register, absent from every schedule" />
          <Kpi label="Schedule rows with no asset" value={count(orphans.length)} tone={orphans.length ? 'warn' : 'good'}
            icon={ShieldQuestion} basis={`Premium on those rows: ${orphanPremium}`} />
        </div>

        {thinKeys && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              Only {pct((keyCoverage || 0) * 100)} of the fleet register carries a chassis or plate, so a schedule row can often be matched on the asset code alone.
              The uninsured list therefore OVERSTATES exposure: it includes assets that may well be covered under a key we cannot read. Treat it as a list to check with the broker.
            </span>
          </p>
        )}

        {uninsured.length > 0 && !thinKeys && (
          <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              {count(uninsured.length)} asset(s) in the fleet register carry no row on any insurance schedule on file.
              Matching runs on chassis, then plate, then asset code; an asset here may still be insured under a name none of those records.
            </span>
          </p>
        )}

        <SectionCard
          title={title}
          subtitle={view === 'uninsured'
            ? 'Every asset in the fleet register with no matching schedule row. Check these with the broker before the next renewal.'
            : view === 'orphans'
              ? 'Every schedule row whose asset is not in the fleet register. Premium may be being paid on a machine that has gone.'
              : 'Rows the matcher could not decide on. These are OUR gap, not the insurer\'s, and are deliberately kept out of the two lists above.'}
          actions={
            <>
              <ToolButton icon={FileSpreadsheet} disabled={!rows.length}
                onClick={() => exportToExcel(exportRows(), keys, headers, reportFileName('Insurance Coverage Gaps', title, country), 'Gaps')}>
                Excel
              </ToolButton>
              <ToolButton icon={FileText} disabled={!rows.length}
                onClick={() => exportToPdf(exportRows(), keys.map((k, i) => ({ key: k, header: headers[i] })),
                  title, reportFileName('Insurance Coverage Gaps', title, country), 'landscape')}>
                PDF
              </ToolButton>
            </>
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-[var(--border-dim)] p-0.5">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => { setView(v.key); setSearch(''); setSite(''); setCls('') }}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${view === v.key ? 'bg-emerald-600 text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)]'}`}
                >
                  <v.icon size={13} /> {v.label}
                </button>
              ))}
            </div>
            <SearchBox value={search} onChange={setSearch} placeholder="Search asset, plate, chassis or description" />
            <Picker label="Site" value={site} onChange={setSite} options={optionsFrom(base, 'site', 'All sites')} />
            <Picker label="Class" value={cls} onChange={setCls} options={optionsFrom(withClass, '_class', 'All classes')} />
            <Pill tone="neutral">{count(rows.length)} of {count(base.length)}</Pill>
          </div>

          {base.length === 0 ? (
            <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-3 text-sm text-emerald-300">
              {view === 'uninsured'
                ? `Every asset in the register matched a schedule row across ${count(coverage?.scheduleCount)} scheduled item(s).`
                : view === 'orphans'
                  ? 'Every schedule row matched an asset in the fleet register.'
                  : 'Every schedule row carried a usable, unambiguous key.'}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">Nothing matches these filters.</p>
          ) : (
            <SortTable rows={rows} rowKey="asset_no" columns={cols} />
          )}
        </SectionCard>
      </div>
    </DataState>
  )
}
