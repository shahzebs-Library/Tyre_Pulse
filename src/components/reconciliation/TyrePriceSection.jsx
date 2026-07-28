import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Coins, RefreshCw, AlertTriangle, Undo2, Play, Eye, Info,
} from 'lucide-react'
import {
  runTyrePriceBackfill, undoTyrePriceBackfill, getTyrePriceCoverage,
  currencyFor, SOURCE_META, sourceLabel,
} from '../../lib/api/tyrePriceBackfill'
import { comparableStrength } from '../../lib/tyrePriceRules'
import { toUserMessage } from '../../lib/safeError'

const nf = new Intl.NumberFormat('en-US')
const money = (v, country) => {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return 'N/A'
  const c = currencyFor(country)
  return `${c ? `${c} ` : ''}${nf.format(Math.round(Number(v)))}`
}

/**
 * Tyres with no price, and where a price can honestly come from (V401).
 *
 * Three things this panel refuses to do, each because the data made it
 * necessary:
 *  - it never shows a total across countries, because KSA reports in SAR, UAE in
 *    AED and Egypt in EGP and adding them is meaningless;
 *  - it never applies without a preview, because this writes the figure behind
 *    every CPK in the app;
 *  - it says what an estimate rests on, because a median of one earlier tyre and
 *    a median of ninety are very different claims.
 */
