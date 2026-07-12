/**
 * DigitalTwin (routes /digital-twin and /digital-twin/:assetNo) — ported concept
 * from tyre_saas's Digital Twin, wired to Tyre Pulse data. Look up a vehicle and
 * see its live "digital twin": every in-service tyre position laid out with a
 * per-position health score (tread, pressure, age band, CPK), plus an overall
 * vehicle health score and the single worst position to act on. Runs entirely on
 * the existing `tyre_records` table — no new data required.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Cpu, Search, Truck, Gauge, Activity, AlertTriangle, ArrowLeft, CircleDot,
  Loader2, Package, MapPin, Wind, Clock, DollarSign, ShieldCheck,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { getAssetTwinRecords, searchAssets } from '../lib/api/digitalTwin'
import { buildTwin, healthBand } from '../lib/digitalTwin'
import { AGE_BAND_META } from '../lib/tyreAge'

const AGE_BADGE = {
  non_compliant: 'bg-red-900/40 text-red-300 border border-red-700/50',
  advisory: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  compliant: 'bg-green-900/40 text-green-300 border border-green-700/50',
  unknown: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}
const HEALTH_HEX = { green: '#22c55e', amber: '#f59e0b', red: '#ef4444', slate: '#64748b' }

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
      try { setResults(await searchAssets(q, { country })); setOpen(true) }
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
          placeholder="Search a vehicle / asset number…"
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
              key={r.asset_no}
              type="button"
              onClick={() => { setOpen(false); onPick(r.asset_no) }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--surface-1)]"
            >
              <CircleDot size={14} className="text-[var(--text-muted)] shrink-0" />
              <span className="font-mono text-[var(--text-primary)]">{r.asset_no}</span>
              <span className="text-xs text-[var(--text-muted)] truncate">
                {[r.brand, r.site, `${r.tyreCount} fitted`].filter(Boolean).join(' · ')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Circular health gauge (0-100) rendered with an SVG stroke arc. */
function HealthRing({ score, size = 132, stroke = 12 }) {
  const band = healthBand(score)
  const color = HEALTH_HEX[band.tone] || HEALTH_HEX.slate
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score))
  const offset = c - (pct / 100) * c
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--input-border)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset .6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-[var(--text-primary)]">{score == null ? '—' : score}</span>
        <span className="text-[11px] uppercase tracking-wider" style={{ color }}>{band.label}</span>
      </div>
    </div>
  )
}

/** Horizontal tread bar (0-100 health) for a single position card. */
function TreadBar({ health }) {
  const band = healthBand(health)
  const color = HEALTH_HEX[band.tone] || HEALTH_HEX.slate
  return (
    <div className="h-2 rounded-full bg-[var(--input-bg)] overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${health == null ? 0 : health}%`, background: color, transition: 'width .5s ease' }} />
    </div>
  )
}

function PositionCard({ p, money }) {
  const band = healthBand(p.health)
  const color = HEALTH_HEX[band.tone] || HEALTH_HEX.slate
  const ageMeta = AGE_BAND_META[p.ageBand] || AGE_BAND_META.unknown
  return (
    <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: `${color}55`, background: 'var(--surface-2)' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{p.position || 'Unlabelled position'}</p>
          <p className="text-xs font-mono text-[var(--text-muted)] truncate">{p.serial || 'No serial'}</p>
        </div>
        <span className="text-xl font-bold shrink-0" style={{ color }}>{p.health == null ? '—' : p.health}</span>
      </div>

      <TreadBar health={p.health} />

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <span className="flex items-center gap-1.5 text-[var(--text-muted)]"><Gauge size={12} /> Tread</span>
        <span className="text-right text-[var(--text-secondary)]">{p.tread == null ? '—' : `${p.tread} mm`}</span>
        <span className="flex items-center gap-1.5 text-[var(--text-muted)]"><Wind size={12} /> Pressure</span>
        <span className="text-right text-[var(--text-secondary)]">{p.pressure == null ? '—' : `${p.pressure} bar`}</span>
        <span className="flex items-center gap-1.5 text-[var(--text-muted)]"><Clock size={12} /> Age</span>
        <span className="text-right text-[var(--text-secondary)]">{p.ageYears == null ? '—' : `${p.ageYears} yr`}</span>
        <span className="flex items-center gap-1.5 text-[var(--text-muted)]"><DollarSign size={12} /> CPK</span>
        <span className="text-right text-[var(--text-secondary)]">{p.cpk == null ? '—' : money(p.cpk)}</span>
      </div>

      <span className={`badge inline-block text-[10px] px-2 py-0.5 rounded ${AGE_BADGE[p.ageBand] || AGE_BADGE.unknown}`}>{ageMeta.label}</span>
    </div>
  )
}

