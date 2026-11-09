import { useCallback, useEffect, useMemo, useState } from 'react'
import { ListChecks, RefreshCw, Download, AlertTriangle, Search } from 'lucide-react'
import { getTyreExceptions, closeRotations } from '../../lib/api/tyreExceptions'
import { exceptionRows, exceptionCounts, EXCEPTION_LABEL } from '../../lib/tyreExceptions'
import { toUserMessage } from '../../lib/safeError'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import EnterpriseTable from '../ui/EnterpriseTable'

/**
 * One list of tyre records a person has to look at: rotations nobody closed,
 * the same serial typed on two wheels, a tyre priced twice, values that are not
 * serials. Read-only; the only action is a DRY RUN of the rotation closer, which
 * shows what it would close. Applying it is an owner decision (it changes the
 * register), so it is not offered as a button here.
 */
export default function TyreExceptionsSection({ activeCountry } = {}) {
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [kind, setKind] = useState('all')
  const [search, setSearch] = useState('')
  const [preview, setPreview] = useState(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const country = activeCountry && activeCountry !== 'All' ? activeCountry : null

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setPayload(await getTyreExceptions({ country }))
    } catch (e) {
      setError(toUserMessage(e))
      setPayload(null)
    } finally {
      setLoading(false)
    }
  }, [country])

  useEffect(() => { load() }, [load])

  const rows = useMemo(() => exceptionRows(payload), [payload])
  const counts = useMemo(() => exceptionCounts(payload), [payload])
  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase()
    return rows.filter((r) => (kind === 'all' || r.kind === kind)
      && (!q || r.serial.toUpperCase().includes(q) || r.asset.toUpperCase().includes(q)))
  }, [rows, kind, search])

  const runPreview = async () => {
    setPreviewBusy(true)
    try {
      setPreview(await closeRotations({ dryRun: true, country }))
    } catch (e) {
      setPreview({ error: toUserMessage(e) })
    } finally {
      setPreviewBusy(false)
    }
  }

  const columns = useMemo(() => [
    { id: 'kind', header: 'Exception', accessorFn: (r) => r.label, size: 220, meta: { filterVariant: 'select' } },
    { id: 'country', header: 'Country', accessorFn: (r) => r.country || 'N/A', size: 90 },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset || 'N/A', size: 120 },
    { id: 'serial', header: 'Serial', accessorFn: (r) => r.serial || 'N/A', size: 170 },
    { id: 'detail', header: 'Detail', accessorFn: (r) => r.detail || '', size: 260 },
    { id: 'action', header: 'What to do', accessorFn: (r) => r.action || '', size: 260 },
  ], [])

  const tiles = [
    ['rotation_not_closed', counts.rotation_not_closed],
    ['same_day_double_entry', counts.same_day_double_entry],
    ['serial_priced_twice', counts.serial_priced_twice],
    ['weak_serial', counts.weak_serial],
    ['serial_with_remark', counts.serial_with_remark],
  ]

  return (
    <div className="card p-5 mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3">
          <ListChecks className="w-5 h-5 mt-0.5" style={{ color: 'var(--accent)' }} />
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Tyre exceptions</h3>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Records that break one tyre, one price, one wheel. Nothing here is changed automatically.
              {counts.import_reviews_open != null && ` ${counts.import_reviews_open} held upload row(s) wait in Tyre import review.`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={runPreview} disabled={previewBusy} className="btn-secondary min-h-[44px] text-sm">
            {previewBusy ? 'Checking...' : 'Preview rotation closer'}
          </button>
          <button type="button" onClick={load} className="btn-secondary min-h-[44px] text-sm inline-flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button type="button" disabled={!filtered.length} className="btn-secondary min-h-[44px] text-sm inline-flex items-center gap-2"
            onClick={() => exportToExcel(filtered, ['label', 'country', 'asset', 'serial', 'detail', 'action'],
              ['Exception', 'Country', 'Asset', 'Serial', 'Detail', 'What to do'], reportFileName('Tyre exceptions'))}>
            <Download className="w-4 h-4" /> Excel
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <button type="button" onClick={() => setKind('all')}
          className={`text-xs rounded-full px-3 py-1 min-h-[32px] ${kind === 'all' ? 'ring-1 ring-[var(--accent)]' : ''}`}
          style={{ background: 'var(--panel-2)', color: 'var(--text-secondary)' }}>All: {rows.length}</button>
        {tiles.map(([k, n]) => (
          <button key={k} type="button" onClick={() => setKind(k)}
            className={`text-xs rounded-full px-3 py-1 min-h-[32px] ${kind === k ? 'ring-1 ring-[var(--accent)]' : ''}`}
            style={{ background: 'var(--panel-2)', color: 'var(--text-secondary)' }}>
            {EXCEPTION_LABEL[k]}: {n == null ? 'N/A' : n}
          </button>
        ))}
      </div>

      {preview && (
        <div className="text-sm rounded-lg px-3 py-2 mb-3" style={{ background: 'var(--panel-2)', color: 'var(--text-secondary)' }}>
          {preview.error
            ? preview.error
            : `Dry run: ${preview.rotations} earlier fitment(s) would be closed as rotated. Nothing was changed.`}
        </div>
      )}

      <div className="relative mb-3 w-fit">
        <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-dim)' }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Asset or serial"
          aria-label="Search tyre exceptions" className="input pl-8 text-sm min-h-[44px]" />
      </div>

      {error && (
        <div role="alert" className="text-sm rounded-lg px-3 py-2 mb-3 flex items-center gap-2 border border-red-800/50 bg-red-950/20">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          <span className="flex-1 text-[var(--text-primary)]">{error}</span>
          <button type="button" onClick={load} className="btn-secondary min-h-[44px] text-xs">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="text-sm py-6 text-center" style={{ color: 'var(--text-secondary)' }}>Checking tyre records...</div>
      ) : error ? null : !rows.length ? (
        <div className="text-sm py-6 text-center" style={{ color: 'var(--text-secondary)' }}>No tyre exceptions in this scope.</div>
      ) : (
        <EnterpriseTable columns={columns} data={filtered} getRowId={(r, i) => `${r.kind}-${r.country}-${r.serial}-${i}`}
          enableKeyboard={false} enableGlobalFilter={false} emptyMessage="No exception matches that filter."
          exportFileName={reportFileName('Tyre exceptions')} reportMeta={{ title: 'Tyre exceptions' }} />
      )}
    </div>
  )
}
