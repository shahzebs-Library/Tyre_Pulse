/**
 * Daily coverage: which days have data and which are empty.
 *
 * The point of the calendar is that a missing day should be obvious at a
 * glance, without reading numbers. Amber squares are the days to look at.
 *
 * Two honesty rules the display keeps:
 *   - Today is never marked missing. The day is not over.
 *   - A source is only policed if it has actually behaved like a daily feed.
 *     Tyre records have had no rows for three weeks; flagging them every
 *     morning would train people to ignore the whole panel.
 */
import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, RefreshCw, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { getUploadCoverage, cadenceLabel, sortByUrgency } from '../../../lib/api/uploadCoverage'
import { toUserMessage } from '../../../lib/safeError'

const dayNum = (d) => String(d).slice(8, 10)
const fmtDate = (d) => {
  if (!d) return 'never'
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? String(d)
    : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** One square per day. Colour carries the meaning; the tooltip carries detail. */
function DayCell({ day, isToday, watched }) {
  const rows = Number(day.rows) || 0
  const empty = rows === 0
  const tone = isToday
    ? 'bg-gray-700 border-gray-500 text-gray-300'
    : empty
      // only a watched source's empty day is a problem worth colouring amber
      ? (watched ? 'bg-amber-500/25 border-amber-600/60 text-amber-200'
                 : 'bg-gray-800/60 border-gray-700 text-gray-600')
      : 'bg-emerald-600/25 border-emerald-600/50 text-emerald-200'
  return (
    <div
      title={`${day.d}: ${empty ? 'no data' : `${rows.toLocaleString()} rows`}${isToday ? ' (today, still in progress)' : ''}`}
      className={`w-7 h-7 rounded border text-[10px] flex items-center justify-center ${tone}`}
    >
      {dayNum(day.d)}
    </div>
  )
}

export default function UploadCoveragePanel({ country }) {
  const [cov, setCov] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [days, setDays] = useState(30)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      setCov(await getUploadCoverage({ days, country }))
    } catch (e) {
      setError(toUserMessage(e, 'Could not load upload coverage.'))
    } finally { setLoading(false) }
  }, [days, country])

  useEffect(() => { load() }, [load])

  if (loading) return <p className="text-xs text-gray-500 py-8 text-center">Checking which days have data...</p>
  if (error) return <p className="text-xs text-red-300 py-4">{error}</p>
  if (!cov || cov.ok === false) {
    return (
      <p className="text-xs text-gray-500 py-8 text-center">
        Coverage tracking is not available on this database yet.
      </p>
    )
  }

  const sources = sortByUrgency(cov.sources)
  const alerts = cov.alerts || []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Show</span>
          {[14, 30, 60, 90].map((n) => (
            <button key={n} onClick={() => setDays(n)}
              className={`px-2 py-1 rounded text-xs border ${
                days === n ? 'bg-orange-500/15 border-orange-600/60 text-orange-300'
                           : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}>
              {n}d
            </button>
          ))}
        </div>
        <button onClick={load}
          className="h-8 px-3 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:text-white flex items-center gap-2">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* The headline. This is what the morning notification also says. */}
      {alerts.length > 0 ? (
        <div className="rounded-xl bg-amber-950/40 border border-amber-800/50 p-3 space-y-1.5">
          <p className="text-xs font-semibold text-amber-200 flex items-center gap-1.5">
            <AlertTriangle size={13} /> {alerts.length === 1 ? 'A daily file looks missing' : `${alerts.length} daily files look missing`}
          </p>
          {alerts.map((a) => (
            <p key={a.src} className="text-xs text-amber-100/90">
              <span className="font-medium">{a.label}</span> - last data covers {fmtDate(a.last_data_date)},
              {' '}{a.days_since_last} day{a.days_since_last === 1 ? '' : 's'} ago.
            </p>
          ))}
          <p className="text-[11px] text-amber-200/60 pt-0.5">
            Upload the missing file, or ignore this if there was genuinely no activity on those days.
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-emerald-950/30 border border-emerald-800/40 p-3">
          <p className="text-xs text-emerald-200 flex items-center gap-1.5">
            <CheckCircle2 size={13} /> Every daily feed is up to date.
          </p>
        </div>
      )}

      {sources.map((s) => (
        <div key={s.src} className="rounded-xl bg-gray-900/50 border border-gray-800 p-3 space-y-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                {s.label}
                {s.expect_daily ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300">watched daily</span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/60 text-gray-400">occasional</span>
                )}
              </p>
              {/* Say WHY it is or is not watched, so the rule is not a mystery */}
              <p className="text-[11px] text-gray-500 mt-0.5">{cadenceLabel(s)}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-gray-500">Last data</p>
              <p className={`text-xs font-medium ${
                s.expect_daily && s.days_since_last > 1 ? 'text-amber-300' : 'text-gray-300'}`}>
                {fmtDate(s.last_data_date)}
                {s.days_since_last != null && (
                  <span className="text-gray-500"> · {s.days_since_last}d ago</span>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            {(s.by_day || []).map((d) => (
              <DayCell key={d.d} day={d} isToday={d.d === cov.today} watched={s.expect_daily} />
            ))}
          </div>

          {s.expect_daily && Number(s.missing_count) > 0 && (
            <p className="text-[11px] text-amber-300/80">
              {s.missing_count} empty day{Number(s.missing_count) === 1 ? '' : 's'} in this window:
              {' '}{(s.missing_days || []).slice(0, 8).map(fmtDate).join(', ')}
              {(s.missing_days || []).length > 8 ? ' and more' : ''}
            </p>
          )}
        </div>
      ))}

      <p className="text-[11px] text-gray-600 flex items-start gap-1.5">
        <Info size={12} className="mt-0.5 flex-shrink-0" />
        Days are counted by the date the work happened, not the date you uploaded, so a file
        uploaded late still fills its own day. Today is never marked missing. A source is only
        watched once it has actually arrived on most days, so occasional feeds do not raise alarms.
      </p>
    </div>
  )
}
