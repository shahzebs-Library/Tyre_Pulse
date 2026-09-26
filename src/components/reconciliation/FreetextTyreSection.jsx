import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FileSearch, RefreshCw, Download, Search, Check, X, AlertTriangle, Wand2,
} from 'lucide-react'
import {
  listFreetextCandidates, getFreetextSummary, extractFreetextCandidates,
  decideCandidate, EVENT_KIND_LABEL,
} from '../../lib/api/tyreFreetext'
import { toUserMessage } from '../../lib/safeError'
import { formatDate } from '../../lib/formatters'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import EnterpriseTable from '../ui/EnterpriseTable'

/**
 * Tyre serials the engine read out of a job card sentence, for review.
 *
 * Some job cards record a tyre change ONLY in the work-done box, with no
 * structured tyre row behind it. The engine reads those sentences and files what
 * it found here. Nothing on this screen is a tyre record: a row is a proposal
 * until a person confirms it.
 *
 * THE SERIAL IS WHAT THIS OFFERS - NOT THE POSITION. Owner's ruling, and the
 * sentences bear it out: one reads "4TH AXLE LEFT SIDE RHBB1" (left in words,
 * right in code), another names two positions and two serials on one line where
 * the pairing is word order rather than grammar. So the wheel is not shown as
 * though it were known; the serial, the machine and the job card are.
 *
 * The other column that matters is what the sentence says HAPPENED: "REPLACED
 * TYRE OLD ONE LHF2-YMY32586" names the tyre that came OFF, and accepting that as
 * a fitment would put a removed tyre back on the vehicle.
 */
