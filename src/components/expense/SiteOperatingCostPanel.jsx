import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapPin, AlertTriangle, Info } from 'lucide-react'
import { getSiteOperatingCostMulti, storeVsOperating } from '../../lib/api/siteOperatingCost'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'

/**
 * What each site costs to RUN, as opposed to which store issued the parts.
 *
 * The two are not the same and the difference is large. The -ST names are spare
 * parts stores, so an expense line's own site says where stock was drawn from.
 * Diriyah's store issued SAR 729,121 while only SAR 2,335 of work happened at a
 * site called DIRIYAH - the machines are at DIRIYAH-G1 and G2 and draw from the
 * one store that serves them.
 *
 * This reads cost through the asset instead, which is the only way to answer
 * "what does this gate cost me". It publishes its own coverage: a per-site total
 * that quietly omits unmatched lines is a figure nobody can reconcile.
 */
export default function SiteOperatingCostPanel({ country, from, to, money }) {
  const [state, setState] = useState({ loading: true, ok: false })
  const [showStores, setShowStores] = useState(false)

  // Read through the scope-aware aggregate even for one country (V544). The
  // single-country function it wraps has no country ABAC guard - asked for a
  // country the caller may not see it answers anyway - so going through the
  // guarded wrapper means this panel can never render a country the reader is
  // not entitled to, whatever it is handed.
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const scoped = country && country !== 'All' ? [country] : []
    const res = await getSiteOperatingCostMulti({ countries: scoped, from, to })
    const block = res.blocks[0]
    setState(block
      ? { loading: false, ok: true, coverage: block.coverage, bySite: block.bySite, byStore: block.byStore }
      : { loading: false, ok: false })
  }, [country, from, to])

  useEffect(() => { load() }, [load])

  const gaps = useMemo(
    () => storeVsOperating(state.bySite, state.byStore).filter((g) => g.gap == null || Math.abs(g.gap) > 1000),
    [state.bySite, state.byStore],
  )

  // A single country only. Each country reports in its own currency, so a
  // combined site table would add SAR, AED and EGP and mean nothing.
  const isAll = !country || country === 'All'

  if (state.loading) {
    return (
      <section className="card">
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Working out what each site costs...</p>
      </section>
    )
  }

  // Silently absent rather than broken when the backend predates V512.
  if (!state.ok) return null

  const rows = (state.bySite || []).filter((r) => !isAll || r.resolved)
  const cov = state.coverage

  const download = () => exportToExcel(
    rows.map((r) => ({
      site: r.site, country: r.country, currency: r.currency,
      total: r.total, tyre: r.tyre, spare: r.spare, oil: r.oil,
      lines: r.lines, assets: r.assets,
    })),
    ['site', 'country', 'currency', 'total', 'tyre', 'spare', 'oil', 'lines', 'assets'],
    ['Site', 'Country', 'Currency', 'Total', 'Tyres', 'Spare parts', 'Oil', 'Lines', 'Assets'],
    reportFileName('Cost per site'),
  )

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2"
            style={{ color: 'var(--text-secondary)' }}>
          <MapPin size={15} /> What each site costs to run
        </h2>
        <button onClick={download} disabled={!rows.length} className="btn-secondary text-xs">
          Excel
        </button>
      </div>

      <div className="card space-y-3">
        <p className="text-xs flex items-start gap-2" style={{ color: 'var(--text-secondary)' }}>
          <Info size={13} className="mt-0.5 shrink-0" />
          Cost is counted against the site the machine works at, found through its job card.
          The store on an expense line is where the parts were issued from, which is a different
          question - a store can serve several sites.
        </p>

        {cov?.pct != null && (
          <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
            {cov.resolved.toLocaleString()} of {cov.lines.toLocaleString()} expense lines
            ({cov.pct}%) could be traced to an asset.
            {cov.unresolved > 0
              ? ` ${cov.unresolved.toLocaleString()} could not and are listed separately below.`
              : ''}
          </p>
        )}

        {isAll && (
          <p className="text-xs flex items-start gap-2 px-3 py-2 rounded-lg"
             style={{ background: 'rgba(245,158,11,0.1)', color: '#fbbf24' }}>
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            Pick a single country. Each country reports in its own currency, so one
            combined column would add SAR, AED and EGP together.
          </p>
        )}

        {!rows.length ? (
          <p className="text-sm py-4 text-center" style={{ color: 'var(--text-secondary)' }}>
            No expense lines in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--text-muted)' }}>
                  <th className="text-left py-2 pr-3">Site</th>
                  <th className="text-right py-2 px-3">Total</th>
                  <th className="text-right py-2 px-3">Tyres</th>
                  <th className="text-right py-2 px-3">Spare parts</th>
                  <th className="text-right py-2 px-3">Oil</th>
                  <th className="text-right py-2 pl-3">Assets</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.country}-${r.site}`}
                      style={{ borderTop: '1px solid var(--hairline)' }}>
                    <td className="py-2 pr-3" style={{ color: r.resolved ? 'var(--text-primary)' : 'var(--text-dim)' }}>
                      {r.site}
                      {!r.resolved && (
                        <span className="ml-2 text-[11px]" style={{ color: 'var(--text-dim)' }}>
                          no asset on the job card
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right" style={{ color: 'var(--text-primary)' }}>{money(r.total)}</td>
                    <td className="py-2 px-3 text-right" style={{ color: 'var(--text-secondary)' }}>{money(r.tyre)}</td>
                    <td className="py-2 px-3 text-right" style={{ color: 'var(--text-secondary)' }}>{money(r.spare)}</td>
                    <td className="py-2 px-3 text-right" style={{ color: 'var(--text-secondary)' }}>{money(r.oil)}</td>
                    <td className="py-2 pl-3 text-right" style={{ color: 'var(--text-secondary)' }}>
                      {r.assets ? r.assets.toLocaleString() : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {gaps.length > 0 && (
          <div>
            <button onClick={() => setShowStores((v) => !v)} className="btn-secondary text-xs">
              {showStores ? 'Hide' : 'Show'} which store served which site
            </button>
            {showStores && (
              <div className="overflow-x-auto mt-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--text-muted)' }}>
                      <th className="text-left py-2 pr-3">Store</th>
                      <th className="text-right py-2 px-3">Issued from here</th>
                      <th className="text-right py-2 pl-3">Work done here</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gaps.map((g) => (
                      <tr key={g.name} style={{ borderTop: '1px solid var(--hairline)' }}>
                        <td className="py-2 pr-3" style={{ color: 'var(--text-primary)' }}>{g.name}</td>
                        <td className="py-2 px-3 text-right" style={{ color: 'var(--text-secondary)' }}>{money(g.issued)}</td>
                        <td className="py-2 pl-3 text-right" style={{ color: 'var(--text-secondary)' }}>
                          {/* Null is not zero: no asset is registered at a site of
                              this name at all, so it serves other sites entirely. */}
                          {g.worked == null
                            ? <span style={{ color: 'var(--text-dim)' }}>serves other sites</span>
                            : money(g.worked)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