export default function DigitalTwin() {
  const { assetNo } = useParams()
  const navigate = useNavigate()
  const { activeCountry, activeCurrency } = useSettings()
  const [records, setRecords] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (an) => {
    if (!an) { setRecords(null); return }
    setLoading(true); setError('')
    try {
      setRecords(await getAssetTwinRecords(an, { country: activeCountry }))
    } catch (err) {
      setError(err?.message || 'Could not load this vehicle.'); setRecords([])
    } finally { setLoading(false) }
  }, [activeCountry])

  useEffect(() => { if (assetNo) load(assetNo) }, [assetNo, load])

  const twin = useMemo(
    () => (records && records.length ? buildTwin(records, { now: Date.now() }) : null),
    [records],
  )
  // CPK is a small per-km figure — show 3 decimals rather than compact rounding.
  const money = (v) => (v == null ? '—' : `${activeCurrency} ${Number(v).toFixed(3)}`)

  const avgCpk = useMemo(() => {
    if (!twin) return null
    const vals = twin.positions.map((p) => p.cpk).filter((v) => v != null)
    return vals.length ? Math.round((vals.reduce((a, v) => a + v, 0) / vals.length) * 1000) / 1000 : null
  }, [twin])

  const gotoPick = (an) => navigate(`/digital-twin/${encodeURIComponent(an)}`)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Digital Twin"
        subtitle="Look up any vehicle to see its live tyre twin — per-position health, tread, pressure, age and CPK, with an overall vehicle health score."
        icon={Cpu}
        actions={assetNo ? <button onClick={() => navigate('/digital-twin')} className="btn-secondary text-sm inline-flex items-center gap-1.5"><ArrowLeft size={14} /> New search</button> : null}
      />

      {!assetNo && (
        <div className="card space-y-3">
          <p className="text-sm text-[var(--text-secondary)]">Enter an asset / vehicle number to build its digital twin.</p>
          <SearchBox country={activeCountry} onPick={gotoPick} />
        </div>
      )}

      {assetNo && (
        <>
          <div className="card"><SearchBox country={activeCountry} onPick={gotoPick} /></div>

          {loading ? (
            <div className="card animate-pulse h-48" />
          ) : error ? (
            <div className="card border border-red-800/50 flex items-start gap-3">
              <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
              <div><p className="text-red-300 font-medium">Couldn't load this vehicle.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
            </div>
          ) : !twin ? (
            <div className="card text-center py-12 space-y-2">
              <Package size={30} className="mx-auto text-[var(--text-muted)]" />
              <p className="text-[var(--text-primary)] font-semibold">No fitted tyres for “{assetNo}”.</p>
              <p className="text-sm text-[var(--text-muted)]">This asset has no in-service tyre records. Check the asset number or try another.</p>
            </div>
          ) : (
            <>
              {/* Vehicle health header */}
              <div className="card flex flex-col sm:flex-row items-center gap-6">
                <HealthRing score={twin.healthScore} />
                <div className="flex-1 w-full space-y-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Vehicle</p>
                      <p className="text-2xl font-bold font-mono text-[var(--text-primary)] flex items-center gap-2"><Truck size={20} className="text-[var(--text-muted)]" />{twin.asset_no || assetNo}</p>
                    </div>
                    {twin.worstPosition && (
                      <span className="badge text-xs px-2.5 py-1 rounded bg-amber-900/40 text-amber-300 border border-amber-700/50 inline-flex items-center gap-1.5">
                        <AlertTriangle size={12} /> Worst: {twin.worstPosition}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: 'Fitted tyres', value: twin.tyreCount, icon: CircleDot },
                      { label: 'Health score', value: twin.healthScore == null ? '—' : `${twin.healthScore}/100`, icon: ShieldCheck },
                      { label: 'Worst position', value: twin.worstPosition || '—', icon: MapPin },
                      { label: 'Avg CPK', value: avgCpk == null ? '—' : money(avgCpk), icon: Activity },
                    ].map((k) => {
                      const Icon = k.icon
                      return (
                        <div key={k.label} className="rounded-lg bg-[var(--input-bg)]/50 p-3">
                          <div className="flex items-center justify-between"><span className="text-xs text-[var(--text-muted)]">{k.label}</span><Icon size={14} className="text-[var(--text-muted)]" /></div>
                          <p className="text-lg font-bold text-[var(--text-primary)] mt-0.5 truncate">{k.value}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Position grid */}
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Tyre positions</h3>
                  <span className="text-xs text-[var(--text-muted)]">{twin.tyreCount} in service</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {twin.positions.map((p) => (
                    <PositionCard key={p.id ?? `${p.position}-${p.serial}`} p={p} money={money} />
                  ))}
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-4 flex items-center gap-1.5">
                  <Activity size={12} /> Health blends tread depth, age band and pressure per position; the vehicle score is the mean across fitted tyres.
                </p>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
