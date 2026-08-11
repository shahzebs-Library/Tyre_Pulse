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
          <button
            onClick={runExtract}
            disabled={extracting}
            className="btn-secondary text-sm inline-flex items-center gap-2"
          >
            <Wand2 className={`w-4 h-4 ${extracting ? 'animate-pulse' : ''}`} />
            {extracting ? 'Reading...' : 'Read job cards again'}
          </button>
          <button onClick={load} className="btn-secondary text-sm inline-flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={download}
            disabled={!filtered.length}
            className="btn-secondary text-sm inline-flex items-center gap-2"
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
            className="input pl-8 text-sm"
          />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="input text-sm">
          <option value="pending">Waiting for review</option>
          <option value="accepted">Confirmed</option>
          <option value="rejected">Not a tyre change</option>
        </select>
        <label className="text-sm inline-flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={newOnly} onChange={(e) => setNewOnly(e.target.checked)} />
          Only serials we have never recorded
        </label>
      </div>

      {note && (
        <div className="text-sm rounded-lg px-3 py-2 mb-3"
             style={{ background: 'var(--panel-2)', color: 'var(--text-secondary)' }}>
          {note}
        </div>
      )}
      {error && (
        <div className="text-sm rounded-lg px-3 py-2 mb-3 flex items-center gap-2"
             style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
          Reading the job cards...
        </div>
      ) : !filtered.length ? (
        <div className="text-sm py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
          {status === 'pending'
            ? 'Nothing is waiting for review.'
            : 'No records with that decision yet.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: 'var(--text-secondary)' }}>
                <th className="text-left py-2 pr-3">Date</th>
                <th className="text-left py-2 pr-3">Asset</th>
                <th className="text-left py-2 pr-3">Serial</th>
                <th className="text-left py-2 pr-3">What the sentence says</th>
                <th className="text-left py-2 pr-3">Original sentence</th>
                {status === 'pending' && <th className="text-right py-2">Decision</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td className="py-2 pr-3 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                    {r.job_card_date ? formatDate(r.job_card_date) : 'Not recorded'}
                  </td>
                  <td className="py-2 pr-3 font-medium" style={{ color: 'var(--text-primary)' }}>
                    {r.asset_no}
                  </td>
                  <td className="py-2 pr-3" style={{ color: 'var(--text-primary)' }}>
                    {r.serial_no}
                    {r.serial_is_new && (
                      <span className="ml-2 text-xs" style={{ color: 'var(--accent)' }}>new</span>
                    )}
                  </td>
                  <td className="py-2 pr-3" style={{ color: 'var(--text-secondary)' }}>
                    {EVENT_KIND_LABEL[r.event_kind] || 'Not stated'}
                    {r.confidence !== 'high' && (
                      <span className="ml-2 text-xs" style={{ color: 'var(--text-dim)' }}>
                        more than one tyre in this line
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 max-w-md truncate" title={r.source_text}
                      style={{ color: 'var(--text-dim)' }}>
                    {r.source_text}
                  </td>
                  {status === 'pending' && (
                    <td className="py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => decide(r, 'accepted')}
                        disabled={busyId === r.id}
                        className="btn-secondary text-xs inline-flex items-center gap-1 mr-2"
                      >
                        <Check className="w-3 h-3" /> Real
                      </button>
                      <button
                        onClick={() => decide(r, 'rejected')}
                        disabled={busyId === r.id}
                        className="btn-secondary text-xs inline-flex items-center gap-1"
                      >
                        <X className="w-3 h-3" /> Not a change
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
