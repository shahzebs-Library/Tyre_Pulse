import { useCallback, useEffect, useMemo, useState } from 'react'
import { ShieldCheck, RefreshCw, Download, AlertTriangle } from 'lucide-react'
import { getTyreEvidenceAudit, listEvidenceRows } from '../../lib/api/tyreEvidenceAudit'
import {
  EVIDENCE_CLASSES, COVERAGE_LABEL, MONTHLY_EXPORT_COLUMNS, EVIDENCE_EXPORT_COLUMNS,
  shapeAudit, coverageSummary, evidenceExportRows, TRUSTED_FROM,
} from '../../lib/tyreEvidenceAudit'
import { toUserMessage } from '../../lib/safeError'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import { useSettings } from '../../contexts/SettingsContext'

const COUNTRIES = ['KSA', 'UAE', 'Egypt']
const fmt = (n) => (n == null ? 'N/A' : Number(n).toLocaleString('en-US'))
const STATUS_TONE = {
  RECONCILED: '#16a34a', UNDER_RECORDED: '#d97706', OVER_RECORDED: '#dc2626',
  NO_ERP_ISSUES: '#7c3aed', NO_FITMENTS: '#6b7280', LOW_VOLUME: 'var(--text-muted)',
}

/**
 * Tyre data accuracy from 1 January 2025 onward. Read only: every fitment is
 * classified by its evidence, the legacy tyres still marked active are reviewed,
 * and each month's recorded installations are compared with the tyres the ERP
 * issued. Nothing here changes a record; corrections are proposals for the owner.
 */
