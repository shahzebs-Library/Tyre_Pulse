/**
 * Loss experience - what the fleet has cost its insurer.
 *
 * Loss ratio = (paid + outstanding) / premium, produced by the pure engine. The
 * engine returns null, never zero, when the premium is unknown; this screen
 * prints "Not measurable" and names the reason, because a policy whose premium
 * never loaded would otherwise report a perfect 0% loss ratio while carrying
 * real claims - the exact inverse of the truth.
 *
 * The basis is stated at the top: whether the figures come from the insurer's
 * own loss runs or, in their absence, from the claim register.
 */
import { useMemo, useState } from 'react'
import { FileSpreadsheet, FileText, TrendingUp, Info } from 'lucide-react'
import { exportToExcel, exportToPdf, reportFileName } from '../../lib/exportUtils'
import {
  SectionCard, DataState, Kpi, SortTable, SearchBox, Picker, ToolButton, Pill,
  money, count, textOr, dateText, n, optionsFrom,
} from './InsuranceUi'

function ratioCell(r) {
  if (r.lossRatio == null) {
    return <Pill tone="neutral" title={r.basis === 'premium_unknown' ? 'No premium is recorded for this policy year' : ''}>Not measurable</Pill>
  }
  const p = r.lossRatio * 100
  const tone = p >= 100 ? 'bad' : p >= 70 ? 'warn' : 'good'
  return <Pill tone={tone}>{p.toFixed(1)}%</Pill>
}

const RATIO_COLS = (label) => [
  { key: 'key', header: label, render: (r) => <span className="font-mono text-xs text-[var(--text-primary)]">{textOr(r.key)}</span> },
  { key: 'claimCount', header: 'Claims', align: 'right', sortValue: (r) => r.claimCount, render: (r) => count(r.claimCount) },
  { key: 'paid', header: 'Paid', align: 'right', sortValue: (r) => r.paid, render: (r) => money(r.paid) },
  { key: 'outstanding', header: 'Outstanding', align: 'right', sortValue: (r) => r.outstanding, render: (r) => money(r.outstanding) },
  { key: 'incurred', header: 'Incurred', align: 'right', sortValue: (r) => r.incurred, render: (r) => money(r.incurred) },
  { key: 'premium', header: 'Premium', align: 'right', sortValue: (r) => r.premium, render: (r) => (r.premium == null ? 'N/A' : money(r.premium)) },
  { key: 'lossRatio', header: 'Loss ratio', align: 'right', sortValue: (r) => r.lossRatio, render: ratioCell },
]

