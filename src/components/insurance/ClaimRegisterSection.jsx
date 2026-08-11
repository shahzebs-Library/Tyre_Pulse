/**
 * Claims register - the insurer's own motor claim records.
 *
 * This is what the INSURER has recorded, which is a different fact from what our
 * accident case says. It is deliberately NOT merged with /insurance-claims (our
 * manual ledger) or /claims-summary (analytics over accident-embedded claims):
 * three registers exist because three parties record a claim.
 *
 * A claim whose vehicle could not be resolved to a fleet asset says so
 * explicitly. Money is shown per currency and never blended.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileSpreadsheet, FileText, Link2, Unlink, ClipboardList } from 'lucide-react'
import { colorAt } from '../../lib/reportColors'
import { exportToExcel, exportToPdf, reportFileName } from '../../lib/exportUtils'
import {
  SectionCard, DataState, Kpi, SortTable, SearchBox, Picker, ToolButton, Pill, BarList,
  money, count, textOr, dateText, n, optionsFrom,
} from './InsuranceUi'

function sumByCurrency(rows, field) {
  const map = new Map()
  for (const r of rows || []) {
    const v = n(r?.[field])
    if (v == null) continue
    const c = (r.currency || 'SAR').toUpperCase()
    map.set(c, (map.get(c) || 0) + v)
  }
  const parts = [...map.entries()].sort((a, b) => b[1] - a[1])
  return parts.length ? parts.map(([c, v]) => money(v, c)).join(' + ') : 'N/A'
}

/** Engine statsGroup rows -> BarList rows, keeping the group for the value line. */
function barRows(groups, limit = 10) {
  return (groups || []).slice(0, limit).map((g) => ({ label: g.key, value: g.claimCount, g }))
}