export default function FreetextTyreSection({ activeCountry } = {}) {
  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState({ pending: null, newSerials: null, accepted: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [note, setNote] = useState(null)
  const [extracting, setExtracting] = useState(false)

  const country = activeCountry && activeCountry !== 'All' ? activeCountry : 'All'
  const [status, setStatus] = useState('pending')
  const [newOnly, setNewOnly] = useState(false)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [res, sum] = await Promise.all([
        listFreetextCandidates({ country, status, newOnly }),
        getFreetextSummary({ country }),
      ])
      if (res.error) setError(toUserMessage(new Error(res.error)))
      setRows(res.rows)
      setSummary(sum)
    } catch (e) {
      setError(toUserMessage(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [country, status, newOnly])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        (r.asset_no || '').includes(q) ||
        (r.serial_no || '').includes(q) ||
        (r.job_card || '').toUpperCase().includes(q),
    )
  }, [rows, search])

  const columns = useMemo(() => [
    { id: 'date', header: 'Date', accessorFn: (r) => r.job_card_date || '', size: 120,
      meta: { exportValue: (r) => r.job_card_date || 'Not recorded' },
      cell: ({ row }) => <span className="whitespace-nowrap text-[var(--text-secondary)]">{row.original.job_card_date ? formatDate(row.original.job_card_date) : 'Not recorded'}</span> },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || 'N/A', size: 110,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no || 'N/A'}</span> },
    { id: 'serial', header: 'Serial', accessorFn: (r) => r.serial_no || 'N/A', size: 150,
      meta: { exportValue: (r) => `${r.serial_no || 'N/A'}${r.serial_is_new ? ' (new)' : ''}` },
      cell: ({ row }) => (
        <span className="text-[var(--text-primary)]">
          {row.original.serial_no || 'N/A'}
          {row.original.serial_is_new && <span className="ml-2 text-xs text-[var(--accent)]">new</span>}
        </span>
      ) },
    { id: 'event', header: 'What the sentence says', accessorFn: (r) => EVENT_KIND_LABEL[r.event_kind] || 'Not stated', size: 200, meta: { filterVariant: 'select' },
      cell: ({ row }) => (
        <span className="text-[var(--text-secondary)]">
          {EVENT_KIND_LABEL[row.original.event_kind] || 'Not stated'}
          {row.original.confidence !== 'high' && (
            <span className="ml-2 text-xs text-[var(--text-muted)]">more than one tyre in this line</span>
          )}
        </span>
      ) },
    { id: 'source', header: 'Original sentence', accessorFn: (r) => r.source_text || '', size: 320,
      cell: ({ row }) => <span className="block max-w-md truncate text-[var(--text-muted)]" title={row.original.source_text}>{row.original.source_text}</span> },
    ...(status === 'pending' ? [{
      id: 'decision', header: 'Decision', size: 230, enableSorting: false, meta: { export: false, align: 'right' },
      cell: ({ row }) => {
        const r = row.original
        return (
          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
            <button type="button" onClick={() => decide(r, 'accepted')} disabled={busyId === r.id}
              aria-label={`Confirm serial ${r.serial_no} as a real tyre change`}
              className="btn-secondary min-h-[44px] text-xs inline-flex items-center gap-1">
              <Check className="w-3 h-3" /> Real
            </button>
            <button type="button" onClick={() => decide(r, 'rejected')} disabled={busyId === r.id}
              aria-label={`Mark serial ${r.serial_no} as not a tyre change`}
              className="btn-secondary min-h-[44px] text-xs inline-flex items-center gap-1">
              <X className="w-3 h-3" /> Not a change
            </button>
          </div>
        )
      },
    }] : []),
  ], [status, busyId])

  const decide = async (row, next) => {
    setBusyId(row.id)
    setNote(null)
    try {
      await decideCandidate(row.id, next)
      setRows((prev) => prev.filter((r) => r.id !== row.id))
      setSummary((s) => ({
        ...s,
        pending: typeof s.pending === 'number' ? Math.max(0, s.pending - 1) : s.pending,
      }))
      setNote(
        next === 'accepted'
          ? `Marked ${row.serial_no} as a real tyre event. The sentence stays with it as the evidence.`
          : `Marked ${row.serial_no} as not a tyre change.`,
      )
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  const runExtract = async () => {
    setExtracting(true)
    setError(null)
    setNote(null)
    try {
      const res = await extractFreetextCandidates(false)
      setNote(
        `Read ${res.pairs_found ?? 0} tyre mentions; ${res.candidates_created ?? 0} were new to this list.`,
      )
      await load()
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setExtracting(false)
    }
  }

  const download = () => {
    exportToExcel(
      filtered,
      // Position is deliberately not exported as a field: the sentences contradict
      // themselves on the wheel. It stays inside the original sentence, which is
      // the only place it can be read with its own context.
      ['job_card_date', 'asset_no', 'serial_no', 'brand_text',
       'event_kind', 'confidence', 'serial_is_new', 'job_card', 'source_text'],
      ['Job card date', 'Asset', 'Serial', 'Brand',
       'What happened', 'Confidence', 'Serial is new', 'Job card', 'Original sentence'],
      reportFileName('Tyre changes read from job cards'),
    )
  }

  return (
    <div className="card p-5 mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <div className="flex items-start gap-3">
          <FileSearch className="w-5 h-5 mt-0.5" style={{ color: 'var(--accent)' }} />
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              Tyre changes written only in the job card text
            </h3>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Where a tyre was changed but nobody filled the tyre columns, the engine reads
              the serial out of the mechanic&apos;s sentence. The wheel position is not shown:
              the sentences disagree with themselves about it. Nothing here is a tyre record yet.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button"
            onClick={runExtract}
            disabled={extracting}
            className="btn-secondary min-h-[44px] text-sm inline-flex items-center gap-2"
          >
            <Wand2 className={`w-4 h-4 ${extracting ? 'animate-pulse' : ''}`} />
            {extracting ? 'Reading...' : 'Read job cards again'}
          </button>
          <button type="button" onClick={load} className="btn-secondary min-h-[44px] text-sm inline-flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button type="button"
            onClick={download}
            disabled={!filtered.length}
            className="btn-secondary min-h-[44px] text-sm inline-flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Excel
          </button>
        </div>
      </div>

      {/* Counts. A null count means we could not read it, which is not zero. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 my-4">
        {[
          ['Waiting for review', summary.pending],
          ['Serial never seen before', summary.newSerials],
          ['Confirmed so far', summary.accepted],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg p-3" style={{ background: 'var(--panel-2)' }}>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</div>
            <div className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              {typeof value === 'number' ? value.toLocaleString() : 'Could not check'}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--text-dim)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Asset, serial or job card"
            aria-label="Search by asset, serial or job card"
            className="input pl-8 text-sm min-h-[44px]"
          />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Decision status" className="input text-sm min-h-[44px]">
          <option value="pending">Waiting for review</option>
          <option value="accepted">Confirmed</option>
          <option value="rejected">Not a tyre change</option>
        </select>
        <label className="text-sm inline-flex items-center gap-2 min-h-[44px]" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" className="w-4 h-4" checked={newOnly} onChange={(e) => setNewOnly(e.target.checked)} />
          Only serials we have never recorded
        </label>
      </div>

      {note && (
        <div role="status" className="text-sm rounded-lg px-3 py-2 mb-3"
             style={{ background: 'var(--panel-2)', color: 'var(--text-secondary)' }}>
          {note}
        </div>
      )}
      {error && (
        <div role="alert" className="text-sm rounded-lg px-3 py-2 mb-3 flex flex-wrap items-center gap-2 border border-red-800/50 bg-red-950/20 text-red-400">
          <AlertTriangle className="w-4 h-4" />
          <span className="flex-1 min-w-0 text-[var(--text-primary)]">{error}</span>
          <button type="button" onClick={load} className="btn-secondary min-h-[44px] text-xs inline-flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-sm py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
          Reading the job cards...
        </div>
      ) : error && !rows.length ? null : !rows.length ? (
        <div className="text-sm py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
          {status === 'pending'
            ? 'Nothing is waiting for review.'
            : 'No records with that decision yet.'}
        </div>
      ) : (
        <EnterpriseTable
          columns={columns}
          data={filtered}
          getRowId={(r) => r.id}
          enableKeyboard={false}
          enableGlobalFilter={false}
          emptyMessage="No record matches that search."
          exportFileName={reportFileName('Tyre changes read from job cards')}
          reportMeta={{ title: 'Tyre changes read from job cards' }}
        />
      )}
    </div>
  )
}
