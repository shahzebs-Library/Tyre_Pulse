/**
 * Which uploads are missing, per country and per area.
 *
 * THE DEFECT THIS REPLACES: the first version aggregated every country into one
 * row per source, so a country that stops uploading is hidden behind the ones
 * that did not. Measured when this was written - KSA job cards had been silent
 * for three weeks while Egypt and UAE both ran to two days earlier, and the
 * panel reported the newest of the three and called it healthy.
 *
 * Everything here is derived from the data itself, never assumed:
 *   - a feed is judged daily from six months of history, not from the window on
 *     screen, so three weeks of silence cannot demote it out of being watched
 *   - a non-daily feed is judged against its OWN typical gap, because "21 days
 *     silent" is alarming for one feed and completely normal for another
 *   - an area is only blamed for a day its own country and source actually
 *     received something
 *   - today is never counted; the day is not over
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  RefreshCw, AlertTriangle, CheckCircle2, Info, CalendarX2, ChevronRight,
  MapPin, FileUp, Globe, Clock,
} from 'lucide-react'
import {
  getUploadCoverageDetail, feedCadenceLabel, feedProblem, problemAreas, sortCountries,
} from '../../../lib/api/uploadCoverage'
import FeedFileHelp from './FeedFileHelp'
import { toUserMessage } from '../../../lib/safeError'
import {
  Panel, Note, Badge, Btn, Segmented, Toolbar, LoadingState, EmptyState, ErrorState,
} from '../../components/ui'

const dayNum = (d) => String(d).slice(8, 10)
const num = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString() : 'N/A')
const fmtDate = (d) => {
  if (!d) return 'never'
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? String(d)
    : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
const fmtShort = (d) => {
  if (!d) return ''
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? String(d)
    : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}
// The database clamps the window to this range; the UI has to agree or a date
// outside it would silently become a different window.
const MIN_WINDOW_DAYS = 7
const MAX_WINDOW_DAYS = 365

const ago = (n) => (n == null ? 'never' : n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`)

/** One square per day. Colour carries the meaning; the tooltip carries detail. */
function DayCell({ day, isToday, watched }) {
  const rows = Number(day.rows) || 0
  const sites = Number(day.sites) || 0
  const empty = rows === 0
  const tone = isToday
    ? 'bg-gray-700 border-gray-500 text-gray-300'
    : empty
      ? (watched ? 'bg-amber-500/25 border-amber-600/60 text-amber-200'
                 : 'bg-gray-800/60 border-gray-700 text-gray-600')
      : 'bg-emerald-600/25 border-emerald-600/50 text-emerald-200'
  const title = `${day.d}: ${empty ? 'no data' : `${rows.toLocaleString()} rows from ${sites} area${sites === 1 ? '' : 's'}`}`
    + (isToday ? ' (today, still in progress)' : '')
  return (
    <div title={title}
      className={`w-7 h-7 rounded border text-[10px] flex items-center justify-center ${tone}`}>
      {dayNum(day.d)}
    </div>
  )
}