export default function TyrePriceSection() {
  const [coverage, setCoverage] = useState([])
  const [preview, setPreview] = useState(null)
  const [lastBatch, setLastBatch] = useState(null)
  const [country, setCountry] = useState('All')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState(null)
  const [flash, setFlash] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { rows } = await getTyrePriceCoverage()
      setCoverage(rows)
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const countries = useMemo(
    () => ['All', ...coverage.map((r) => r.country).filter(Boolean)],
    [coverage],
  )

  const totalMissing = useMemo(
    // A count is currency-free, so this one IS safe to add across countries.
    () => coverage.reduce((s, r) => s + Number(r.missing || 0), 0),
    [coverage],
  )

  const doPreview = async () => {
    setBusy('preview')
    setFlash(null)
    try {
      const res = await runTyrePriceBackfill({ country, dryRun: true })
      setPreview(res)
      if (!res.rows) {
        setFlash({ tone: 'info', text: 'Nothing can be priced from the evidence available.' })
      }
    } catch (e) {
      setFlash({ tone: 'bad', text: toUserMessage(e) })
    } finally {
      setBusy('')
    }
  }

  const doApply = async () => {
    setBusy('apply')
    try {
      const res = await runTyrePriceBackfill({ country, dryRun: false })
      setLastBatch(res.batch_id || null)
      setPreview(null)
      setFlash({
        tone: 'ok',
        text: `Priced ${nf.format(res.rows || 0)} tyres. You can undo this.`,
      })
      await load()
    } catch (e) {
      setFlash({ tone: 'bad', text: toUserMessage(e) })
    } finally {
      setBusy('')
    }
  }

  const doUndo = async () => {
    setBusy('undo')
    try {
      const res = await undoTyrePriceBackfill(lastBatch)
      setLastBatch(null)
      setFlash({ tone: 'ok', text: `Put ${nf.format(res.restored || 0)} tyres back as they were.` })
      await load()
    } catch (e) {
      setFlash({ tone: 'bad', text: toUserMessage(e) })
    } finally {
      setBusy('')
    }
  }

  const byCountry = preview?.by_country || {}
  const previewCountries = Object.keys(byCountry)

  return (
    <div className="card p-0 overflow-hidden">
      <div className="p-4 border-b border-[var(--border)] flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400"><Coins size={18} /></div>
          <div>
            <h3 className="font-semibold text-[var(--text)]">Tyres with no price</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 max-w-2xl">
              A tyre with no price counts as zero in every cost figure, which makes the
              fleet look cheaper than it is. This fills the gap from the tyre&apos;s own
              purchase where that exists, and otherwise from what the same brand and size
              cost before. A repair is never used as a price, and a tyre replaced under
              warranty is recorded as zero rather than guessed.
            </p>
          </div>
        </div>
        <button onClick={load} className="btn-ghost text-xs inline-flex items-center gap-1.5">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {flash && (
        <div className={`px-4 py-2 text-xs border-b border-[var(--border)] ${
          flash.tone === 'bad' ? 'text-red-300 bg-red-500/10'
            : flash.tone === 'ok' ? 'text-emerald-300 bg-emerald-500/10'
              : 'text-[var(--text-muted)]'}`}>
          {flash.text}
        </div>
      )}

      {error && (
        <div className="p-4 text-xs text-red-300 flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
          <button onClick={load} className="btn-ghost text-xs ml-2">Retry</button>
        </div>
      )}

      {loading && !error && (
        <div className="p-4 text-xs text-[var(--text-muted)]">Checking which tyres have a price...</div>
      )}

      {!loading && !error && (
        <>
          {/* coverage per country - never a blended total */}
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {coverage.map((r) => (
              <div key={r.country} className="rounded-lg border border-[var(--border)] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[var(--text)]">{r.country}</span>
                  <span className={`text-xs ${Number(r.coverage_pct) >= 90 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {r.coverage_pct === null ? 'N/A' : `${r.coverage_pct}% priced`}
                  </span>
                </div>
                <div className="text-xs text-[var(--text-muted)] mt-1">
                  {nf.format(r.missing)} of {nf.format(r.tyres)} have no price
                </div>
                {Number(r.filled_by_backfill) > 0 && (
                  <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    {nf.format(r.filled_by_backfill)} filled by this tool
                  </div>
                )}
                {Number(r.missing_no_brand_or_size) > 0 && (
                  /* Naming the blocker matters: with no brand or size there is
                     nothing to compare against, which is a data gap and not a
                     failure of the tool. */
                  <div className="text-[11px] text-amber-400/80 mt-0.5">
                    {nf.format(r.missing_no_brand_or_size)} cannot be compared - no brand or size
                  </div>
                )}
              </div>
            ))}
            {coverage.length === 0 && (
              <div className="text-xs text-[var(--text-muted)]">No tyre records to check.</div>
            )}
          </div>

          {totalMissing > 0 && (
            <div className="px-4 pb-4 flex items-center gap-2 flex-wrap">
              <select
                value={country}
                onChange={(e) => { setCountry(e.target.value); setPreview(null) }}
                className="input text-xs py-1.5"
              >
                {countries.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button
                onClick={doPreview}
                disabled={!!busy}
                className="btn-secondary text-xs inline-flex items-center gap-1.5"
              >
                <Eye size={13} /> {busy === 'preview' ? 'Working it out...' : 'Show me what would change'}
              </button>
              {preview?.rows > 0 && (
                <button
                  onClick={doApply}
                  disabled={!!busy}
                  className="btn-primary text-xs inline-flex items-center gap-1.5"
                >
                  <Play size={13} /> {busy === 'apply' ? 'Applying...' : `Apply to ${nf.format(preview.rows)} tyres`}
                </button>
              )}
              {lastBatch && (
                <button
                  onClick={doUndo}
                  disabled={!!busy}
                  className="btn-ghost text-xs inline-flex items-center gap-1.5"
                >
                  <Undo2 size={13} /> {busy === 'undo' ? 'Undoing...' : 'Undo that'}
                </button>
              )}
            </div>
          )}

          {/* the preview, per country, each in its own currency */}
          {preview && preview.rows > 0 && (
            <div className="border-t border-[var(--border)] p-4 space-y-3">
              <div className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
                <Info size={13} />
                Nothing has changed yet. Each country is shown in its own currency, because
                adding them together would not mean anything.
              </div>
              {previewCountries.map((c) => {
                const d = byCountry[c] || {}
                const sources = d.by_source || {}
                return (
                  <div key={c} className="rounded-lg border border-[var(--border)] p-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="text-sm font-medium text-[var(--text)]">{c}</span>
                      <span className="text-xs text-[var(--text-muted)]">
                        {nf.format(d.rows)} tyres, {money(d.value, c)} in total,
                        typically {money(d.median_price, c)} each
                      </span>
                    </div>
                    <div className="mt-2 space-y-1">
                      {Object.entries(sources).map(([src, s]) => (
                        <div key={src} className="flex items-start justify-between gap-3 text-xs">
                          <div>
                            <span className="text-[var(--text)]">{sourceLabel(src)}</span>
                            <span className="text-[var(--text-muted)]"> - {SOURCE_META[src]?.detail}</span>
                          </div>
                          <span className="text-[var(--text-muted)] whitespace-nowrap">
                            {nf.format(s.rows)} at {money(s.median_price, c)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}

              {Array.isArray(preview.sample) && preview.sample.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-[var(--text-muted)]">
                      <tr className="text-left">
                        <th className="py-1.5 pr-3">Asset</th>
                        <th className="py-1.5 pr-3">Serial</th>
                        <th className="py-1.5 pr-3">Country</th>
                        <th className="py-1.5 pr-3 text-right">Price</th>
                        <th className="py-1.5">How</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sample.map((r, i) => (
                        <tr key={i} className="border-t border-[var(--border)]">
                          <td className="py-1.5 pr-3">{r.asset_no || 'N/A'}</td>
                          <td className="py-1.5 pr-3 text-[var(--text-muted)]">{r.serial_no || 'N/A'}</td>
                          <td className="py-1.5 pr-3">{r.country}</td>
                          <td className="py-1.5 pr-3 text-right">{money(r.now, r.country)}</td>
                          <td className="py-1.5">
                            {sourceLabel(r.source)}
                            {r.source === 'comparable' && (
                              <span className="text-[var(--text-muted)]">
                                {' '}- {comparableStrength(r.samples).label}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.rows > preview.sample.length && (
                    <div className="text-[11px] text-[var(--text-muted)] mt-2">
                      Showing the {preview.sample.length} highest of {nf.format(preview.rows)}.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
