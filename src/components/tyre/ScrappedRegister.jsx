/**
 * The scrapped register: the tyres someone actually marked as scrap.
 *
 * This exists because Scrap Management never showed them. Its whole page works
 * off a heuristic - `risk_level === 'Critical' || category === 'Scrap'` - which
 * has nothing to do with anyone pressing Scrap, so a tyre scrapped from Serial
 * Tracker or the phone simply did not appear here. This panel reads the scrap
 * marks themselves.
 *
 * Two things it deliberately does NOT hide:
 *
 *   1. Tyres carrying status='Scrapped' with no mark. They come from the bulk
 *      Scrap action on the Tyre Records grid, which writes the status and
 *      nothing else, so no one is recorded as having scrapped them. They are
 *      real scrapped stock and belong in the register, but they are labelled
 *      "not recorded" rather than dressed up with an attribution that was never
 *      captured.
 *   2. Who scrapped each tyre and when. That is the traceability the register is
 *      for, and it survives an undo because the RPC audits before it deletes.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Trash2, Search, RefreshCw, Undo2, Pencil, User, AlertTriangle,
  FileSpreadsheet, ShieldAlert, X, Check,
} from 'lucide-react'
import {
  listScrappedTyres, scrapTyreBySerial, unscrapTyreBySerial, updateScrapReason,
  getScrapPermissions, findTyreBySerial,
} from '../../lib/api/tyreExchange'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'
import EmptyState from '../EmptyState'

const fmtDate = (v) => {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime())
    ? 'N/A'
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
const money = (v, cur) => (v == null || !Number.isFinite(Number(v))
  ? 'N/A'
  : `${cur || ''} ${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`.trim())

const EXPORT_COLS = ['serial', 'asset_no', 'tyre_position', 'brand', 'size', 'site', 'country',
  'reason', 'scrapped_by_name', 'scrapped_at', 'cost_per_tyre', 'marked']
const EXPORT_HEADERS = ['Serial', 'Asset', 'Position', 'Brand', 'Size', 'Site', 'Country',
  'Reason', 'Scrapped by', 'Scrapped on', 'Cost', 'Recorded']

export default function ScrappedRegister({ country, currency }) {
  const [rows, setRows] = useState([])
  const [totals, setTotals] = useState({ total: 0, marked_total: 0, unattributed_total: 0, truncated: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [perms, setPerms] = useState({ canScrap: false, canUndo: false })
  const [busy, setBusy] = useState('')
  const [editing, setEditing] = useState(null)   // serial being re-reasoned
  const [editText, setEditText] = useState('')
  const [notice, setNotice] = useState('')

  // Mark-a-scrap flow. It lives here because Serial Tracker, the only other
  // place with a Scrap button, is an Admin-only route - so without this a Tyre
  // Data Collector could see the register but had nowhere to actually scrap a
  // tyre from the web.
  const [markOpen, setMarkOpen] = useState(false)
  const [markSerial, setMarkSerial] = useState('')
  const [markReason, setMarkReason] = useState('')
  const [markFound, setMarkFound] = useState(null)   // null = not looked up yet
  const [markLooking, setMarkLooking] = useState(false)
  const [markErr, setMarkErr] = useState('')

  // The server decides what this user may do, so the buttons and the RPC can
  // never disagree. A per-user capability grant is invisible to a role check.
  useEffect(() => {
    let cancelled = false
    getScrapPermissions().then((p) => { if (!cancelled) setPerms(p) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await listScrappedTyres({ search: query, country })
      setRows(res.rows)
      setTotals({
        total: res.total || 0,
        marked_total: res.marked_total || 0,
        unattributed_total: res.unattributed_total || 0,
        truncated: res.truncated === true,
      })
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the scrapped register.'))
    } finally { setLoading(false) }
  }, [query, country])

  useEffect(() => { load() }, [load])

  // debounce the search box so typing is not one query per keystroke
  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 350)
    return () => clearTimeout(id)
  }, [search])

  const undo = useCallback(async (serial) => {
    if (!window.confirm(`Undo the scrap on ${serial}? The tyre goes back to the status it had before it was scrapped.`)) return
    setBusy(serial); setError(''); setNotice('')
    try {
      const res = await unscrapTyreBySerial(serial)
      setNotice(res.restoredExactly
        ? `${serial} restored to its previous status.`
        // Honest about the older marks: they predate the prior-status capture,
        // so the undo had to fall back to Active.
        : `${serial} was marked before its previous status was recorded, so it was set back to Active. Check the tyre before reissuing it.`)
      await load()
    } catch (e) {
      setError(toUserMessage(e, 'Could not undo the scrap.'))
    } finally { setBusy('') }
  }, [load])

  // Confirm the serial is a real tyre before offering to scrap it. Scrapping is
  // keyed on the serial alone, so a typo would otherwise create a mark against
  // a tyre that does not exist.
  const lookup = useCallback(async () => {
    const s = markSerial.trim()
    if (!s) return
    setMarkLooking(true); setMarkErr(''); setMarkFound(null)
    try {
      const t = await findTyreBySerial(s)
      if (!t) setMarkErr(`No tyre found with serial ${s}. Check the number.`)
      setMarkFound(t)
    } catch (e) {
      setMarkErr(toUserMessage(e, 'Could not look up that serial.'))
    } finally { setMarkLooking(false) }
  }, [markSerial])

  const confirmMark = useCallback(async () => {
    const s = markSerial.trim()
    if (!s || !markFound) return
    setBusy(s); setMarkErr('')
    try {
      const res = await scrapTyreBySerial(s, { reason: markReason, country: markFound.country || null })
      setMarkOpen(false); setMarkSerial(''); setMarkReason(''); setMarkFound(null)
      setNotice(`${s} marked as scrap${res.updated ? ` (${res.updated} record${res.updated === 1 ? '' : 's'} updated)` : ''}.`)
      await load()
    } catch (e) {
      setMarkErr(toUserMessage(e, 'Could not mark this tyre as scrap.'))
    } finally { setBusy('') }
  }, [markSerial, markReason, markFound, load])

  const saveReason = useCallback(async () => {
    if (!editing) return
    setBusy(editing); setError('')
    try {
      await updateScrapReason(editing, editText)
      setEditing(null); setEditText('')
      await load()
    } catch (e) {
      setError(toUserMessage(e, 'Could not update the reason.'))
    } finally { setBusy('') }
  }, [editing, editText, load])

  const exportRows = useMemo(() => rows.map((r) => ({
    ...r,
    scrapped_at: r.scrapped_at ? fmtDate(r.scrapped_at) : 'N/A',
    scrapped_by_name: r.scrapped_by_name || 'Not recorded',
    marked: r.marked ? 'Scrap button' : 'Bulk status change (no record)',
  })), [rows])

  return (
    <div className="space-y-4">
      {/* ── Mark a tyre as scrap ─────────────────────────────────────────── */}
      {markOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setMarkOpen(false) }}>
          <div className="card w-full max-w-md space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <Trash2 size={16} className="text-red-400" /> Mark a tyre as scrap
              </h3>
              <button onClick={() => setMarkOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <X size={16} />
              </button>
            </div>

            <div>
              <label className="text-xs text-[var(--text-muted)]">Serial number</label>
              <div className="flex gap-2 mt-1">
                <input value={markSerial}
                  onChange={(e) => { setMarkSerial(e.target.value); setMarkFound(null); setMarkErr('') }}
                  onKeyDown={(e) => { if (e.key === 'Enter') lookup() }}
                  placeholder="Type or scan the serial" autoFocus
                  className="input flex-1 text-sm font-mono" />
                <button onClick={lookup} disabled={!markSerial.trim() || markLooking}
                  className="btn-secondary text-sm px-3 disabled:opacity-50">
                  {markLooking ? 'Finding...' : 'Find'}
                </button>
              </div>
            </div>

            {/* The tyre is shown before the action so the operator confirms the
                right one, not just the right-looking number. */}
            {markFound && (
              <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] p-2.5 text-xs space-y-1">
                <p className="text-[var(--text-primary)] font-medium">{markFound.serial_no}</p>
                <p className="text-[var(--text-secondary)]">
                  {markFound.asset_no || 'No asset'}{markFound.tyre_position ? ` · ${markFound.tyre_position}` : ''}
                  {markFound.brand ? ` · ${markFound.brand}` : ''}{markFound.size ? ` ${markFound.size}` : ''}
                </p>
                <p className="text-[var(--text-dim)]">
                  {markFound.site || 'No site'}{markFound.country ? ` · ${markFound.country}` : ''} · currently {markFound.status || 'Active'}
                </p>
                {String(markFound.status || '') === 'Scrapped' && (
                  <p className="text-amber-400">This tyre already reads as scrapped.</p>
                )}
              </div>
            )}

            <div>
              <label className="text-xs text-[var(--text-muted)]">Reason</label>
              <textarea value={markReason} onChange={(e) => setMarkReason(e.target.value)}
                placeholder="Why is it being scrapped? For example: sidewall cut, tread separation"
                className="input w-full text-sm mt-1 min-h-[64px]" />
            </div>

            {markErr ? <p className="text-xs text-red-400">{markErr}</p> : null}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setMarkOpen(false)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={confirmMark} disabled={!markFound || busy === markSerial.trim()}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md font-medium border border-red-700/50 bg-red-900/30 text-red-200 hover:bg-red-900/50 transition-colors disabled:opacity-40">
                <Trash2 size={14} /> {busy === markSerial.trim() ? 'Marking...' : 'Mark as scrap'}
              </button>
            </div>
            <p className="text-[11px] text-[var(--text-dim)]">
              Your name and the time are recorded against this scrap. Undoing it is an administrator action.
            </p>
          </div>
        </div>
      )}

      {/* ── Counts. The unattributed figure is the honest one: it is how much
             scrapped stock has nobody's name against it. ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card">
          <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5"><Trash2 size={12} /> Scrapped tyres</p>
          <p className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">{totals.total.toLocaleString('en-US')}</p>
        </div>
        <div className="card">
          <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5"><User size={12} /> Scrapped by a person</p>
          <p className="text-2xl font-bold text-emerald-400 mt-0.5">{totals.marked_total.toLocaleString('en-US')}</p>
          <p className="text-[11px] text-[var(--text-dim)] mt-0.5">Marked with the Scrap button, so who and when is recorded</p>
        </div>
        <div className="card">
          <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5"><AlertTriangle size={12} /> No record of who</p>
          <p className={`text-2xl font-bold mt-0.5 ${totals.unattributed_total > 0 ? 'text-amber-400' : 'text-[var(--text-primary)]'}`}>
            {totals.unattributed_total.toLocaleString('en-US')}
          </p>
          <p className="text-[11px] text-[var(--text-dim)] mt-0.5">Status changed in bulk from the tyre grid, which saves no name</p>
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search serial, asset, brand or reason"
              className="input w-full pl-9 text-sm"
            />
          </div>
          {perms.canScrap && (
            <button
              onClick={() => { setMarkOpen(true); setMarkSerial(''); setMarkReason(''); setMarkFound(null); setMarkErr('') }}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md font-medium border border-red-700/50 bg-red-900/20 text-red-300 hover:bg-red-900/40 transition-colors">
              <Trash2 size={14} /> Mark a tyre as scrap
            </button>
          )}
          <button onClick={load} disabled={loading}
            className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button
            onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS,
              reportFileName('TyrePulse Scrapped Register'))}
            disabled={!rows.length}
            className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            <FileSpreadsheet size={13} /> Excel
          </button>
        </div>

        {!perms.canScrap && (
          <p className="text-[11px] text-[var(--text-dim)] flex items-center gap-1.5">
            <ShieldAlert size={12} /> You can view this register. Marking a tyre as scrap needs the tyre scrap permission.
          </p>
        )}
        {perms.canScrap && !perms.canUndo && (
          <p className="text-[11px] text-[var(--text-dim)] flex items-center gap-1.5">
            <ShieldAlert size={12} /> You can mark a tyre as scrap and edit the reason. Undoing a scrap is an administrator action.
          </p>
        )}

        {totals.truncated && (
          // Never let a capped list read as the whole list.
          <p className="text-[11px] text-amber-400">
            Showing the {rows.length.toLocaleString('en-US')} most recent of {totals.total.toLocaleString('en-US')}. Narrow the search to see the rest.
          </p>
        )}
        {notice ? <div className="text-xs text-emerald-400 bg-emerald-500/10 rounded px-2 py-1.5">{notice}</div> : null}
        {error ? <div className="text-sm text-red-400">{error}</div> : null}

        {loading ? (
          <p className="text-sm text-[var(--text-muted)] py-6 text-center">Loading the scrapped register.</p>
        ) : !rows.length ? (
          <EmptyState
            icon={Trash2}
            title={query ? 'Nothing matches that search' : 'No tyres have been scrapped'}
            message={query
              ? 'Try a different serial, asset or brand.'
              : 'When someone marks a tyre as scrap from Serial Tracker or the phone, it appears here with their name against it.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--text-muted)] border-b border-[var(--hairline)]">
                  <th className="py-2 pr-3 font-semibold">Serial</th>
                  <th className="py-2 px-3 font-semibold">Asset</th>
                  <th className="py-2 px-3 font-semibold">Tyre</th>
                  <th className="py-2 px-3 font-semibold">Site</th>
                  <th className="py-2 px-3 font-semibold">Reason</th>
                  <th className="py-2 px-3 font-semibold">Scrapped by</th>
                  <th className="py-2 px-3 font-semibold text-right">Cost</th>
                  <th className="py-2 pl-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.serial} className="border-b border-[var(--hairline)]/60 align-top">
                    <td className="py-2 pr-3">
                      <Link to={`/tyre-passport/${encodeURIComponent(r.serial)}`}
                        className="font-mono text-[var(--text-primary)] hover:text-[var(--accent)]">
                        {r.serial}
                      </Link>
                    </td>
                    <td className="py-2 px-3">
                      {r.asset_no ? (
                        <Link to={`/assets/${encodeURIComponent(r.asset_no)}`}
                          className="text-[var(--text-secondary)] hover:text-[var(--accent)]">{r.asset_no}</Link>
                      ) : <span className="text-[var(--text-dim)]">N/A</span>}
                      {r.tyre_position ? <span className="text-[11px] text-[var(--text-dim)] ml-1.5">{r.tyre_position}</span> : null}
                    </td>
                    <td className="py-2 px-3 text-[var(--text-secondary)]">
                      {r.brand || 'N/A'}{r.size ? <span className="text-[var(--text-dim)]"> {r.size}</span> : null}
                    </td>
                    <td className="py-2 px-3 text-[var(--text-secondary)]">{r.site || 'N/A'}</td>
                    <td className="py-2 px-3 text-[var(--text-tertiary)] max-w-[220px]">
                      {editing === r.serial ? (
                        <div className="flex items-center gap-1">
                          <input value={editText} onChange={(e) => setEditText(e.target.value)}
                            className="input text-xs py-1 flex-1" autoFocus
                            onKeyDown={(e) => { if (e.key === 'Enter') saveReason(); if (e.key === 'Escape') setEditing(null) }} />
                          <button onClick={saveReason} disabled={busy === r.serial}
                            className="text-emerald-400 disabled:opacity-50" title="Save"><Check size={14} /></button>
                          <button onClick={() => setEditing(null)} className="text-[var(--text-muted)]" title="Cancel"><X size={14} /></button>
                        </div>
                      ) : (
                        <span title={r.reason || ''}>{r.reason || <span className="text-[var(--text-dim)]">Not given</span>}</span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      {r.marked ? (
                        <>
                          <span className="text-[var(--text-secondary)]">{r.scrapped_by_name || 'Unknown user'}</span>
                          <span className="block text-[11px] text-[var(--text-dim)]">{fmtDate(r.scrapped_at)}</span>
                        </>
                      ) : (
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400"
                          title="This tyre's status was changed in bulk from the tyre grid, which does not save who did it.">
                          Not recorded
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right text-[var(--text-secondary)]">{money(r.cost_per_tyre, currency)}</td>
                    <td className="py-2 pl-3 text-right whitespace-nowrap">
                      {/* Editing a reason and undoing are separate rights, so
                          they are shown separately. */}
                      {perms.canScrap && r.marked ? (
                        <button onClick={() => { setEditing(r.serial); setEditText(r.reason || '') }}
                          disabled={busy === r.serial}
                          className="text-[var(--text-muted)] hover:text-[var(--accent)] mr-2 disabled:opacity-50"
                          title="Edit reason"><Pencil size={14} /></button>
                      ) : null}
                      {perms.canUndo && r.marked ? (
                        <button onClick={() => undo(r.serial)} disabled={busy === r.serial}
                          className="text-amber-400 hover:text-amber-300 disabled:opacity-50 inline-flex items-center gap-1 text-xs"
                          title="Undo scrap"><Undo2 size={14} /> Undo</button>
                      ) : !r.marked ? (
                        <span className="text-[11px] text-[var(--text-dim)]">No mark to undo</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
