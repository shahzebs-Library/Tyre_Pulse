import { useState, useEffect, useMemo, useCallback } from 'react'
import { AlertTriangle, TrendingUp, Activity, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { formatCurrencyCompact } from '../lib/formatters'
import { cn } from '../lib/cn'

function groupByType(records) {
  const map = {}
  const TYPE_LABELS = {
    cost_anomaly: { label: 'Cost Anomaly', icon: '!' },
    duplicate: { label: 'Potential Duplicate', icon: '≡' },
    missing_data: { label: 'Missing Data', icon: '?' },
  }
  for (const r of records) {
    const t = r.type || 'missing_data'
    if (!map[t]) map[t] = { ...TYPE_LABELS[t], key: t, items: [] }
    map[t].items.push(r)
  }
  return Object.values(map)
}

export default function Anomalies() {
  const { profile } = useAuth()
  const { activeCountry, activeCurrency } = useSettings()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      let q = supabase
        .from('anomalies')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)
      if (activeCountry !== 'All' && activeCountry) q = q.eq('country', activeCountry)
      const { data, error: err } = await q
      if (err) throw err
      setRecords(data || [])
    } catch (e) {
      setError(e.message || 'Failed to load anomalies')
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const groups = useMemo(() => groupByType(records), [records])
  const costAnomalyCount = records.filter(r => r.type === 'cost_anomaly').length
  const duplicateCount = records.filter(r => r.type === 'duplicate').length
  const missingCount = records.filter(r => r.type === 'missing_data').length

  // Columns for anomaly detail table (per-group records)
  const detailColumns = useMemo(() => [
    { id: 'issue_date', header: 'Date', accessorFn: r => r.issue_date ?? '-', size: 100 },
    { id: 'brand', header: 'Brand', accessorFn: r => r.brand ?? '-', size: 120 },
    { id: 'serial_no', header: 'Serial No', accessorFn: r => r.serial_no ?? '-', size: 140 },
    { id: 'site', header: 'Site', accessorFn: r => r.site ?? '-', size: 120 },
    {
      id: 'cost',
      header: 'Cost',
      accessorFn: r => r.cost_per_tyre ? formatCurrencyCompact(r.cost_per_tyre, activeCurrency) : '-',
      size: 100,
      meta: { align: 'right' },
    },
  ], [activeCurrency])

  // Columns for main anomalies table
  const mainColumns = useMemo(() => [
    { id: 'issue_date', header: 'Date', accessorFn: r => r.issue_date ?? '-', size: 100 },
    {
      id: 'asset_no',
      header: 'Asset No',
      accessorFn: r => r.asset_no ?? '-',
      size: 120,
      cell: ({ getValue }) => <span className="font-mono text-blue-400">{getValue()}</span>,
    },
    { id: 'serial_no', header: 'Serial No', accessorFn: r => r.serial_no ?? '-', size: 140 },
    { id: 'brand', header: 'Brand', accessorFn: r => r.brand ?? '-', size: 120 },
    { id: 'site', header: 'Site', accessorFn: r => r.site ?? '-', size: 120 },
    {
      id: 'risk_level',
      header: 'Risk',
      accessorFn: r => r.risk_level ?? '-',
      size: 80,
      cell: ({ getValue }) => {
        const val = getValue()
        return (
          <span className={cn(
            'px-1.5 py-0.5 rounded text-xs',
            val === 'High' || val === 'Critical' ? 'bg-red-900/40 text-red-400' :
            val === 'Medium' ? 'bg-yellow-900/40 text-yellow-400' : 'bg-green-900/40 text-green-400'
          )}>{val}</span>
        )
      },
    },
    {
      id: 'cost_per_tyre',
      header: 'Cost',
      accessorFn: r => r.cost_per_tyre ? formatCurrencyCompact(r.cost_per_tyre, activeCurrency) : '-',
      size: 100,
      meta: { align: 'right' },
    },
  ], [activeCurrency])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Anomalies"
        subtitle="Data quality issues, cost anomalies and potential duplicates"
        icon={AlertTriangle}
      />

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card text-center">
          <p className="text-2xl font-bold text-orange-400">{costAnomalyCount}</p>
          <p className="text-xs text-gray-500 mt-1">Cost Anomalies</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-blue-400">{duplicateCount}</p>
          <p className="text-xs text-gray-500 mt-1">Potential Duplicates</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-gray-400">{missingCount}</p>
          <p className="text-xs text-gray-500 mt-1">Missing Data</p>
        </div>
      </div>

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
      ) : records.length === 0 && !error ? (
        <div className="card py-16 text-center">
          <Activity className="w-10 h-10 mx-auto mb-3 text-gray-700" />
          <p className="text-gray-400 font-medium">No anomalies found</p>
          <p className="text-gray-600 text-sm mt-1">
            Data quality checks run automatically. Anomalies appear here when detected.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(group => (
            <AnomalyTypeGroup
              key={group.key}
              group={group}
              detailColumns={detailColumns}
              mainColumns={mainColumns}
              activeCurrency={activeCurrency}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AnomalyTypeGroup({ group, detailColumns, mainColumns, activeCurrency }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-gray-500">{group.icon}</span>
          <div className="text-left">
            <h3 className="font-semibold text-white">{group.label}</h3>
            <p className="text-xs text-gray-500">{group.items.length} record{group.items.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <RefreshCw size={16} className={`text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="border-t border-gray-800">
          <EnterpriseTable
            columns={detailColumns}
            data={group.items}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableSorting={false}
            enableColumnVisibility={false}
            enableExport={false}
            initialPageSize={10}
            pageSizeOptions={[10, 25, 50]}
            emptyMessage="No records"
          />
        </div>
      )}
    </div>
  )
}