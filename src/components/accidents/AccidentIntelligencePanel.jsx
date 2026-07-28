import { AlertTriangle, Info, MapPin, Repeat, CalendarDays, Clock, CheckCircle2, Copy } from 'lucide-react'
import {
  buildAccidentIntelligence, basisNote, isReliable,
} from '../../lib/accidentAnalytics'

/**
 * The part of accident analytics that says how much of itself to trust, plus the
 * breakdowns the data genuinely supports.
 *
 * The page above this computes a confident figure for every headline whether or
 * not the column behind it was ever filled in. On the live set the repair total
 * rests on 2 incidents of 35, claim exposure on 5, average closure on 11, and
 * "pending police reports" counts every open case because a report number is
 * never recorded at all. None of those numbers is wrong; presenting them at the
 * same weight as a figure drawn from all 35 is.
 *
 * So this panel does two things and nothing else: it states the basis of each
 * headline, and it shows the analysis that IS fully supported - concentration,
 * repeat vehicles, weekday profile, closure spread - because incident date, site
 * and asset number are recorded on every row.
 */

const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : 'N/A')
const num = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString() : 'N/A')

const SEV_TONE = {
  high: 'border-red-700/50 bg-red-950/25 text-red-200',
  medium: 'border-amber-700/50 bg-amber-950/25 text-amber-200',
  low: 'border-[var(--input-border)] bg-[var(--input-bg)]/40 text-[var(--text-dim)]',
}

/** A horizontal share bar. Reads at a glance where a list is lopsided. */
function ShareRow({ label, value, total, tone = 'bg-orange-500' }) {
  const share = total ? value / total : 0
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--text-dim)] w-40 truncate" title={label}>{label}</span>
      <div className="flex-1 h-2 rounded-full bg-[var(--input-border)] overflow-hidden">
        <div className={`h-2 rounded-full ${tone}`} style={{ width: `${Math.max(share * 100, 1.5)}%` }} />
      </div>
      <span className="text-xs text-[var(--text-primary)] tabular-nums w-16 text-right">
        {num(value)} <span className="text-[var(--text-muted)]">{pct(share)}</span>
      </span>
    </div>
  )
}