export default function ClaimRegisterSection({
  claims = [], stats, gap, repeat, loading, error, onRetry, country = 'All',
}) {
  const [search, setSearch] = useState('')
  const [cause, setCause] = useState('')
  const [city, setCity] = useState('')
  const [type, setType] = useState('')
  const [matched, setMatched] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return claims.filter((r) => {
      if (cause && String(r.cause_of_loss || '') !== cause) return false
      if (city && String(r.claim_city || '') !== city) return false
      if (type && String(r.claim_type || '') !== type) return false
      if (matched === 'yes' && !r.asset_no) return false
      if (matched === 'no' && r.asset_no) return false
      const d = r.accident_date || r.intimation_date || ''
      if (from && (!d || String(d).slice(0, 10) < from)) return false
      if (to && (!d || String(d).slice(0, 10) > to)) return false
      if (!q) return true
      return [r.claim_no, r.plate_no, r.chassis_no, r.driver_name, r.survey_no, r.asset_no, r.policy_no, r.make]
        .some((v) => String(v || '').toLowerCase().includes(q))
    })
  }, [claims, search, cause, city, type, matched, from, to])

  const matchedCount = useMemo(() => rows.filter((r) => r.asset_no).length, [rows])

  const cols = [
    { key: 'claim_no', header: 'Claim no', render: (r) => <span className="font-mono text-xs text-[var(--text-primary)]">{textOr(r.claim_no)}</span> },
    { key: 'accident_date', header: 'Accident', sortValue: (r) => r.accident_date || '', render: (r) => dateText(r.accident_date, country) },
    { key: 'claim_type', header: 'Type' },
    { key: 'cause_of_loss', header: 'Cause of loss', render: (r) => <span className="block max-w-[16rem] truncate" title={r.cause_of_loss || ''}>{textOr(r.cause_of_loss)}</span> },
    { key: 'plate_no', header: 'Plate', render: (r) => <span className="font-mono text-xs">{textOr(r.plate_no)}</span> },
    {
      key: 'asset_no',
      header: 'Fleet asset',
      render: (r) => (r.asset_no
        ? (
          <Link to={`/assets/${encodeURIComponent(r.asset_no)}`} className="inline-flex items-center gap-1 font-mono text-xs text-emerald-400 hover:underline">
            <Link2 size={12} /> {r.asset_no}
          </Link>
        )
        : <span className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]"><Unlink size={12} /> Not matched</span>),
    },
    { key: 'claim_city', header: 'City' },
    { key: 'driver_name', header: 'Driver', render: (r) => <span className="block max-w-[12rem] truncate" title={r.driver_name || ''}>{textOr(r.driver_name)}</span> },
    { key: 'estimate_payment', header: 'Insurer estimate', align: 'right', sortValue: (r) => n(r.estimate_payment), render: (r) => money(r.estimate_payment, r.currency) },
    { key: 'paid_amount', header: 'Paid', align: 'right', sortValue: (r) => n(r.paid_amount), render: (r) => money(r.paid_amount, r.currency) },
    { key: 'survey_no', header: 'Najm survey', render: (r) => <span className="font-mono text-xs">{textOr(r.survey_no)}</span> },
  ]

  const KEYS = ['claim_no', 'sub_claim_no', 'accident_date', 'intimation_date', 'policy_no', 'claim_type', 'cause_of_loss', 'plate_no', 'chassis_no', 'asset_no', 'claim_city', 'driver_name', 'nationality', 'estimate_payment', 'paid_amount', 'outstanding_amount', 'currency', 'survey_no']
  const HEADERS = ['Claim no', 'Sub claim', 'Accident date', 'Intimation date', 'Policy', 'Type', 'Cause of loss', 'Plate', 'Chassis', 'Fleet asset', 'City', 'Driver', 'Nationality', 'Insurer estimate', 'Paid', 'Outstanding', 'Currency', 'Najm survey']
  const exportRows = () => rows.map((r) => {
    const o = {}
    for (const k of KEYS) o[k] = r[k] ?? ''
    return o
  })

  return (
    <DataState
      loading={loading}
      error={error}
      empty={claims.length === 0}
      emptyTitle="No insurer claim records are on file."
      emptyHint="These rows come from the insurer's own claim register document. Nothing has been loaded for this country."
      onRetry={onRetry}
    >
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi icon={ClipboardList} label="Claims in view" value={count(rows.length)} basis={`${count(claims.length)} on file`} />
          <Kpi label="Insurer estimate" value={sumByCurrency(rows, 'estimate_payment')}
            basis="Summed per currency over the claims in view" />
          <Kpi label="Paid by insurer" value={sumByCurrency(rows, 'paid_amount')}
            basis="Only the claims that state a paid amount" />
          <Kpi label="Resolved to a fleet asset" value={`${count(matchedCount)} of ${count(rows.length)}`}
            tone={rows.length && matchedCount === rows.length ? 'good' : 'warn'}
            basis="An unmatched claim is shown as such, never guessed" />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <SectionCard title="Cause of loss" subtitle="Claims, and the total incurred behind them">
            <BarList rows={barRows(stats?.byCause)} colorAt={colorAt}
              formatValue={(r) => `${count(r.value)} | ${r.g?.totalIncurred == null ? 'value N/A' : money(r.g.totalIncurred, 'SAR')}`}
              emptyText="No cause of loss is stated on the register." />
          </SectionCard>
          <SectionCard title="Site" subtitle="Where the machine is based, else the claim city">
            <BarList rows={barRows(stats?.bySite)} colorAt={colorAt}
              formatValue={(r) => count(r.value)} emptyText="No site or city is stated." />
          </SectionCard>
          <SectionCard title="Driver" subtitle="Named on the insurer's record">
            <BarList rows={barRows(stats?.byDriver)} colorAt={colorAt}
              formatValue={(r) => count(r.value)} emptyText="No driver is named on the register." />
          </SectionCard>
        </div>

        {(repeat?.assets?.length || repeat?.drivers?.length) ? (
          <SectionCard
            title="Repeat on the register"
            subtitle={`Assets and drivers appearing on ${repeat.threshold} or more claims. Straight from the register, with no inference; a claim naming neither is excluded rather than pooled.`}
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Assets</p>
                <BarList rows={barRows(repeat.assets, 8)} colorAt={colorAt}
                  formatValue={(r) => `${count(r.value)} claim(s)`} emptyText="No asset appears more than once." />
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Drivers</p>
                <BarList rows={barRows(repeat.drivers, 8)} colorAt={colorAt}
                  formatValue={(r) => `${count(r.value)} claim(s)`} emptyText="No driver appears more than once." />
              </div>
            </div>
          </SectionCard>
        ) : null}

        {gap ? (
          <SectionCard
            title="Insurer record against our accident register"
            subtitle="Two records of the same events. A row the matcher could not resolve is held back from both gap counts, because an unmatched row is evidence of a missing key, not of a missing record."
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Claims linked to an accident" value={count(gap.linkedCount)}
                tone={gap.linkRate != null && gap.linkRate >= 0.8 ? 'good' : 'warn'}
                basis={gap.linkRate == null ? 'Nothing to reconcile' : `${(gap.linkRate * 100).toFixed(0)}% of the claims in the register`} />
              <Kpi label="Claims with no accident on file" value={count(gap.claimsWithoutAccident?.length)}
                tone={gap.claimsWithoutAccident?.length ? 'bad' : 'good'}
                basis="The insurer is paying for an incident nobody logged" />
              <Kpi label="Accidents the insurer has not shown" value={count(gap.accidentsWithoutClaim?.length)}
                tone={gap.accidentsWithoutClaim?.length ? 'warn' : 'good'}
                basis="Carry a claim amount but appear on no claim record" />
              <Kpi label="Could not be resolved" value={count(gap.unresolved?.length)}
                basis="Excluded from both gap counts above" />
            </div>
          </SectionCard>
        ) : null}

        <SectionCard
          title="Claim register"
          subtitle="What the insurer has recorded. This is a separate record from our own accident case and our manual claims ledger; the three are not merged."
          actions={
            <>
              <ToolButton icon={FileSpreadsheet} disabled={!rows.length}
                onClick={() => exportToExcel(exportRows(), KEYS, HEADERS, reportFileName('Insurer Claim Register', country), 'Claims')}>
                Excel
              </ToolButton>
              <ToolButton icon={FileText} disabled={!rows.length}
                onClick={() => exportToPdf(exportRows(), KEYS.map((k, i) => ({ key: k, header: HEADERS[i] })),
                  'Insurer claim register', reportFileName('Insurer Claim Register', country), 'landscape')}>
                PDF
              </ToolButton>
            </>
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SearchBox value={search} onChange={setSearch} placeholder="Search claim, plate, chassis, driver or Najm survey" />
            <Picker label="Cause" value={cause} onChange={setCause} options={optionsFrom(claims, 'cause_of_loss', 'All causes')} />
            <Picker label="City" value={city} onChange={setCity} options={optionsFrom(claims, 'claim_city', 'All cities')} />
            <Picker label="Type" value={type} onChange={setType} options={optionsFrom(claims, 'claim_type', 'All types')} />
            <Picker label="Asset" value={matched} onChange={setMatched} options={[
              { value: '', label: 'All' }, { value: 'yes', label: 'Matched' }, { value: 'no', label: 'Not matched' },
            ]} />
            <label className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
              From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="rounded-lg border border-[var(--border-dim)] bg-[var(--input-bg,var(--surface-2))] px-2 py-1.5 text-xs text-[var(--text-primary)] focus:border-emerald-500 focus:outline-none" />
            </label>
            <label className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
              To
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="rounded-lg border border-[var(--border-dim)] bg-[var(--input-bg,var(--surface-2))] px-2 py-1.5 text-xs text-[var(--text-primary)] focus:border-emerald-500 focus:outline-none" />
            </label>
            <Pill tone="neutral">{count(rows.length)} of {count(claims.length)}</Pill>
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No claim matches these filters.</p>
          ) : (
            <SortTable rows={rows} columns={cols} maxHeight="32rem" />
          )}
        </SectionCard>
      </div>
    </DataState>
  )
}