export default function LossExperienceSection({
  loss, lossRuns = [], loading, error, onRetry, country = 'All',
}) {
  const [search, setSearch] = useState('')
  const [policy, setPolicy] = useState('')

  const byYear = loss?.byPolicyYear || []
  const byPolicy = loss?.byPolicy || []
  const fromRuns = !!loss?.fromInsurerLossRuns

  const detail = useMemo(() => {
    const q = search.trim().toLowerCase()
    return lossRuns.filter((r) => {
      if (policy && String(r.policy_no || '') !== policy) return false
      if (!q) return true
      return [r.policy_no, r.cover_type, r.policy_year, r.month_label]
        .some((v) => String(v || '').toLowerCase().includes(q))
    })
  }, [lossRuns, search, policy])

  const measurable = byYear.filter((r) => r.lossRatio != null)
  const worst = measurable.length ? measurable.reduce((a, b) => (b.lossRatio > a.lossRatio ? b : a)) : null
  const totalIncurred = byYear.reduce((a, r) => a + (r.incurred || 0), 0)
  const totalClaims = byYear.reduce((a, r) => a + (r.claimCount || 0), 0)

  const DETAIL_KEYS = ['policy_no', 'cover_type', 'policy_year', 'month_label', 'paid_count', 'paid_amount', 'outstanding_count', 'outstanding_amount', 'salvage_received', 'sum_insured', 'premium', 'currency']
  const DETAIL_HEADERS = ['Policy', 'Cover', 'Policy year', 'Month', 'Paid count', 'Paid', 'Outstanding count', 'Outstanding', 'Salvage received', 'Sum insured', 'Premium', 'Currency']
  const detailRows = () => detail.map((r) => {
    const o = {}
    for (const k of DETAIL_KEYS) o[k] = r[k] ?? ''
    return o
  })

  const YEAR_KEYS = ['key', 'claimCount', 'paid', 'outstanding', 'incurred', 'premium', 'lossRatio']
  const YEAR_HEADERS = ['Policy year', 'Claims', 'Paid', 'Outstanding', 'Incurred', 'Premium', 'Loss ratio %']
  const yearRows = () => byYear.map((r) => ({
    key: r.key, claimCount: r.claimCount, paid: r.paid, outstanding: r.outstanding,
    incurred: r.incurred, premium: r.premium ?? 'N/A',
    lossRatio: r.lossRatio == null ? 'Not measurable' : (r.lossRatio * 100).toFixed(1),
  }))

  return (
    <DataState
      loading={loading}
      error={error}
      empty={!loss || (!byYear.length && !byPolicy.length)}
      emptyTitle="No claims experience is on file."
      emptyHint="Loss runs come from the insurer's claims-experience report. Nothing has been loaded for this country."
      onRetry={onRetry}
    >
      <div className="space-y-6">
        <p className="flex items-start gap-2 rounded-lg border border-[var(--border-dim)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          <Info size={14} className="mt-0.5 shrink-0" />
          {fromRuns
            ? 'Basis: the insurer\'s own loss runs. Their summary total lines are excluded from the monthly sums so nothing double counts.'
            : 'Basis: the claim register. No loss-run report has been loaded, so the figures are built from individual claim records instead of the insurer\'s own experience statement.'}
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Incurred" value={money(totalIncurred)} basis="Paid plus outstanding, across every policy year" />
          <Kpi label="Claims" value={count(totalClaims)} basis={fromRuns ? 'Counted from the loss runs' : 'Counted from the claim register'} />
          <Kpi label="Policy years measured" value={`${count(measurable.length)} of ${count(byYear.length)}`}
            tone={measurable.length === byYear.length ? 'good' : 'warn'}
            basis={measurable.length === byYear.length ? 'Every year states a premium' : 'A year with no premium has no ratio'} />
          <Kpi icon={TrendingUp} label="Worst policy year"
            value={worst ? `${worst.key}: ${(worst.lossRatio * 100).toFixed(1)}%` : 'Not measurable'}
            tone={worst && worst.lossRatio >= 1 ? 'bad' : worst ? 'warn' : 'neutral'}
            basis={worst ? 'Highest ratio of incurred to premium' : 'No year states both incurred and premium'} />
        </div>

        <SectionCard
          title="Loss ratio by policy year"
          subtitle="A year with no premium on file shows Not measurable rather than a ratio."
          actions={
            <>
              <ToolButton icon={FileSpreadsheet} disabled={!byYear.length}
                onClick={() => exportToExcel(yearRows(), YEAR_KEYS, YEAR_HEADERS, reportFileName('Insurance Loss Ratio By Year', country), 'By year')}>
                Excel
              </ToolButton>
              <ToolButton icon={FileText} disabled={!byYear.length}
                onClick={() => exportToPdf(yearRows(), YEAR_KEYS.map((k, i) => ({ key: k, header: YEAR_HEADERS[i] })),
                  'Loss ratio by policy year', reportFileName('Insurance Loss Ratio By Year', country), 'landscape')}>
                PDF
              </ToolButton>
            </>
          }
        >
          {byYear.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No policy year is stated on the loss records.</p>
          ) : (
            <SortTable rows={byYear} rowKey="key" columns={RATIO_COLS('Policy year')} maxHeight="20rem" />
          )}
        </SectionCard>

        <SectionCard title="Loss ratio by policy" subtitle="Each policy on its own premium; a cover with no premium on file is withheld, not zeroed.">
          {byPolicy.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No policy number is stated on the loss records.</p>
          ) : (
            <SortTable rows={byPolicy} rowKey="key" columns={RATIO_COLS('Policy')} maxHeight="20rem" />
          )}
        </SectionCard>

        <SectionCard
          title="Loss run detail"
          subtitle="The insurer's statement, month by month."
          actions={
            <>
              <ToolButton icon={FileSpreadsheet} disabled={!detail.length}
                onClick={() => exportToExcel(detailRows(), DETAIL_KEYS, DETAIL_HEADERS, reportFileName('Insurance Loss Runs', country), 'Loss runs')}>
                Excel
              </ToolButton>
              <ToolButton icon={FileText} disabled={!detail.length}
                onClick={() => exportToPdf(detailRows(), DETAIL_KEYS.map((k, i) => ({ key: k, header: DETAIL_HEADERS[i] })),
                  'Insurance loss runs', reportFileName('Insurance Loss Runs', country), 'landscape')}>
                PDF
              </ToolButton>
            </>
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SearchBox value={search} onChange={setSearch} placeholder="Search policy, cover, year or month" />
            <Picker label="Policy" value={policy} onChange={setPolicy} options={optionsFrom(lossRuns, 'policy_no', 'All policies')} />
            <Pill tone="neutral">{count(detail.length)} of {count(lossRuns.length)}</Pill>
          </div>
          {lossRuns.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No loss-run report is on file. The ratios above are built from the claim register instead.</p>
          ) : detail.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No loss-run row matches these filters.</p>
          ) : (
            <SortTable
              rows={detail}
              maxHeight="24rem"
              columns={[
                { key: 'policy_no', header: 'Policy', render: (r) => <span className="font-mono text-xs">{textOr(r.policy_no)}</span> },
                { key: 'cover_type', header: 'Cover' },
                { key: 'policy_year', header: 'Year' },
                { key: 'month_label', header: 'Month', sortValue: (r) => n(r.month_no), render: (r) => textOr(r.month_label) },
                { key: 'is_total', header: 'Row', render: (r) => (r.is_total ? <Pill tone="info">Insurer total</Pill> : <Pill tone="neutral">Detail</Pill>) },
                { key: 'paid_count', header: 'Paid no', align: 'right', sortValue: (r) => n(r.paid_count), render: (r) => count(r.paid_count) },
                { key: 'paid_amount', header: 'Paid', align: 'right', sortValue: (r) => n(r.paid_amount), render: (r) => money(r.paid_amount, r.currency) },
                { key: 'outstanding_amount', header: 'Outstanding', align: 'right', sortValue: (r) => n(r.outstanding_amount), render: (r) => money(r.outstanding_amount, r.currency) },
                { key: 'premium', header: 'Premium', align: 'right', sortValue: (r) => n(r.premium), render: (r) => money(r.premium, r.currency) },
                { key: 'report_date', header: 'Reported', sortValue: (r) => r.report_date || '', render: (r) => dateText(r.report_date, country) },
              ]}
            />
          )}
        </SectionCard>
      </div>
    </DataState>
  )
}
