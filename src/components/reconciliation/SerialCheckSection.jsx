import { useCallback, useEffect, useMemo, useState } from 'react'
import { Fingerprint, RefreshCw, Download, AlertTriangle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { loadFleetSerialFindings } from '../../lib/api/tyreSerialCheck'
import { SERIAL_PROBLEM_LABEL } from '../../lib/tyreSerialCheck'
import { toUserMessage } from '../../lib/safeError'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import { useSettings } from '../../contexts/SettingsContext'
import EnterpriseTable from '../ui/EnterpriseTable'

const TABS = [
  ['sameVehicle', 'Same serial on two wheels'],
  ['invalid', 'Not a real serial'],
  ['multiVehicle', 'Fitted on two vehicles'],
]

const assetLink = (asset) => (
  <Link to={`/assets/${encodeURIComponent(asset)}`} className="text-[var(--accent)] hover:underline">{asset}</Link>
)

/**
 * Serial check over the tyres fitted now. One tyre can only be on one wheel,
 * so a serial on two wheels (or two vehicles) means one entry is wrong; a tyre
 * size or an Excel-damaged number in the serial column is not a serial at all.
 * Read-only: it lists what to correct, it changes nothing.
 */
export default function SerialCheckSection() {
  const { activeCountry } = useSettings()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('sameVehicle')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      setData(await loadFleetSerialFindings({ country: activeCountry }))
    } catch (e) {
      setError(toUserMessage(e, 'Could not run the serial check.'))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [activeCountry])
  useEffect(() => { load() }, [load])

  const rows = data?.[tab] || []
  const columns = useMemo(() => {
    if (tab === 'sameVehicle') return [
      { id: 'asset', header: 'Vehicle', accessorFn: (r) => r.asset_no, cell: ({ row }) => assetLink(row.original.asset_no) },
      { id: 'country', header: 'Country', accessorFn: (r) => r.country || 'N/A', size: 90 },
      { id: 'serial', header: 'Serial', accessorFn: (r) => r.serial, cell: ({ row }) => <span className="font-mono">{row.original.serial}</span> },
      { id: 'positions', header: 'On wheels', accessorFn: (r) => r.positions.join(', ') },
    ]
    if (tab === 'invalid') return [
      { id: 'asset', header: 'Vehicle', accessorFn: (r) => r.asset_no, cell: ({ row }) => assetLink(row.original.asset_no) },
      { id: 'country', header: 'Country', accessorFn: (r) => r.country || 'N/A', size: 90 },
      { id: 'position', header: 'Wheel', accessorFn: (r) => r.position || 'N/A', size: 90 },
      { id: 'serial', header: 'Entered as', accessorFn: (r) => r.serial, cell: ({ row }) => <span className="font-mono">{row.original.serial}</span> },
      { id: 'kind', header: 'Problem', accessorFn: (r) => SERIAL_PROBLEM_LABEL[r.kind] || r.kind },
    ]
    return [
      { id: 'serial', header: 'Serial', accessorFn: (r) => r.serial, cell: ({ row }) => <span className="font-mono">{row.original.serial}</span> },
      { id: 'country', header: 'Country', accessorFn: (r) => r.country || 'N/A', size: 90 },
      { id: 'assets', header: 'Fitted on', accessorFn: (r) => r.assets.join(', '),
        cell: ({ row }) => <span className="whitespace-normal">{row.original.assets.map((a, i) => <span key={a}>{i ? ', ' : ''}{assetLink(a)}</span>)}</span> },
    ]
  }, [tab])

  const doExport = () => {
    if (tab === 'sameVehicle') {
      exportToExcel(rows.map((r) => ({ ...r, positions: r.positions.join(', ') })),
        ['asset_no', 'country', 'serial', 'positions'], ['Vehicle', 'Country', 'Serial', 'On wheels'],
        reportFileName('TyrePulse Serial On Two Wheels'))
    } else if (tab === 'invalid') {
      exportToExcel(rows.map((r) => ({ ...r, kind: SERIAL_PROBLEM_LABEL[r.kind] || r.kind })),
        ['asset_no', 'country', 'position', 'serial', 'kind'], ['Vehicle', 'Country', 'Wheel', 'Entered as', 'Problem'],
        reportFileName('TyrePulse Serials To Correct'))
    } else {
      exportToExcel(rows.map((r) => ({ ...r, assets: r.assets.join(', ') })),
        ['serial', 'country', 'assets'], ['Serial', 'Country', 'Fitted on'],
        reportFileName('TyrePulse Serial On Two Vehicles'))
    }
  }

  const total = data ? data.sameVehicle.length + data.invalid.length + data.multiVehicle.length : null

  return (
    <section className="card p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-[var(--border-dim)]">
        <div className="w-9 h-9 rounded-lg bg-[var(--surface-2)] border border-[var(--border-dim)] flex items-center justify-center shrink-0">
          <Fingerprint className="w-4 h-4 text-[var(--text-muted)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Serial check (tyres fitted now)</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--surface-2)] border border-[var(--border-dim)] text-[var(--text-secondary)]">{total ?? '...'}</span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">One tyre can only be on one wheel. These entries need correcting in the tyre records. Nothing is changed here.</p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="btn-secondary min-h-[44px] text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-40">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
        <button type="button" onClick={doExport} disabled={loading || rows.length === 0} className="btn-secondary min-h-[44px] text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-40">
          <Download size={13} /> Export
        </button>
      </div>
      <div className="px-5 py-4 space-y-4">
        {error ? (
          <div role="alert" className="rounded-lg border border-red-800/50 bg-red-950/20 px-4 py-3 flex flex-wrap items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <p className="flex-1 min-w-0 text-sm text-[var(--text-primary)]">{error}</p>
            <button type="button" onClick={load} className="btn-secondary min-h-[44px] text-xs flex items-center gap-1.5"><RefreshCw size={13} /> Retry</button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-10 text-[var(--text-muted)]"><RefreshCw className="w-5 h-5 animate-spin mr-2" /><span className="text-sm">Checking serials...</span></div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Serial check findings">
              {TABS.map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                  className={`text-xs px-3 min-h-[44px] rounded-full border ${tab === key ? 'bg-[var(--surface-2)] border-[var(--text-muted)] text-[var(--text-primary)]' : 'bg-[var(--surface-1)] border-[var(--border-dim)] text-[var(--text-secondary)]'}`}>
                  {label} ({data[key].length})
                </button>
              ))}
            </div>
            {data.truncated && <p className="text-xs text-amber-500">Only the first {data.scanned.toLocaleString()} fitted tyres were checked.</p>}
            {rows.length === 0
              ? <p className="text-xs text-[var(--text-muted)]">Nothing found.</p>
              : <EnterpriseTable data={rows} columns={columns} resetPageKey={tab} />}
          </>
        )}
      </div>
    </section>
  )
}
