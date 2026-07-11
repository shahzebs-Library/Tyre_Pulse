import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  AlertTriangle, Activity, ChevronDown, ShieldAlert, ShieldQuestion,
  Zap, Clock, Layers, Repeat, DollarSign, Copy, Fingerprint,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { formatCurrencyCompact } from '../lib/formatters'
import { cn } from '../lib/cn'
import {
  detectAnomalies,
  summariseAnomalies,
  ANOMALY_TYPES,
  ANOMALY_SEVERITY,
  ANOMALY_TYPE_LABELS,
  ANOMALY_TYPE_DESC,
} from '../lib/anomalyEngine'

// ── Data Quality (missing data) — supplementary group the engine does NOT cover ──
const DATA_QUALITY = 'DATA_QUALITY'
const DATA_QUALITY_LABEL = 'Data Quality'
const DATA_QUALITY_DESC = 'Records missing cost, issue date or asset number needed for analytics'

// Per-type presentation metadata (icon + accent) for the rich engine types + DQ.
const TYPE_META = {
  [ANOMALY_TYPES.SHORT_INTERVAL]:   { icon: Clock,        accent: 'text-amber-400' },
  [ANOMALY_TYPES.SAME_DAY_BURST]:   { icon: Layers,       accent: 'text-orange-400' },
  [ANOMALY_TYPES.RAPID_RECURRENCE]: { icon: Repeat,       accent: 'text-red-400' },
  [ANOMALY_TYPES.COST_SPIKE]:       { icon: DollarSign,   accent: 'text-emerald-400' },
  [ANOMALY_TYPES.SERIAL_REUSE]:     { icon: Fingerprint,  accent: 'text-sky-400' },
  [ANOMALY_TYPES.DUPLICATE_ENTRY]:  { icon: Copy,         accent: 'text-violet-400' },
  [DATA_QUALITY]:                   { icon: ShieldQuestion, accent: 'text-gray-400' },
}

// Stable display order for the type filter chips + groups.
const TYPE_ORDER = [
  ANOMALY_TYPES.RAPID_RECURRENCE,
  ANOMALY_TYPES.SERIAL_REUSE,
  ANOMALY_TYPES.DUPLICATE_ENTRY,
  ANOMALY_TYPES.SHORT_INTERVAL,
  ANOMALY_TYPES.SAME_DAY_BURST,
  ANOMALY_TYPES.COST_SPIKE,
  DATA_QUALITY,
]

const LABELS = { ...ANOMALY_TYPE_LABELS, [DATA_QUALITY]: DATA_QUALITY_LABEL }
const DESCS = { ...ANOMALY_TYPE_DESC, [DATA_QUALITY]: DATA_QUALITY_DESC }

const SEVERITY_BADGE = {
  [ANOMALY_SEVERITY.HIGH]:   'bg-red-900/40 text-red-400 border border-red-500/30',
  [ANOMALY_SEVERITY.MEDIUM]: 'bg-amber-900/40 text-amber-400 border border-amber-500/30',
  [ANOMALY_SEVERITY.LOW]:    'bg-emerald-900/40 text-emerald-400 border border-emerald-500/30',
}

/**
 * Supplementary Data-Quality detection. The rule engine intentionally skips
 * missing-field rows (they can't be reasoned about), but the Anomalies page has
 * always surfaced them — keep that so nothing regresses. Each qualifying row is
 * wrapped as a single-record "anomaly" so it renders identically to engine output.
 */
function detectDataQuality(rows) {
  const out = []
  for (const r of rows) {
    const cost = Number(r.cost_per_tyre)
    const hasCost = r.cost_per_tyre != null && r.cost_per_tyre !== '' && Number.isFinite(cost)
    const missing = []
    if (!hasCost) missing.push('cost')
    if (!r.issue_date) missing.push('issue date')
    if (!r.asset_no) missing.push('asset no')
    if (missing.length === 0) continue
    out.push({
      id: `DQ::${r.id}`,
      type: DATA_QUALITY,
      severity: ANOMALY_SEVERITY.LOW,
      asset_no: r.asset_no || '—',
      site: r.site || '—',
      record_ids: [r.id],
      records: [r],
      message: `Missing ${missing.join(', ')} — record cannot be used for CPK / lifecycle analytics`,
      detail: `${r.brand || 'Unknown brand'}${r.serial_no ? ` · serial ${r.serial_no}` : ''}${r.issue_date ? ` · ${r.issue_date}` : ''}`,
    })
  }
  return out
}

