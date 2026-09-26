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
import EnterpriseTable from '../ui/EnterpriseTable'
import Modal from '../ui/Modal'

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

const EXPORT_COLS = ['serial', 'asset_no', 'tyre_position', 'vehicle_type', 'make', 'brand', 'size',
  'site', 'country', 'job_card', 'job_card_type', 'job_card_status', 'job_card_complaint',
  'km_run', 'tread_depth', 'reason', 'scrapped_by_name', 'scrapped_at', 'cost_per_tyre',
  'disposal_status', 'marked']
const EXPORT_HEADERS = ['Serial', 'Asset', 'Position', 'Vehicle type', 'Make', 'Brand', 'Size',
  'Site', 'Country', 'Job card', 'Job card type', 'Job card status', 'Job card complaint',
  'Km run', 'Tread depth', 'Reason', 'Scrapped by', 'Scrapped on', 'Cost',
  'Disposal', 'Recorded']

export default function ScrappedRegister({ country, currency }) {
  const [rows, setRows] = useState([])
  const [totals, setTotals] = useState({ total: 0, marked_total: 0, unattributed_total: 0, truncated: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [linked, setLinked] = useState(null)
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
      setLinked(res.linked || null)
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
    scrapped_by_name: r.marked ? (r.scrapped_by_name || 'Unknown user') : 'Not recorded',
    disposal_status: r.disposal_status || 'Not started',
    marked: r.marked ? 'Scrap button' : 'Bulk status change (no record)',
  })), [rows])

  const columns = useMemo(() => [
    { accessorKey: 'serial', header: 'Serial', meta: { exportHeader: 'Serial' },
      cell: ({ row }) => (
        <Link to={`/tyre-passport/${encodeURIComponent(row.original.serial)}`}
          className="font-mono text-[var(--text-primary)] hover:text-[var(--accent)] underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded">
          {row.original.serial}
        </Link>
      ) },
    { accessorKey: 'asset_no', header: 'Vehicle',
      cell: ({ row }) => {
        const r = row.original
        return (
          <span className="block">
            {r.asset_no ? (
              <Link to={`/asset-management/${encodeURIComponent(r.asset_no)}`}
                className="text-[var(--text-secondary)] hover:text-[var(--accent)] hover:underline">{r.asset_no}</Link>
            ) : <span className="text-[var(--text-dim)]">N/A</span>}
            <span className="block text-[11px] text-[var(--text-dim)]">
              {[r.vehicle_type, r.make, r.site].filter(Boolean).join(' · ') || 'No vehicle detail'}
            </span>
          </span>
        )
      } },
    { accessorKey: 'brand', header: 'Tyre',
      cell: ({ row }) => {
        const r = row.original
        return (
          <span className="block text-[var(--text-secondary)]">
            {r.brand || 'N/A'}{r.size ? <span className="text-[var(--text-dim)]"> {r.size}</span> : null}
            <span className="block text-[11px] text-[var(--text-dim)]">
              {r.tyre_position || 'No position'}
              {r.tread_depth != null ? ` · ${r.tread_depth} mm` : ''}
            </span>
          </span>
        )
      } },
    // The job card is on every scrapped tyre and matches a real work order, so
    // it can show what the vehicle was in for.
    { accessorKey: 'job_card', header: 'Job card',
      cell: ({ row }) => {
        const r = row.original
        if (!r.job_card) return <span className="text-[var(--text-dim)]">N/A</span>
        return (
          <span className="block">
            <span className="text-[var(--text-secondary)] font-mono text-xs">{r.job_card}</span>
            <span className="block text-[11px] text-[var(--text-dim)] max-w-[190px] truncate"
              title={[r.job_card_type, r.job_card_status, r.job_card_complaint].filter(Boolean).join(' · ')}>
              {[r.job_card_type, r.job_card_complaint].filter(Boolean).join(' · ') || 'No detail'}
            </span>
          </span>
        )
      } },
    { accessorKey: 'reason', header: 'Reason',
      cell: ({ row }) => {
        const r = row.original
        if (editing === r.serial) {
          return (
            <span className="flex items-center gap-1 min-w-[200px]">
              <label htmlFor={`scrap-reason-${r.serial}`} className="sr-only">Scrap reason for {r.serial}</label>
              <input id={`scrap-reason-${r.serial}`} value={editText} onChange={(e) => setEditText(e.target.value)}
                className="input text-xs py-1 flex-1 min-h-[36px]" autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') saveReason(); if (e.key === 'Escape') setEditing(null) }} />
              <button onClick={saveReason} disabled={busy === r.serial}
                className="inline-flex items-center justify-center min-h-[36px] min-w-[36px] rounded text-emerald-400 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                aria-label={`Save reason for ${r.serial}`}><Check size={14} /></button>
              <button onClick={() => setEditing(null)}
                className="inline-flex items-center justify-center min-h-[36px] min-w-[36px] rounded text-[var(--text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                aria-label="Cancel editing the reason"><X size={14} /></button>
            </span>
          )
        }
        return <span className="text-[var(--text-tertiary)] block max-w-[220px]" title={r.reason || ''}>{r.reason || <span className="text-[var(--text-dim)]">Not given</span>}</span>
      } },
    { id: 'scrapped_by', header: 'Scrapped by', accessorFn: (r) => (r.marked ? (r.scrapped_by_name || 'Unknown user') : 'Not recorded'),
      cell: ({ row }) => {
        const r = row.original
        return r.marked ? (
          <span className="block">
            <span className="text-[var(--text-secondary)]">{r.scrapped_by_name || 'Unknown user'}</span>
            <span className="block text-[11px] text-[var(--text-dim)]">{fmtDate(r.scrapped_at)}</span>
          </span>
        ) : (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400"
            title="This tyre's status was changed in bulk from the tyre grid, which does not save who did it.">
            Not recorded
          </span>
        )
      } },
    // Km and cost are frequently missing on these records, so both read N/A
    // rather than 0 - a scrapped tyre showing "0 km" or "0" cost would be
    // taken as fact.
    { accessorKey: 'km_run', header: 'Km run', meta: { align: 'right' },
      cell: ({ getValue }) => (getValue() == null ? <span className="text-[var(--text-dim)]">N/A</span>
        : <span className="tabular-nums">{Number(getValue()).toLocaleString('en-US')}</span>) },
    { accessorKey: 'cost_per_tyre', header: 'Cost', meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums">{money(getValue(), currency)}</span> },
    { accessorKey: 'disposal_status', header: 'Disposal',
      cell: ({ getValue }) => (getValue()
        ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">{getValue()}</span>
        : <span className="text-[11px] text-[var(--text-dim)]">Not started</span>) },
    { id: 'actions', header: 'Actions', meta: { align: 'right', export: false },
      cell: ({ row }) => {
        const r = row.original
        // Editing a reason and undoing are separate rights, so they are shown separately.
        return (
          <span className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
            {perms.canScrap && r.marked ? (
              <button onClick={() => { setEditing(r.serial); setEditText(r.reason || '') }}
                disabled={busy === r.serial}
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded text-[var(--text-muted)] hover:text-[var(--accent)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                aria-label={`Edit scrap reason for ${r.serial}`}><Pencil size={14} /></button>
            ) : null}
            {perms.canUndo && r.marked ? (
              <button onClick={() => undo(r.serial)} disabled={busy === r.serial}
                className="inline-flex items-center gap-1 min-h-[44px] px-2 rounded text-xs text-amber-400 hover:text-amber-300 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
                <Undo2 size={14} aria-hidden="true" /> Undo
              </button>
            ) : !r.marked ? (
              <span className="text-[11px] text-[var(--text-dim)]">No mark to undo</span>
            ) : null}
          </span>
        )
      } },
  ], [editing, editText, busy, perms, currency, saveReason, undo])

  return (
    <div className="space-y-4">
      {/* ── Mark a tyre as scrap ─────────────────────────────────────────── */}
      <Modal
        open={markOpen}
        onClose={() => setMarkOpen(false)}
        size="sm"
        title="Mark a tyre as scrap"
        footer={(
          <div className="flex justify-end gap-2">
            <button onClick={() => setMarkOpen(false)} className="btn-secondary text-sm min-h-[44px]">Cancel</button>
            <button onClick={confirmMark} disabled={!markFound || busy === markSerial.trim()}
              className="flex items-center gap-1.5 text-sm min-h-[44px] px-3 rounded-md font-medium border border-red-700/50 bg-red-900/30 text-red-200 hover:bg-red-900/50 transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
              <Trash2 size={14} aria-hidden="true" /> {busy === markSerial.trim() ? 'Marking...' : 'Mark as scrap'}
            </button>
          </div>
        )}
      >
        <div className="space-y-3">
          <div>
            <label htmlFor="scrap-mark-serial" className="text-xs text-[var(--text-muted)]">Serial number</label>
            <div className="flex gap-2 mt-1">
              <input id="scrap-mark-serial" value={markSerial}
                onChange={(e) => { setMarkSerial(e.target.value); setMarkFound(null); setMarkErr('') }}
                onKeyDown={(e) => { if (e.key === 'Enter') lookup() }}
                placeholder="Type or scan the serial" autoFocus
                className="input flex-1 text-sm font-mono min-h-[44px]" />
              <button onClick={lookup} disabled={!markSerial.trim() || markLooking}
                className="btn-secondary text-sm px-3 min-h-[44px] disabled:opacity-50">
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
            <label htmlFor="scrap-mark-reason" className="text-xs text-[var(--text-muted)]">Reason</label>
            <textarea id="scrap-mark-reason" value={markReason} onChange={(e) => setMarkReason(e.target.value)}
              placeholder="Why is it being scrapped? For example: sidewall cut, tread separation"
              className="input w-full text-sm mt-1 min-h-[64px]" />
          </div>

          {markErr ? <p role="alert" className="text-xs text-red-400">{markErr}</p> : null}

          <p className="text-[11px] text-[var(--text-dim)]">
            Your name and the time are recorded against this scrap. Undoing it is an administrator action.
          </p>
        </div>
      </Modal>

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
            <label htmlFor="scrapped-register-search" className="sr-only">Search the scrapped register</label>
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input
              id="scrapped-register-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search serial, asset, brand or reason"
              className="input w-full pl-9 text-sm min-h-[44px]"
            />
          </div>
          {perms.canScrap && (
            <button
              onClick={() => { setMarkOpen(true); setMarkSerial(''); setMarkReason(''); setMarkFound(null); setMarkErr('') }}
              className="flex items-center gap-1.5 text-sm min-h-[44px] px-3 rounded-md font-medium border border-red-700/50 bg-red-900/20 text-red-300 hover:bg-red-900/40 transition-colors">
              <Trash2 size={14} /> Mark a tyre as scrap
            </button>
          )}
          <button onClick={load} disabled={loading}
            className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button
            onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS,
              reportFileName('TyrePulse Scrapped Register'))}
            disabled={!rows.length}
            className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5 disabled:opacity-50">
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

        {/* What the linked record actually contains. Published rather than
            implied, because a blank column reads as a bug while a stated
            "cost known on 7 of 18" reads as the data gap it is. */}
        {totals.total > 0 && linked && (
          <p className="text-[11px] text-[var(--text-dim)]">
            Linked to source records: job card on {linked.with_job_card} of {totals.total}
            {' · '}cost on {linked.with_cost}
            {' · '}distance on {linked.with_km}
            {' · '}disposal started on {linked.with_disposal}
          </p>
        )}
        {totals.truncated && (
          // Never let a capped list read as the whole list.
          <p className="text-[11px] text-amber-400">
            Showing the {rows.length.toLocaleString('en-US')} most recent of {totals.total.toLocaleString('en-US')}. Narrow the search to see the rest.
          </p>
        )}
        {notice ? <div role="status" className="text-xs text-emerald-400 bg-emerald-500/10 rounded px-2 py-1.5">{notice}</div> : null}
        {error && rows.length ? <div role="alert" className="text-sm text-red-400">{error}</div> : null}

        {error && !rows.length ? (
          // A failed read is a failure, never "no tyres have been scrapped".
          <div role="alert" className="py-8 flex flex-col items-center gap-3 text-center">
            <AlertTriangle size={24} className="text-red-400" aria-hidden="true" />
            <p className="text-sm text-[var(--text-secondary)]">The scrapped register could not be loaded.</p>
            <button onClick={load} className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5">
              <RefreshCw size={13} aria-hidden="true" /> Retry
            </button>
          </div>
        ) : !loading && !rows.length ? (
          <EmptyState
            icon={Trash2}
            title={query ? 'Nothing matches that search' : 'No tyres have been scrapped'}
            description={query
              ? 'Try a different serial, asset or brand.'
              : 'When someone marks a tyre as scrap from Serial Tracker or the phone, it appears here with their name against it.'}
          />
        ) : (
          <EnterpriseTable
            columns={columns}
            data={rows}
            getRowId={(r) => String(r.serial)}
            loading={loading}
            enableGlobalFilter={false}
            enableExport={false}
            initialPageSize={25}
            emptyMessage="No scrapped tyres"
          />
        )}
      </div>
    </div>
  )
}