export default function AccidentIntelligencePanel({ records, currency, fmtCurrency }) {
  const intel = buildAccidentIntelligence(records)
  if (!intel.total) return null

  const money = (v) => (typeof fmtCurrency === 'function'
    ? fmtCurrency(v)
    : `${currency || ''} ${num(v)}`.trim())

  const basisRows = Object.values(intel.basis).filter((b) => b && b.filled < b.total)

  return (
    <div className="space-y-4">
      {/* ── How much of this to trust ─────────────────────────────────────── */}
      <div className="card border-l-2 border-l-amber-500/60">
        <div className="flex items-center gap-2 mb-3">
          <Info size={16} className="text-amber-400" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            How much of this you can rely on
          </p>
          <span className="text-xs text-[var(--text-muted)] ml-auto">
            across {num(intel.total)} incident{intel.total === 1 ? '' : 's'}
          </span>
        </div>

        {intel.caveats.length === 0 ? (
          <p className="text-xs text-emerald-300 flex items-center gap-1.5">
            <CheckCircle2 size={13} /> Every field these figures depend on is recorded on every incident.
          </p>
        ) : (
          <ul className="space-y-2">
            {intel.caveats.map((c) => (
              <li key={c.key}
                className={`text-xs border rounded-lg px-3 py-2 flex items-start gap-2 ${SEV_TONE[c.severity] || SEV_TONE.low}`}>
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        )}

        {basisRows.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[var(--input-border)]">
            <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-2">
              What each figure is measured on
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {basisRows.map((b) => (
                <div key={b.key} className="flex items-center gap-2 text-xs">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    b.filled === 0 ? 'bg-red-500' : isReliable(b) ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  <span className="text-[var(--text-dim)] flex-1 truncate">{b.label}</span>
                  <span className="text-[var(--text-muted)] tabular-nums">{basisNote(b)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Concentration: fully supported, site and asset are on every row ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <MapPin size={15} className="text-orange-400" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">Where incidents concentrate</p>
          </div>
          {intel.bySite.top ? (
            <>
              <p className="text-xs text-[var(--text-dim)] mb-3">
                <span className="text-[var(--text-primary)] font-medium">{intel.bySite.top.label}</span> accounts
                for {pct(intel.bySite.topShare)} of all incidents.
                {intel.bySite.distinct > 1 && (
                  <> {intel.bySite.paretoCount} of {intel.bySite.distinct} sites cover 80% of them.</>
                )}
              </p>
              <div className="space-y-1.5">
                {intel.bySite.rows.slice(0, 8).map((r) => (
                  <ShareRow key={r.label} label={r.label} value={r.value} total={intel.bySite.counted} />
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">No incident records a site.</p>
          )}
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays size={15} className="text-orange-400" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">Which day of the week</p>
          </div>
          {intel.weekday.peak ? (
            <>
              <p className="text-xs text-[var(--text-dim)] mb-3">
                <span className="text-[var(--text-primary)] font-medium">{intel.weekday.peak.label}</span> is
                the worst day, {pct(intel.weekday.peakShare)} of the {num(intel.weekday.dated)} dated incidents.
                A weekday pattern points at a shift or a route rather than at a vehicle.
              </p>
              <div className="space-y-1.5">
                {intel.weekday.rows.map((r) => (
                  <ShareRow key={r.label} label={r.label} value={r.value}
                    total={intel.weekday.dated} tone="bg-sky-500" />
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">No incident carries a readable date.</p>
          )}
        </div>
      </div>

      {/* ── Repeat vehicles + closure spread ────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <Repeat size={15} className="text-orange-400" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">Vehicles in more than one incident</p>
          </div>
          {intel.repeats.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">
              No vehicle appears twice. Every incident is on a different asset.
            </p>
          ) : (
            <>
              <p className="text-xs text-[var(--text-dim)] mb-2">
                {intel.repeats.length} vehicle{intel.repeats.length === 1 ? '' : 's'} account
                for {num(intel.repeats.reduce((a, r) => a + r.incidents, 0))} incidents.
              </p>
              <div className="space-y-1">
                {intel.repeats.slice(0, 8).map((r) => (
                  <div key={r.asset} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                    <span className="font-mono text-[var(--text-primary)]">{r.asset}</span>
                    <span className="text-orange-400">{r.incidents} incidents</span>
                    <span className="text-[var(--text-muted)]">
                      {r.first} to {r.last}
                      {r.meanGapDays != null && <> · about {r.meanGapDays} days apart</>}
                    </span>
                    {r.sites.length > 1 && (
                      <span className="text-[var(--text-muted)]">· {r.sites.join(', ')}</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={15} className="text-orange-400" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">How long cases take to close</p>
          </div>
          {intel.closure.measured === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">
              No incident records both an incident date and a release date, so closure time cannot be measured.
            </p>
          ) : (
            <>
              <p className="text-xs text-[var(--text-dim)] mb-3">
                Median {intel.closure.median} days, longest {intel.closure.longest}, average {intel.closure.mean}.
                {' '}Measured on {num(intel.closure.measured)} of {num(intel.closure.total)} incidents. The spread
                matters more than the average: a wide one is a process problem, a tight one is just the workload.
              </p>
              <div className="space-y-1.5">
                {intel.closure.rows.map((r) => (
                  <ShareRow key={r.label} label={r.label} value={r.value}
                    total={intel.closure.measured} tone="bg-emerald-500" />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Recovery, with the count it rests on ────────────────────────────── */}
      {intel.recovery.withClaim > 0 && (
        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Claim recovery</p>
            <span className="text-xs text-[var(--text-muted)] ml-auto">
              on {num(intel.recovery.withClaim)} of {num(intel.recovery.total)} incidents
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div><p className="text-lg font-bold text-[var(--text-primary)]">{money(intel.recovery.claimed)}</p>
              <p className="text-[11px] text-[var(--text-muted)]">Claimed</p></div>
            <div><p className="text-lg font-bold text-emerald-400">{money(intel.recovery.recovered)}</p>
              <p className="text-[11px] text-[var(--text-muted)]">Recovered</p></div>
            <div><p className="text-lg font-bold text-orange-400">{money(intel.recovery.outstanding)}</p>
              <p className="text-[11px] text-[var(--text-muted)]">Still outstanding</p></div>
            <div>
              <p className="text-lg font-bold text-[var(--text-primary)]">{pct(intel.recovery.ratio)}</p>
              <p className="text-[11px] text-[var(--text-muted)]">Recovered of claimed</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Possible duplicates: reported, never removed ────────────────────── */}
      {intel.duplicates.length > 0 && (
        <div className="card border-l-2 border-l-amber-500/60">
          <div className="flex items-center gap-2 mb-2">
            <Copy size={15} className="text-amber-400" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              Same vehicle, same day - worth a check
            </p>
          </div>
          <p className="text-xs text-[var(--text-dim)] mb-2">
            These may be genuine repeat events or the same incident entered twice. Nothing is removed
            automatically, because only you can tell which. Every count on this page includes them.
          </p>
          <div className="space-y-1">
            {intel.duplicates.map((d) => (
              <div key={`${d.asset}-${d.date}`} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="font-mono text-[var(--text-primary)]">{d.asset}</span>
                <span className="text-[var(--text-dim)]">{d.date}</span>
                <span className="text-amber-400">{d.count} records</span>
                <span className="text-[var(--text-muted)]">
                  {d.identical
                    ? 'nothing distinguishes them'
                    : `differ on ${d.differingFields.join(', ')}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