/** The areas inside one feed, worst first. */
function AreaList({ src }) {
  const sites = src.sites || []
  if (!sites.length) {
    return <p className="text-[11px] text-gray-600">No area reported data for this feed in the window.</p>
  }
  const problems = problemAreas(src)
  const dormant = sites.filter((s) => s.dormant)
  const fine = sites.filter((s) => !s.dormant && !Number(s.missing_count))
  return (
    <div className="space-y-2">
      {problems.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-amber-400 mb-1">
            Areas that missed a day the rest of {src.label.toLowerCase()} arrived
          </p>
          <div className="space-y-1">
            {problems.map((s) => (
              <div key={s.site} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
                <MapPin size={10} className="text-amber-500 shrink-0" />
                <span className="text-gray-200 font-medium">{s.site}</span>
                <Badge tone="warning">{num(s.missing_count)} missed</Badge>
                <span className="text-gray-500">last {fmtDate(s.last_data_date)} · {ago(s.days_since_last)}</span>
                <span className="text-gray-600">{num(s.rows)} rows</span>
                {(s.missing_days || []).length > 0 && (
                  <span className="text-gray-600 w-full pl-4">
                    {(s.missing_days || []).slice(0, 10).map(fmtShort).join(', ')}
                    {(s.missing_days || []).length > 10 ? ' and more' : ''}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {fine.length > 0 && (
        <p className="text-[11px] text-gray-500">
          <span className="text-emerald-400">Up to date:</span>{' '}
          {fine.map((s) => s.site).join(', ')}
        </p>
      )}
      {dormant.length > 0 && (
        // Not "missing": a site that has sent nothing all window is either
        // closed or between jobs, and alarming about it forever trains people
        // to ignore the page.
        <p className="text-[11px] text-gray-600">
          <span className="text-gray-500">Nothing all window (not counted as missed):</span>{' '}
          {dormant.map((s) => `${s.site} (last ${fmtDate(s.last_data_date)})`).join(', ')}
        </p>
      )}
    </div>
  )
}

function FeedCard({ src, today, country }) {
  const [open, setOpen] = useState(false)
  const [help, setHelp] = useState(false)
  const problem = feedProblem(src)
  const gaps = problemAreas(src).length
  return (
    <Panel tone={problem ? 'warning' : undefined} className="space-y-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-200 flex items-center gap-2 flex-wrap">
            {src.label}
            {src.expect_daily ? <Badge tone="info">daily</Badge> : <Badge tone="quiet">in batches</Badge>}
            {problem && <Badge tone="warning" icon={AlertTriangle}>{problem}</Badge>}
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5">{feedCadenceLabel(src)}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[11px] text-gray-500">Last data</p>
          <p className={`text-xs font-medium ${problem ? 'text-amber-300' : 'text-gray-300'}`}>
            {fmtDate(src.last_data_date)}
            <span className="text-gray-500"> · {ago(src.days_since_last)}</span>
          </p>
          <p className="text-[10px] text-gray-600">{num(src.total_rows)} rows in window</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {(src.by_day || []).map((d) => (
          <DayCell key={d.d} day={d} isToday={d.d === today} watched={src.expect_daily} />
        ))}
      </div>

      {src.expect_daily && Number(src.missing_count) > 0 && (
        <p className="text-[11px] text-amber-300/90">
          No upload covering: {(src.missing_days || []).slice(0, 12).map(fmtShort).join(', ')}
          {(src.missing_days || []).length > 12 ? ' and more' : ''}
        </p>
      )}

      <div className="flex items-center gap-4 flex-wrap">
        <button onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300">
          <ChevronRight size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
          {open ? 'Hide areas' : `Areas (${(src.sites || []).length})`}
          {gaps > 0 && !open && <span className="text-amber-400">· {gaps} with gaps</span>}
        </button>
        {/* The gap is only half an answer; this is the other half. */}
        <button onClick={() => setHelp((v) => !v)}
          className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300">
          <ChevronRight size={11} className={`transition-transform ${help ? 'rotate-90' : ''}`} />
          {help ? 'Hide the file' : 'What fills this?'}
        </button>
      </div>
      {open && <div className="pl-4 pt-1"><AreaList src={src} /></div>}
      {help && (
        <div className="pl-4 pt-1">
          <FeedFileHelp src={src.src} country={country} />
        </div>
      )}
    </Panel>
  )
}

export default function UploadCoveragePanel() {
  const [cov, setCov] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [days, setDays] = useState(30)
  const [fromDate, setFromDate] = useState('')
  const [tooFarBack, setTooFarBack] = useState(false)
  const [country, setCountry] = useState('')

  // A preset and a start date are two ways of saying the same thing, so picking
  // one clears the other rather than leaving both on screen disagreeing.
  const pickPreset = (n) => { setDays(n); setFromDate(''); setTooFarBack(false) }

  const pickFrom = (value) => {
    setFromDate(value)
    if (!value) { setTooFarBack(false); setDays(30); return }
    const start = new Date(`${value}T00:00:00Z`)
    if (Number.isNaN(start.getTime())) return
    const wanted = Math.ceil((Date.now() - start.getTime()) / 86400000) + 1
    setTooFarBack(wanted > MAX_WINDOW_DAYS)
    setDays(Math.min(Math.max(wanted, MIN_WINDOW_DAYS), MAX_WINDOW_DAYS))
  }

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      setCov(await getUploadCoverageDetail({ days }))
    } catch (e) {
      setError(toUserMessage(e, 'Could not load upload coverage.'))
    } finally { setLoading(false) }
  }, [days])

  useEffect(() => { load() }, [load])

  const countries = useMemo(() => sortCountries(cov?.countries), [cov])
  const withProblems = countries.filter(
    (c) => (Number(c.missing_count) || 0) + (Number(c.quiet_count) || 0) > 0)
  const shown = country ? countries.filter((c) => c.country === country) : countries

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

  return (
    <div className="space-y-4">
      <Toolbar>
        <Segmented value={days} onChange={pickPreset}
          options={[14, 30, 60, 90, 180].map((n) => ({ key: n, label: `${n} days` }))} />
        {/* A custom start date, expressed as the day count the view already
            understands. The window always ends today, because the question this
            panel answers is "did I forget to upload?", which is about now. */}
        <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
          from
          <input
            type="date"
            value={fromDate}
            max={cov?.today || undefined}
            onChange={(e) => pickFrom(e.target.value)}
            className="bg-gray-900 border border-gray-800 rounded px-2 py-1 text-[11px] text-gray-300"
          />
        </label>
        {tooFarBack && (
          /* Say it rather than silently clamping - a window that quietly became
             a different window is how someone concludes a feed is fine. */
          <span className="text-[11px] text-amber-400">
            Showing the last {MAX_WINDOW_DAYS} days, the furthest back this goes.
          </span>
        )}
        <Segmented value={country} onChange={setCountry}
          options={[{ key: '', label: 'All countries' },
            ...countries.map((c) => ({
              key: c.country,
              label: c.country,
              count: (Number(c.missing_count) || 0) + (Number(c.quiet_count) || 0) || undefined,
            }))]} />
        <div className="flex-1" />
        <Btn icon={RefreshCw} onClick={load}>Refresh</Btn>
      </Toolbar>

      {withProblems.length === 0 ? (
        <Note icon={CheckCircle2}>
          <span className="text-emerald-300">Every feed is up to date in all countries.</span>
        </Note>
      ) : (
        <Note icon={AlertTriangle} tone="warning">
          <p className="font-semibold mb-1">
            {withProblems.length} of {countries.length} countries have an upload gap
          </p>
          <ul className="space-y-0.5">
            {withProblems.map((c) => (
              <li key={c.country}>
                <span className="font-medium">{c.country}</span>
                {' - '}
                {(c.sources || []).filter((s) => feedProblem(s))
                  .map((s) => `${s.label}: ${feedProblem(s)}`).join(' · ')}
              </li>
            ))}
          </ul>
        </Note>
      )}

      {shown.length === 0 ? (
        <EmptyState icon={Globe} title="No data in this window"
          reason="No country recorded anything in the period you selected. Try a longer window." />
      ) : shown.map((c) => (
        <div key={c.country} className="space-y-3">
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <Globe size={14} className="text-orange-400" />
            <h3 className="text-sm font-semibold text-gray-200">{c.country}</h3>
            <span className="text-[11px] text-gray-500">
              {num(c.total_rows)} rows · {c.watched_sources} daily feed{c.watched_sources === 1 ? '' : 's'}
            </span>
            {(Number(c.missing_count) || 0) > 0 && (
              <Badge tone="warning">{num(c.missing_count)} missed day{Number(c.missing_count) === 1 ? '' : 's'}</Badge>
            )}
            {(Number(c.quiet_count) || 0) > 0 && (
              <Badge tone="warning" icon={Clock}>{num(c.quiet_count)} gone quiet</Badge>
            )}
          </div>
          <div className="space-y-3">
            {(c.sources || []).map((s) => (
              <FeedCard key={`${c.country}-${s.src}`} src={s} today={cov.today} country={c.country} />
            ))}
          </div>
        </div>
      ))}

      {/* Files. Deliberately honest about how few of these there are. */}
      <Panel>
        <p className="text-xs font-semibold text-gray-300 flex items-center gap-1.5 mb-1">
          <FileUp size={13} className="text-gray-500" /> Files uploaded through the app in this window
        </p>
        {(cov.files || []).length === 0 ? (
          <p className="text-[11px] text-gray-600">
            None. Loads made straight into the database do not record a file name, so most
            uploads will never appear here - the day squares above are the reliable record of
            what arrived.
          </p>
        ) : (
          <ul className="space-y-1">
            {(cov.files || []).map((f, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2 text-[11px]">
                <span className="text-gray-200">{f.filename || 'Unnamed file'}</span>
                {f.country && <Badge tone="quiet">{f.country}</Badge>}
                <span className="text-gray-500">{fmtDate(f.uploaded_at)}</span>
                {f.source_system && <span className="text-gray-600">{f.source_system}</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Note icon={Info}>
        Days are counted by the date the work happened, not the date you uploaded, so a file
        uploaded late still fills its own day. Today is never marked missing. Whether a feed is
        treated as daily comes from six months of its own history, so a feed that stops does not
        quietly stop being watched. A feed that arrives in batches is judged against its own
        normal gap instead of a fixed number of days.
      </Note>
    </div>
  )
}