export default function TyreEvidenceAuditSection() {
  const { activeCountry } = useSettings() || {}
  const [country, setCountry] = useState(activeCountry && activeCountry !== 'All' ? activeCountry : '')
  const [audit, setAudit] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [exporting, setExporting] = useState(null)
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setAudit(shapeAudit(await getTyreEvidenceAudit({ country })))
    } catch (e) {
      setAudit(null)
      setError(toUserMessage(e, 'The tyre accuracy audit could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [country])

  useEffect(() => { load() }, [load])

  const coverage = useMemo(() => coverageSummary(audit?.monthly), [audit])

  const exportMonthly = () => {
    if (!audit?.monthly?.length) return
    exportToExcel(audit.monthly, MONTHLY_EXPORT_COLUMNS.map((c) => c[0]), MONTHLY_EXPORT_COLUMNS.map((c) => c[1]),
      reportFileName('Tyre monthly reconciliation', country || 'All countries'))
  }

  const exportClass = async (cls) => {
    setExporting(cls)
    setNotice(null)
    try {
      const { rows, truncated } = await listEvidenceRows({ country, evidenceClass: cls })
      if (!rows.length) { setNotice('No records in this class.'); return }
      exportToExcel(evidenceExportRows(rows), EVIDENCE_EXPORT_COLUMNS.map((c) => c[0]), EVIDENCE_EXPORT_COLUMNS.map((c) => c[1]),
        reportFileName('Tyre evidence', cls, country || 'All countries'))
      if (truncated) setNotice('The export stopped at 20,000 records. Narrow it by country.')
    } catch (e) {
      setNotice(toUserMessage(e, 'The records could not be exported.'))
    } finally {
      setExporting(null)
    }
  }

  return (
    <section className="card p-4 space-y-4" aria-labelledby="tyre-evidence-title">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} aria-hidden="true" />
          <h3 id="tyre-evidence-title" className="font-semibold">Tyre data accuracy from {TRUSTED_FROM}</h3>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-[var(--text-secondary)]" htmlFor="tea-country">Country</label>
          <select id="tea-country" className="input text-sm" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">All I can see</option>
            {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="button" className="btn-secondary text-sm" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
          </button>
        </div>
      </div>
      <p className="text-xs text-[var(--text-secondary)]">
        Read only. Every fitment from {TRUSTED_FROM} is classified by the evidence behind it. Records before that date
        are kept as they are; the ones still marked active are reviewed below. No record is changed from here.
      </p>

      {error && (
        <div role="alert" className="flex items-center gap-2 text-sm text-red-500">
          <AlertTriangle size={14} aria-hidden="true" /> {error}
          <button type="button" className="underline" onClick={load}>Retry</button>
        </div>
      )}
      {loading && !audit && <p className="text-sm text-[var(--text-secondary)]">Checking every fitment...</p>}
      {notice && <p className="text-sm text-[var(--text-secondary)]">{notice}</p>}

      {audit && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--text-secondary)]">
                  <th className="py-1 pr-3">Country</th>
                  {EVIDENCE_CLASSES.map((c) => <th key={c.id} className="py-1 pr-3" title={c.note}>{c.label}</th>)}
                  <th className="py-1 pr-3">Total</th>
                  <th className="py-1">Verified share</th>
                </tr>
              </thead>
              <tbody>
                {audit.classes.length === 0 && (
                  <tr><td colSpan={EVIDENCE_CLASSES.length + 3} className="py-2 text-[var(--text-secondary)]">No fitments from {TRUSTED_FROM} in this scope.</td></tr>
                )}
                {audit.classes.map((r) => (
                  <tr key={r.country} className="border-t border-[var(--border)]">
                    <td className="py-1 pr-3 font-medium">{r.country}</td>
                    {EVIDENCE_CLASSES.map((c) => (
                      <td key={c.id} className="py-1 pr-3 tabular-nums">
                        <button type="button" className="underline-offset-2 hover:underline disabled:opacity-50"
                          style={{ color: c.tone }} disabled={!r.counts[c.id] || exporting === c.id}
                          onClick={() => exportClass(c.id)} title={`Download the ${c.label.toLowerCase()} records`}>
                          {fmt(r.counts[c.id])}
                        </button>
                      </td>
                    ))}
                    <td className="py-1 pr-3 tabular-nums">{fmt(r.total)}</td>
                    <td className="py-1 tabular-nums">{r.verifiedPct == null ? 'N/A' : `${r.verifiedPct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-[var(--text-muted)] mt-1">Click a number to download those records with their reasons.</p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {audit.flags.map((f) => (
              <div key={f.country} className="rounded border border-[var(--border)] p-3">
                <p className="font-medium text-sm mb-1">{f.country}: why records are not verified</p>
                <ul className="text-xs space-y-0.5">
                  {f.reasons.slice(0, 10).map((x) => (
                    <li key={x.reason} className="flex justify-between gap-2">
                      <span className="text-[var(--text-secondary)]">{x.label}</span>
                      <span className="tabular-nums">{fmt(x.count)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div>
            <p className="font-medium text-sm mb-1">Legacy tyres (fitted before {TRUSTED_FROM}) still marked active: {fmt(audit.legacy.length)}</p>
            {audit.legacy.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)]">None in this scope.</p>
            ) : (
              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[var(--text-secondary)]">
                      <th className="pr-2">Country</th><th className="pr-2">Asset</th><th className="pr-2">Position</th>
                      <th className="pr-2">Serial</th><th className="pr-2">Fitted</th><th className="pr-2">Finding</th><th>Proposed (not applied)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.legacy.map((l) => (
                      <tr key={l.id} className="border-t border-[var(--border)]">
                        <td className="pr-2">{l.country}</td><td className="pr-2">{l.asset_no}</td><td className="pr-2">{l.position}</td>
                        <td className="pr-2">{l.serial_no || 'Serial not verified'}</td><td className="pr-2">{String(l.fit_date || '').slice(0, 10)}</td>
                        <td className="pr-2">{l.findingLabel}{l.serial_next_asset ? ` (${l.serial_next_asset} ${l.serial_next_position || ''} on ${l.serial_next_fit_date})` : ''}</td>
                        <td>{l.actionLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="font-medium text-sm">Monthly installations recorded vs tyres the ERP issued</p>
              <button type="button" className="btn-secondary text-xs" onClick={exportMonthly} disabled={!audit.monthly.length}>
                <Download size={12} aria-hidden="true" /> Excel
              </button>
            </div>
            <p className="text-xs text-[var(--text-secondary)] mb-2">
              Installs = new physical tyres + fitments with a serial that is not verified, minus identical copies. Refits are a reused
              tyre and are not compared. A month outside +/-15% is not reliable for consumption from fitment records alone.
            </p>
            <div className="flex flex-wrap gap-3 text-xs mb-2">
              {Object.entries(coverage).map(([c, s]) => (
                <span key={c}>
                  <strong>{c}</strong>: {fmt(s.RECONCILED || 0)} of {fmt(s.months)} months reconciled
                </span>
              ))}
            </div>
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--text-secondary)]">
                    <th className="pr-2">Country</th><th className="pr-2">Month</th><th className="pr-2">Installs</th>
                    <th className="pr-2">ERP issued</th><th className="pr-2">Ratio</th><th className="pr-2">Coverage</th>
                    <th className="pr-2">Refits</th><th className="pr-2">Removals</th><th className="pr-2">Scrapped</th><th>ERP tyre cost</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.monthly.map((m) => (
                    <tr key={`${m.country}-${m.month}`} className="border-t border-[var(--border)] tabular-nums">
                      <td className="pr-2">{m.country}</td><td className="pr-2">{m.month}</td><td className="pr-2">{fmt(m.installs)}</td>
                      <td className="pr-2">{fmt(m.issued)}</td><td className="pr-2">{m.ratio == null ? 'N/A' : m.ratio}</td>
                      <td className="pr-2" style={{ color: STATUS_TONE[m.status] }}>{COVERAGE_LABEL[m.status]}</td>
                      <td className="pr-2">{fmt(m.refits)}</td><td className="pr-2">{fmt(m.removals)}</td><td className="pr-2">{fmt(m.scrapped)}</td>
                      <td>{m.gridTyreCost == null ? 'N/A' : `${m.currency || ''} ${fmt(Math.round(m.gridTyreCost))}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
