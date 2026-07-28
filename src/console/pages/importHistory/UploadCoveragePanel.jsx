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
import { RefreshCw, AlertTriangle, CheckCircle2, Info, CalendarX2 } from 'lucide-react'
import { getUploadCoverage, cadenceLabel, sortByUrgency } from '../../../lib/api/uploadCoverage'
import { toUserMessage } from '../../../lib/safeError'
import {
  Panel, Note, Badge, Btn, Segmented, Toolbar, LoadingState, EmptyState, ErrorState,
} from '../../components/ui'

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

  if (loading) return <LoadingState label="Checking which days have data" rows={5} />
  if (error) return <ErrorState message={error} onRetry={load} />
  if (!cov || cov.ok === false) {
    return (
      <EmptyState
        icon={CalendarX2}
        title="Coverage tracking is not available yet"
        reason="The database this app is pointed at does not have the coverage view installed."
      />
    )
  }

  const sources = sortByUrgency(cov.sources)
  const alerts = cov.alerts || []

  return (
    <div className="space-y-4">
      <Toolbar>
        <Segmented
          value={days}
          onChange={setDays}
          options={[14, 30, 60, 90].map((n) => ({ key: n, label: `${n} days` }))}
        />
        <div className="flex-1" />
        <Btn icon={RefreshCw} onClick={load}>Refresh</Btn>
      </Toolbar>

      {/* The headline. This is what the morning notification also says. */}
      {alerts.length > 0 ? (
        <Note icon={AlertTriangle} tone="warning">
          <p className="font-semibold mb-1">
            {alerts.length === 1 ? 'A daily file looks missing' : `${alerts.length} daily files look missing`}
          </p>
          <ul className="space-y-0.5">
            {alerts.map((a) => (
              <li key={a.src}>
                <span className="font-medium">{a.label}</span> - last data covers {fmtDate(a.last_data_date)},
                {' '}{a.days_since_last} day{a.days_since_last === 1 ? '' : 's'} ago.
              </li>
            ))}
          </ul>
          <p className="opacity-70 pt-1">
            Upload the missing file, or ignore this if there was genuinely no activity on those days.
          </p>
        </Note>
      ) : (
        <Note icon={CheckCircle2} tone="default">
          <span className="text-emerald-300">Every daily feed is up to date.</span>
        </Note>
      )}

      {sources.map((s) => (
        <Panel key={s.src} className="space-y-2" tone={s.expect_daily && Number(s.missing_count) > 0 ? 'warning' : undefined}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                {s.label}
                {s.expect_daily
                  ? <Badge tone="info">watched daily</Badge>
                  : <Badge tone="quiet">occasional</Badge>}
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
        </Panel>
      ))}

      <Note icon={Info}>
        Days are counted by the date the work happened, not the date you uploaded, so a file
        uploaded late still fills its own day. Today is never marked missing. A source is only
        watched once it has actually arrived on most days, so occasional feeds do not raise alarms.
      </Note>
    </div>
  )
}
