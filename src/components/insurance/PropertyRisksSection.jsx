/**
 * Property risks - the Property All Risk schedule, item by item, per location.
 *
 * The insurer names its own locations. Where that name does not resolve to the
 * site register the row is flagged rather than silently renamed: two spellings
 * of one yard is a real reconciliation job for a person, and quietly folding
 * them would hide it. GPS is shown when the document carries it.
 */
import { useMemo, useState } from 'react'
import { FileSpreadsheet, FileText, MapPin, Boxes, Building2 } from 'lucide-react'
import { colorAt } from '../../lib/reportColors'
import { exportToExcel, exportToPdf, reportFileName } from '../../lib/exportUtils'
import { safeHref } from '../../lib/safeUrl'
import {
  SectionCard, DataState, Kpi, BarList, SortTable, SearchBox, Picker, ToolButton, Pill,
  money, moneyOf, count, textOr, dateText, n, optionsFrom,
} from './InsuranceUi'

const norm = (v) => String(v || '').trim().toUpperCase().replace(/\s+/g, ' ')

export default function PropertyRisksSection({
  risks = [], property, siteNames = [], loading, error, onRetry, country = 'All',
}) {
  const [search, setSearch] = useState('')
  const [loc, setLoc] = useState('')

  // The site register, normalised once, so a location can be told apart from a
  // spelling nothing else in the system knows.
  const registry = useMemo(() => new Set((siteNames || []).map(norm).filter(Boolean)), [siteNames])
  const canResolve = registry.size > 0

  // A location counts as resolved when EITHER the insurer's location name or the
  // row's site matches the register. Which one matched is shown, so a row that
  // only anchored through its site code is not mistaken for a name we recognise.
  const enriched = useMemo(() => risks.map((r) => {
    const bySite = canResolve && registry.has(norm(r.site))
    const byName = canResolve && registry.has(norm(r.location_name))
    return { ...r, _resolved: canResolve ? (bySite || byName) : null, _viaSite: bySite && !byName }
  }), [risks, registry, canResolve])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched.filter((r) => {
      if (loc && String(r.location_name || r.site || '') !== loc) return false
      if (!q) return true
      return [r.location_name, r.site, r.city, r.item_description, r.risk_id, r.policy_no]
        .some((v) => String(v || '').toLowerCase().includes(q))
    })
  }, [enriched, search, loc])

  const unresolvedCount = canResolve ? enriched.filter((r) => r._resolved === false).length : null
  const withGps = risks.filter((r) => n(r.gps_lat) != null && n(r.gps_lng) != null).length
  const locations = useMemo(() => new Set(risks.map((r) => norm(r.location_name || r.site)).filter(Boolean)).size, [risks])

  const barData = useMemo(
    () => (property?.byLocation || []).slice(0, 12).map((g) => ({ label: g.key, value: g.total ?? 0, m: g })),
    [property],
  )

  const KEYS = ['risk_id', 'location_name', 'site', 'city', 'item_no', 'item_description', 'quantity', 'total_value', 'premium', 'currency', 'building_age', 'floors', 'gps_lat', 'gps_lng', 'period_from', 'period_to', 'policy_no']
  const HEADERS = ['Risk', 'Location', 'Site', 'City', 'Item no', 'Item', 'Quantity', 'Insured value', 'Premium', 'Currency', 'Building age', 'Floors', 'Latitude', 'Longitude', 'From', 'To', 'Policy']
  const exportRows = () => rows.map((r) => {
    const o = {}
    for (const k of KEYS) o[k] = r[k] ?? ''
    return o
  })

  return (
    <DataState
      loading={loading}
      error={error}
      empty={risks.length === 0}
      emptyTitle="No property schedule is on file."
      emptyHint="Property All Risk items are read from the insurer's own schedule. Nothing has been loaded for this country."
      onRetry={onRetry}
    >
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi icon={Boxes} label="Insured property value" value={moneyOf(property?.totalValue)}
            basis={`Across ${count(risks.length)} scheduled item(s)`} />
          <Kpi label="Premium" value={moneyOf(property?.premium)}
            basis="Only the items that state a premium" />
          <Kpi icon={Building2} label="Locations" value={count(locations)}
            basis={canResolve
              ? `${count(unresolvedCount)} not found in the site register`
              : 'Site register not available, so no name check was made'}
            tone={canResolve && unresolvedCount ? 'warn' : 'neutral'} />
          <Kpi icon={MapPin} label="Items with GPS" value={`${count(withGps)} of ${count(risks.length)}`}
            basis="Coordinates as printed on the schedule" />
        </div>

        <SectionCard title="Insured value by location" subtitle="The insurer's own location names">
          <BarList rows={barData} colorAt={colorAt} formatValue={(r) => moneyOf(r.m)}
            emptyText="No location is stated on the property schedule." />
        </SectionCard>

        <SectionCard
          title="Property schedule"
          subtitle={canResolve
            ? 'A location the site register does not hold is flagged rather than renamed, so the reconciliation stays visible.'
            : 'The site register could not be read, so location names are shown exactly as the insurer wrote them with no check.'}
          actions={
            <>
              <ToolButton icon={FileSpreadsheet} disabled={!rows.length}
                onClick={() => exportToExcel(exportRows(), KEYS, HEADERS, reportFileName('Insurance Property Risks', country), 'Property')}>
                Excel
              </ToolButton>
              <ToolButton icon={FileText} disabled={!rows.length}
                onClick={() => exportToPdf(exportRows(), KEYS.map((k, i) => ({ key: k, header: HEADERS[i] })),
                  'Property all risk schedule', reportFileName('Insurance Property Risks', country), 'landscape')}>
                PDF
              </ToolButton>
            </>
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SearchBox value={search} onChange={setSearch} placeholder="Search location, city, item or risk id" />
            <Picker label="Location" value={loc} onChange={setLoc} options={optionsFrom(risks, 'location_name', 'All locations')} />
            <Pill tone="neutral">{count(rows.length)} of {count(risks.length)}</Pill>
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No property item matches these filters.</p>
          ) : (
            <SortTable
              rows={rows}
              maxHeight="30rem"
              columns={[
                {
                  key: 'location_name',
                  header: 'Location',
                  render: (r) => (
                    <span className="flex flex-col gap-1">
                      <span className="text-[var(--text-primary)]">{textOr(r.location_name || r.site)}</span>
                      {r._resolved === false ? <Pill tone="warn">Not in the site register</Pill> : null}
                      {r._viaSite ? <Pill tone="neutral">Matched on site {r.site}</Pill> : null}
                    </span>
                  ),
                },
                { key: 'city', header: 'City' },
                { key: 'item_description', header: 'Item', render: (r) => <span className="block max-w-[22rem] truncate" title={r.item_description || ''}>{textOr(r.item_description)}</span> },
                { key: 'quantity', header: 'Qty', align: 'right', sortValue: (r) => n(r.quantity), render: (r) => count(r.quantity) },
                { key: 'total_value', header: 'Insured value', align: 'right', sortValue: (r) => n(r.total_value), render: (r) => money(r.total_value, r.currency) },
                { key: 'premium', header: 'Premium', align: 'right', sortValue: (r) => n(r.premium), render: (r) => money(r.premium, r.currency) },
                { key: 'period_to', header: 'Cover to', sortValue: (r) => r.period_to || '', render: (r) => dateText(r.period_to, country) },
                {
                  key: 'gps',
                  header: 'GPS',
                  render: (r) => {
                    const lat = n(r.gps_lat); const lng = n(r.gps_lng)
                    if (lat == null || lng == null) return <span className="text-[var(--text-muted)]">N/A</span>
                    const href = safeHref(`https://www.google.com/maps?q=${lat},${lng}`)
                    return href
                      ? <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:underline"><MapPin size={12} /> Map</a>
                      : <span className="text-[var(--text-muted)]">N/A</span>
                  },
                },
              ]}
            />
          )}
        </SectionCard>
      </div>
    </DataState>
  )
}