export default function Anomalies() {
  const { profile } = useAuth()
  const { activeCountry, activeCurrency } = useSettings()
  const [anomalies, setAnomalies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeType, setActiveType] = useState('ALL')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      let q = supabase
        .from('tyre_records')
        .select('id, issue_date, brand, serial_no, asset_no, site, category, risk_level, cost_per_tyre, qty, country')
        .order('issue_date', { ascending: false, nullsFirst: false })
        .limit(5000)
      if (activeCountry !== 'All' && activeCountry) q = q.eq('country', activeCountry)
      const { data, error: err } = await q
      if (err) throw err
      const rows = data || []
      const engine = detectAnomalies(rows)
      const dq = detectDataQuality(rows)
      setAnomalies([...engine, ...dq])
    } catch (e) {
      setError(e.message || 'Failed to load anomalies')
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // ── Severity KPIs (engine + DQ combined) ─────────────────────────────────
  const summary = useMemo(() => summariseAnomalies(anomalies), [anomalies])

  // ── Per-type counts (drives filter chips) ────────────────────────────────
  const typeCounts = useMemo(() => summary.byType, [summary])

  // ── Filtered set for the active chip ─────────────────────────────────────
  const filtered = useMemo(
    () => (activeType === 'ALL' ? anomalies : anomalies.filter(a => a.type === activeType)),
    [anomalies, activeType],
  )

  // ── Group filtered anomalies by type (stable order) ──────────────────────
  const groups = useMemo(() => {
    const map = new Map()
    for (const a of filtered) {
      if (!map.has(a.type)) map.set(a.type, [])
      map.get(a.type).push(a)
    }
    return TYPE_ORDER
      .filter(t => map.has(t))
      .map(t => ({ type: t, label: LABELS[t], desc: DESCS[t], items: map.get(t) }))
  }, [filtered])

  // Chips: All + only types actually present, in stable order.
  const chips = useMemo(() => {
    const present = TYPE_ORDER.filter(t => typeCounts[t] > 0)
    return [{ type: 'ALL', label: 'All', desc: 'All detected anomalies', count: summary.total }, ...present.map(t => ({
      type: t, label: LABELS[t], desc: DESCS[t], count: typeCounts[t] || 0,
    }))]
  }, [typeCounts, summary.total])

  // Drill-down columns for underlying records (shared across groups).
  const detailColumns = useMemo(() => [
    { id: 'issue_date', header: 'Date', accessorFn: r => r.issue_date ?? '-', size: 110 },
    { id: 'brand', header: 'Brand', accessorFn: r => r.brand ?? '-', size: 120 },
    {
      id: 'serial_no', header: 'Serial No', accessorFn: r => r.serial_no ?? '-', size: 150,
      cell: ({ getValue }) => <span className="font-mono text-xs text-gray-300">{getValue()}</span>,
    },
    {
      id: 'asset_no', header: 'Asset No', accessorFn: r => r.asset_no ?? '-', size: 120,
      cell: ({ getValue }) => <span className="font-mono text-blue-400">{getValue()}</span>,
    },
    { id: 'site', header: 'Site', accessorFn: r => r.site ?? '-', size: 130 },
    {
      id: 'risk_level', header: 'Risk', accessorFn: r => r.risk_level ?? '-', size: 90,
      cell: ({ getValue }) => {
        const v = getValue()
        return (
          <span className={cn(
            'px-1.5 py-0.5 rounded text-xs',
            v === 'High' || v === 'Critical' ? 'bg-red-900/40 text-red-400' :
            v === 'Medium' ? 'bg-yellow-900/40 text-yellow-400' : 'bg-green-900/40 text-green-400',
          )}>{v}</span>
        )
      },
    },
    {
      id: 'cost', header: 'Cost',
      accessorFn: r => (r.cost_per_tyre != null && r.cost_per_tyre !== '' ? Number(r.cost_per_tyre) : null),
      cell: ({ getValue }) => (getValue() != null ? formatCurrencyCompact(getValue(), activeCurrency) : '-'),
      size: 110,
      meta: {
        align: 'right',
        exportValue: r => (r.cost_per_tyre != null && r.cost_per_tyre !== '' ? Number(r.cost_per_tyre) : ''),
      },
    },
  ], [activeCurrency])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Anomaly Intelligence"
        subtitle="Rule-based detection of suspicious tyre records, cost outliers and data quality issues"
        icon={AlertTriangle}
      />

      {/* Severity KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SeverityCard
          label="High Severity" value={summary.bySeverity.high} icon={ShieldAlert}
          valueClass="text-red-400" ringClass="ring-red-500/20"
          hint="Immediate review required"
        />
        <SeverityCard
          label="Medium Severity" value={summary.bySeverity.medium} icon={Zap}
          valueClass="text-amber-400" ringClass="ring-amber-500/20"
          hint="Investigate soon"
        />
        <SeverityCard
          label="Low Severity" value={summary.bySeverity.low} icon={ShieldQuestion}
          valueClass="text-emerald-400" ringClass="ring-emerald-500/20"
          hint="Data quality / minor"
        />
        <SeverityCard
          label="Total Anomalies" value={summary.total} icon={Activity}
          valueClass="text-white" ringClass="ring-white/10"
          hint={`Across ${chips.length - 1} detector${chips.length - 1 !== 1 ? 's' : ''}`}
        />
      </div>

      {/* Type filter chips */}
      {!loading && !error && anomalies.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map(chip => {
            const meta = chip.type === 'ALL' ? null : TYPE_META[chip.type]
            const Icon = meta?.icon
            const active = activeType === chip.type
            return (
              <button
                key={chip.type}
                type="button"
                onClick={() => setActiveType(chip.type)}
                title={chip.desc}
                aria-pressed={active}
                className={cn(
                  'group flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm border transition-colors',
                  active
                    ? 'bg-white/10 border-white/20 text-white'
                    : 'bg-white/[0.02] border-gray-800 text-gray-400 hover:bg-white/5 hover:text-gray-200',
                )}
              >
                {Icon && <Icon size={14} className={cn(active ? meta.accent : 'text-gray-500 group-hover:text-gray-300')} />}
                <span>{chip.label}</span>
                <span className={cn(
                  'rounded-md px-1.5 py-0.5 text-xs font-semibold',
                  active ? 'bg-white/15 text-white' : 'bg-gray-800 text-gray-400',
                )}>{chip.count}</span>
              </button>
            )
          })}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4" /> {error}
          <button onClick={load} className="ml-auto text-xs underline">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="card animate-pulse">
              <div className="h-6 w-48 bg-gray-700 rounded mb-3" />
              <div className="h-20 bg-gray-700/50 rounded" />
            </div>
          ))}
        </div>
      ) : anomalies.length === 0 && !error ? (
        <div className="card py-16 text-center">
          <Activity className="w-10 h-10 mx-auto mb-3 text-gray-700" />
          <p className="text-gray-400 font-medium">No anomalies detected</p>
          <p className="text-gray-600 text-sm mt-1">
            Rule-based checks run automatically over the latest {`5,000`} records. Anomalies appear here when detected.
          </p>
        </div>
      ) : groups.length === 0 ? (
        <div className="card py-12 text-center">
          <Activity className="w-8 h-8 mx-auto mb-2 text-gray-700" />
          <p className="text-gray-400 text-sm">No anomalies for this filter.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(group => (
            <AnomalyTypeGroup
              key={group.type}
              group={group}
              detailColumns={detailColumns}
              defaultOpen={groups.length === 1 || activeType !== 'ALL'}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SeverityCard({ label, value, icon: Icon, valueClass, ringClass, hint }) {
  return (
    <div className={cn('card flex items-start justify-between ring-1', ringClass)}>
      <div>
        <p className={cn('text-2xl font-bold', valueClass)}>{value}</p>
        <p className="text-xs text-gray-400 mt-1">{label}</p>
        <p className="text-[11px] text-gray-600 mt-0.5">{hint}</p>
      </div>
      <Icon className={cn('w-5 h-5 shrink-0', valueClass)} />
    </div>
  )
}

function AnomalyTypeGroup({ group, detailColumns, defaultOpen }) {
  const [expanded, setExpanded] = useState(!!defaultOpen)
  const meta = TYPE_META[group.type]
  const Icon = meta?.icon || AlertTriangle

  return (
    <div className="card overflow-hidden p-0">
      <button
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg bg-white/5', meta?.accent)}>
            <Icon size={18} />
          </span>
          <div>
            <h3 className="font-semibold text-white">{group.label}</h3>
            <p className="text-xs text-gray-500">{group.desc}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-md bg-gray-800 px-2 py-0.5 text-xs font-semibold text-gray-300">
            {group.items.length}
          </span>
          <ChevronDown size={18} className={cn('text-gray-500 transition-transform', expanded && 'rotate-180')} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-800 divide-y divide-gray-800/70">
          {group.items.map(a => (
            <AnomalyRow key={a.id} anomaly={a} detailColumns={detailColumns} />
          ))}
        </div>
      )}
    </div>
  )
}

function AnomalyRow({ anomaly, detailColumns }) {
  const [open, setOpen] = useState(false)
  const records = anomaly.records || []
  const canDrill = records.length > 0

  return (
    <div className="px-5 py-3">
      <button
        type="button"
        onClick={() => canDrill && setOpen(v => !v)}
        aria-expanded={open}
        className={cn(
          'w-full flex items-start gap-3 text-left',
          canDrill && 'cursor-pointer',
        )}
      >
        <span className={cn(
          'mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
          SEVERITY_BADGE[anomaly.severity] || SEVERITY_BADGE.low,
        )}>
          {anomaly.severity}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-gray-100">{anomaly.message}</p>
          {anomaly.detail && <p className="text-xs text-gray-500 mt-0.5">{anomaly.detail}</p>}
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-gray-600">
            {anomaly.asset_no && <span>Asset: <span className="text-gray-400">{anomaly.asset_no}</span></span>}
            {anomaly.site && <span>Site: <span className="text-gray-400">{anomaly.site}</span></span>}
            <span>{records.length} record{records.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        {canDrill && (
          <ChevronDown size={16} className={cn('mt-1 shrink-0 text-gray-600 transition-transform', open && 'rotate-180')} />
        )}
      </button>

      {open && canDrill && (
        <div className="mt-3">
          <EnterpriseTable
            columns={detailColumns}
            data={records}
            getRowId={r => r.id}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableSorting={records.length > 1}
            enableColumnVisibility={false}
            enableExport
            exportFileName={`anomaly_${anomaly.id}`}
            initialPageSize={10}
            pageSizeOptions={[10, 25, 50]}
            emptyMessage="No records"
          />
        </div>
      )}
    </div>
  )
}
