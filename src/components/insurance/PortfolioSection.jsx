/**
 * Portfolio - what we insure and for how much.
 *
 * Every figure here comes from the pure engine (src/lib/insurancePortfolio.js);
 * this file only presents it. Two engine rules are carried through to the screen
 * verbatim rather than being smoothed over: a total across more than one
 * currency is printed per currency and never added, and a rate whose denominator
 * is missing reads "Not measurable" instead of a number.
 */
import { useMemo, useState } from 'react'
import { Layers, FileSpreadsheet, FileText, CalendarClock, Coins, Boxes, AlertTriangle } from 'lucide-react'
import { colorAt } from '../../lib/reportColors'
import { exportToExcel, exportToPdf, reportFileName } from '../../lib/exportUtils'
import {
  SectionCard, DataState, Kpi, BarList, SortTable, SearchBox, Picker, ToolButton,
  ExpiryPill, money, moneyOf, moneyBasis, count, textOr, dateText, n, optionsFrom, Pill,
} from './InsuranceUi'

/** Turn an engine groupSum list into BarList rows, keeping the sumMoney object. */
function barRows(groups, limit = 12) {
  return (groups || []).slice(0, limit).map((g) => ({ label: g.key, value: g.total ?? 0, m: g, n: g.count }))
}

export default function PortfolioSection({
  portfolio, schedule = [], policies = [], loading, error, onRetry, country = 'All',
}) {
  const [search, setSearch] = useState('')
  const [cover, setCover] = useState('')
  const [site, setSite] = useState('')

  const value = portfolio?.value || null
  const efficiency = portfolio?.efficiency?.overall || null
  const renewal = portfolio?.renewal || null
  const property = portfolio?.property || null

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return schedule.filter((r) => {
      if (cover && String(r.cover_type || '') !== cover) return false
      if (site && String(r.site || r.location || '') !== site) return false
      if (!q) return true
      return [r.asset_no, r.plate_no, r.chassis_no, r.description, r.make, r.policy_no]
        .some((v) => String(v || '').toLowerCase().includes(q))
    })
  }, [schedule, search, cover, site])

  // The renewal ladder shown on screen: expired first (already uninsured), then
  // the engine's expiring window, then the policy headers' own end dates.
  const renewalRows = useMemo(() => {
    const rows = []
    for (const r of renewal?.expired || []) {
      rows.push({ id: `x-${r.policy_no}-${r.cover_to}-${r.cover_type}`, kind: 'Schedule', ref: r.policy_no, cover: r.cover_type, to: r.cover_to, items: r.assetCount, m: r.sumInsured })
    }
    for (const r of renewal?.expiring || []) {
      rows.push({ id: `e-${r.policy_no}-${r.cover_to}-${r.cover_type}`, kind: 'Schedule', ref: r.policy_no, cover: r.cover_type, to: r.cover_to, items: r.assetCount, m: r.sumInsured })
    }
    for (const p of policies) {
      if (!p.period_to) continue
      rows.push({
        id: `p-${p.id}`, kind: 'Policy', ref: p.policy_no, cover: p.policy_type, to: p.period_to, items: null,
        m: { total: p.sum_insured ?? p.limit_of_liability, currency: p.currency || 'SAR', counted: 1, missing: 0 },
      })
    }
    return rows.sort((a, b) => String(a.to).localeCompare(String(b.to)))
  }, [renewal, policies])

  const scheduleCols = [
    { key: 'asset_no', header: 'Asset', render: (r) => <span className="font-mono text-xs text-[var(--text-primary)]">{textOr(r.asset_no)}</span> },
    { key: 'plate_no', header: 'Plate' },
    { key: 'description', header: 'Description', render: (r) => <span className="block max-w-[22rem] truncate" title={r.description || ''}>{textOr(r.description)}</span> },
    { key: 'cover_type', header: 'Cover' },
    { key: 'site', header: 'Site', render: (r) => textOr(r.site || r.location) },
    { key: 'sum_insured', header: 'Sum insured', align: 'right', sortValue: (r) => n(r.sum_insured), render: (r) => money(r.sum_insured, r.currency) },
    { key: 'premium', header: 'Premium', align: 'right', sortValue: (r) => n(r.premium), render: (r) => money(r.premium, r.currency) },
    { key: 'cover_to', header: 'Cover to', sortValue: (r) => r.cover_to || '', render: (r) => dateText(r.cover_to, country) },
  ]

  const EXPORT_KEYS = ['asset_no', 'plate_no', 'chassis_no', 'description', 'cover_type', 'policy_no', 'site', 'sum_insured', 'premium', 'currency', 'cover_from', 'cover_to', 'status']
  const EXPORT_HEADERS = ['Asset', 'Plate', 'Chassis', 'Description', 'Cover', 'Policy', 'Site', 'Sum insured', 'Premium', 'Currency', 'Cover from', 'Cover to', 'Status']
  const exportRows = () => filtered.map((r) => {
    const o = {}
    for (const k of EXPORT_KEYS) o[k] = r[k] ?? ''
    return o
  })

  const rateBasisText = !efficiency ? 'Not available'
    : efficiency.basis === 'mixed_currency' ? 'Withheld: the schedule blends currencies'
      : efficiency.basis === 'no_premium_recorded' ? 'No schedule row states a premium'
        : 'Premium per 1,000 of sum insured'

  return (
    <DataState
      loading={loading}
      error={error}
      empty={!portfolio || (!schedule.length && !policies.length && !(property?.riskCount))}
      emptyTitle="No insurance schedule is on file yet."
      emptyHint="The per-machine schedule and the property values are read from the insurer's own documents. Nothing has been loaded for this country."
      onRetry={onRetry}
    >
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi icon={Coins} label="Sum insured (fleet schedule)" value={moneyOf(value?.total)}
            basis={moneyBasis(value?.total, 'scheduled item')} />
          <Kpi icon={Boxes} label="Property values" value={moneyOf(property?.totalValue)}
            basis={property ? `${count(property.riskCount)} property item(s)` : null} />
          <Kpi icon={Layers} label="Premium (fleet schedule)" value={moneyOf(value?.premium)}
            basis={moneyBasis(value?.premium, 'scheduled item')} />
          <Kpi
            icon={CalendarClock}
            label="Premium efficiency"
            value={efficiency?.ratePer1000 == null ? 'Not measurable' : `${efficiency.ratePer1000.toFixed(2)} per 1,000`}
            tone={efficiency?.ratePer1000 == null ? 'neutral' : 'good'}
            basis={rateBasisText}
          />
        </div>

        {value?.total?.mixedCurrency && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            The schedule holds more than one currency. Totals are shown per currency and are never added together, and any rate that would mix them is withheld.
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <SectionCard title="Sum insured by cover type" subtitle="From the insurer's own cover wording">
            <BarList rows={barRows(value?.byCoverType)} colorAt={colorAt}
              formatValue={(r) => moneyOf(r.m)} emptyText="No sum insured is recorded against a cover type." />
          </SectionCard>
          <SectionCard title="Sum insured by site" subtitle="Site from the schedule, else the asset's registered site">
            <BarList rows={barRows(value?.bySite)} colorAt={colorAt}
              formatValue={(r) => moneyOf(r.m)} emptyText="No site is recorded on the schedule rows." />
          </SectionCard>
          <SectionCard title="Sum insured by asset class" subtitle="Class comes from the fleet register, not the insurer's free text">
            <BarList rows={barRows(value?.byAssetClass)} colorAt={colorAt}
              formatValue={(r) => moneyOf(r.m)} emptyText="No schedule row resolved to a classified asset." />
          </SectionCard>
        </div>

        {portfolio?.efficiency?.byCoverType?.length ? (
          <SectionCard title="Premium efficiency by cover type"
            subtitle="Rate on line is premium per 1,000 of sum insured. A cover whose rows blend currencies, or state no premium, is withheld rather than estimated.">
            <SortTable
              maxHeight="18rem"
              rows={portfolio.efficiency.byCoverType}
              rowKey="key"
              columns={[
                { key: 'key', header: 'Cover type' },
                { key: 'assetCount', header: 'Items', align: 'right', sortValue: (r) => r.assetCount, render: (r) => count(r.assetCount) },
                { key: 'si', header: 'Sum insured', align: 'right', sortValue: (r) => r.sumInsured?.total ?? null, render: (r) => moneyOf(r.sumInsured) },
                { key: 'pr', header: 'Premium', align: 'right', sortValue: (r) => r.premium?.total ?? null, render: (r) => moneyOf(r.premium) },
                { key: 'per', header: 'Premium per item', align: 'right', sortValue: (r) => r.premiumPerAsset, render: (r) => (r.premiumPerAsset == null ? 'N/A' : money(r.premiumPerAsset, r.premium?.currency || 'SAR')) },
                {
                  key: 'rate',
                  header: 'Rate per 1,000',
                  align: 'right',
                  sortValue: (r) => r.ratePer1000,
                  render: (r) => (r.ratePer1000 == null
                    ? <Pill tone="neutral">{r.basis === 'mixed_currency' ? 'Mixed currency' : 'No premium'}</Pill>
                    : r.ratePer1000.toFixed(2)),
                },
              ]}
            />
          </SectionCard>
        ) : null}

        <SectionCard
          title="Renewal countdown"
          subtitle={renewal
            ? `Cover end dates, soonest first. ${count(renewal.undated)} schedule row(s) carry no end date and are not listed, because an unknown expiry cannot be counted down to.`
            : 'Cover end dates, soonest first.'}
        >
          {renewalRows.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No period end date is recorded on any policy or schedule row.</p>
          ) : (
            <SortTable
              maxHeight="20rem"
              rows={renewalRows}
              columns={[
                { key: 'kind', header: 'Record' },
                { key: 'ref', header: 'Reference', render: (r) => <span className="font-mono text-xs">{textOr(r.ref)}</span> },
                { key: 'cover', header: 'Cover' },
                { key: 'items', header: 'Items', align: 'right', sortValue: (r) => n(r.items), render: (r) => (r.items == null ? 'N/A' : count(r.items)) },
                { key: 'm', header: 'Sum insured', align: 'right', sortValue: (r) => r.m?.total ?? null, render: (r) => moneyOf(r.m) },
                { key: 'to', header: 'Ends', sortValue: (r) => r.to || '', render: (r) => dateText(r.to, country) },
                { key: 'x', header: 'Countdown', render: (r) => <ExpiryPill to={r.to} /> },
              ]}
            />
          )}
        </SectionCard>

        <SectionCard
          title="Scheduled assets"
          subtitle="The insurer's own per-machine schedule. Search, filter and export exactly what is covered."
          actions={
            <>
              <ToolButton icon={FileSpreadsheet} disabled={!filtered.length}
                onClick={() => exportToExcel(exportRows(), EXPORT_KEYS, EXPORT_HEADERS, reportFileName('Insurance Schedule', country), 'Schedule')}>
                Excel
              </ToolButton>
              <ToolButton icon={FileText} disabled={!filtered.length}
                onClick={() => exportToPdf(exportRows(), EXPORT_KEYS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })),
                  'Insurance schedule', reportFileName('Insurance Schedule', country), 'landscape')}>
                PDF
              </ToolButton>
            </>
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SearchBox value={search} onChange={setSearch} placeholder="Search asset, plate, chassis or description" />
            <Picker label="Cover" value={cover} onChange={setCover} options={optionsFrom(schedule, 'cover_type', 'All covers')} />
            <Picker label="Site" value={site} onChange={setSite} options={optionsFrom(schedule, 'site', 'All sites')} />
            <Pill tone="neutral">{count(filtered.length)} of {count(schedule.length)}</Pill>
          </div>
          {schedule.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No per-machine schedule rows are on file.</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No scheduled asset matches these filters.</p>
          ) : (
            <SortTable rows={filtered} columns={scheduleCols} />
          )}
        </SectionCard>
      </div>
    </DataState>
  )
}
