/**
 * TyrePassport (routes /tyre-passport and /tyre-passport/:serial) — ported from
 * tyre_saas. A per-tyre "passport": look up a serial and see that physical
 * tyre's complete lifecycle from `tyre_records` — identity, lifetime totals
 * (km / hours / cost / CPK), the assets it ran on, and a chronological event
 * timeline. Runs entirely on existing data.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ScanLine, Search, Truck, MapPin, Gauge, DollarSign, Clock, Calendar,
  AlertTriangle, ArrowLeft, CircleDot, Loader2, Package, Activity,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact, formatDate } from '../lib/formatters'
import { getPassportRecords, searchSerials } from '../lib/api/tyrePassport'
import { buildPassport } from '../lib/tyrePassport'

const STATUS_TONE = (s) => {
  const v = String(s || '').toLowerCase()
  if (/scrap|remov/.test(v)) return 'bg-red-900/40 text-red-300 border border-red-700/50'
  if (/service|fit|active|in_service/.test(v)) return 'bg-green-900/40 text-green-300 border border-green-700/50'
  return 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]'
}

function SearchBox({ country, onPick }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (q.trim().length < 2) { setResults([]); return undefined }
    timer.current = setTimeout(async () => {
      setLoading(true)
      try { setResults(await searchSerials(q, { country })); setOpen(true) }
      catch { setResults([]) }
      finally { setLoading(false) }
    }, 250)
    return () => timer.current && clearTimeout(timer.current)
  }, [q, country])

  return (
    <div className="relative max-w-xl">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
        <input
          className="input pl-9 w-full"
          placeholder="Search a tyre serial number…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) onPick(q.trim()) }}
        />
        {loading && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[var(--text-muted)]" />}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-[var(--input-border)] bg-[var(--surface-2)] shadow-xl py-1">
          {results.map((r) => (
            <button
              key={r.serial}
              type="button"
              onClick={() => { setOpen(false); onPick(r.serial) }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--surface-1)]"
            >
              <CircleDot size={14} className="text-[var(--text-muted)] shrink-0" />
              <span className="font-mono text-[var(--text-primary)]">{r.serial}</span>
              <span className="text-xs text-[var(--text-muted)] truncate">{[r.brand, r.size, r.asset_no].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function TyrePassport() {
  const { serial } = useParams()
  const navigate = useNavigate()
  const { activeCountry, activeCurrency } = useSettings()
  const [records, setRecords] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (sn) => {
    if (!sn) { setRecords(null); return }
    setLoading(true); setError('')
    try {
      setRecords(await getPassportRecords(sn, { country: activeCountry }))
    } catch (err) {
      setError(err?.message || 'Could not load this tyre.'); setRecords([])
    } finally { setLoading(false) }
  }, [activeCountry])

  useEffect(() => { if (serial) load(serial) }, [serial, load])

  const passport = useMemo(() => buildPassport(records || []), [records])
  const money = (v) => (v == null ? '—' : formatCurrencyCompact(v, activeCurrency))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tyre Passport"
        subtitle="Look up any tyre serial to see its full lifecycle — assets, distance, cost and CPK."
        icon={ScanLine}
        actions={serial ? <button onClick={() => navigate('/tyre-passport')} className="btn-secondary text-sm inline-flex items-center gap-1.5"><ArrowLeft size={14} /> New search</button> : null}
      />

      {!serial && (
        <div className="card space-y-3">
          <p className="text-sm text-[var(--text-secondary)]">Enter a serial number to open its passport.</p>
          <SearchBox country={activeCountry} onPick={(sn) => navigate(`/tyre-passport/${encodeURIComponent(sn)}`)} />
        </div>
      )}

      {serial && (
        <>
          <div className="card"><SearchBox country={activeCountry} onPick={(sn) => navigate(`/tyre-passport/${encodeURIComponent(sn)}`)} /></div>

          {loading ? (
            <div className="card animate-pulse h-40" />
          ) : error ? (
            <div className="card border border-red-800/50 flex items-start gap-3">
              <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
              <div><p className="text-red-300 font-medium">Couldn't load this tyre.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
            </div>
          ) : !passport ? (
            <div className="card text-center py-12 space-y-2">
              <Package size={30} className="mx-auto text-[var(--text-muted)]" />
              <p className="text-[var(--text-primary)] font-semibold">No records for “{serial}”.</p>
              <p className="text-sm text-[var(--text-muted)]">Check the serial or try a different one.</p>
            </div>
          ) : (
            <>
              {/* Identity card */}
              <div className="card">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Serial</p>
                    <p className="text-2xl font-bold font-mono text-[var(--text-primary)]">{passport.serial || '—'}</p>
                    <p className="text-sm text-[var(--text-muted)] mt-1">{[passport.brand, passport.size, passport.supplier].filter(Boolean).join(' · ') || 'No brand/size on record'}</p>
                  </div>
                  <span className={`badge text-xs px-2.5 py-1 rounded ${STATUS_TONE(passport.status)}`}>{String(passport.status || 'unknown').replace(/_/g, ' ')}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                  {[
                    { label: 'Lifetime km', value: passport.totals.km ? passport.totals.km.toLocaleString() : '—', icon: Gauge },
                    { label: 'Lifetime cost', value: money(passport.totals.cost), icon: DollarSign },
                    { label: 'CPK', value: passport.totals.cpk == null ? '—' : money(passport.totals.cpk), icon: Activity },
                    { label: 'Records', value: passport.recordCount, icon: Package },
                  ].map((k) => {
                    const Icon = k.icon
                    return (
                      <div key={k.label} className="rounded-lg bg-[var(--input-bg)]/50 p-3">
                        <div className="flex items-center justify-between"><span className="text-xs text-[var(--text-muted)]">{k.label}</span><Icon size={14} className="text-[var(--text-muted)]" /></div>
                        <p className="text-lg font-bold text-[var(--text-primary)] mt-0.5">{k.value}</p>
                      </div>
                    )
                  })}
                </div>
                {passport.assets.length > 0 && (
                  <p className="text-xs text-[var(--text-muted)] mt-3 flex items-center gap-1.5 flex-wrap">
                    <Truck size={12} /> Ran on:
                    {passport.assets.map((a) => <span key={a} className="font-mono text-[var(--text-secondary)]">{a}</span>)}
                  </p>
                )}
              </div>

              {/* Lifecycle timeline */}
              <div className="card">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Lifecycle timeline</h3>
                <ol className="relative border-l border-[var(--input-border)] ml-2 space-y-5">
                  {passport.events.map((e, i) => (
                    <li key={e.id ?? i} className="ml-4">
                      <span className="absolute -left-[7px] w-3 h-3 rounded-full bg-[var(--brand-bright)] border-2 border-[var(--surface-1)]" />
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                          <Calendar size={12} className="text-[var(--text-muted)]" />
                          {e.fitment_date ? `Fitted ${formatDate(e.fitment_date)}` : e.date ? formatDate(e.date) : 'Undated'}
                          {e.removal_date && <span className="text-[var(--text-muted)]">→ removed {formatDate(e.removal_date)}</span>}
                        </p>
                        {e.status && <span className={`badge text-[10px] px-2 py-0.5 rounded ${STATUS_TONE(e.status)}`}>{String(e.status).replace(/_/g, ' ')}</span>}
                      </div>
                      <div className="text-xs text-[var(--text-muted)] mt-1 flex flex-wrap gap-x-4 gap-y-1">
                        {e.asset_no && <span className="flex items-center gap-1"><Truck size={11} /> {e.asset_no}</span>}
                        {e.position && <span>Pos: {e.position}</span>}
                        {e.site && <span className="flex items-center gap-1"><MapPin size={11} /> {e.site}</span>}
                        {e.km != null && <span className="flex items-center gap-1"><Gauge size={11} /> {e.km.toLocaleString()} km</span>}
                        {e.cost != null && <span className="flex items-center gap-1"><DollarSign size={11} /> {money(e.cost)}</span>}
                        {e.reason && <span className="text-amber-400/90">Reason: {e.reason}</span>}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
