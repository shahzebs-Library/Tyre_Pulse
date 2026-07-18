/**
 * Tyre Bay - the per-vehicle wheel bay for the Asset Detail page. Renders the
 * 3D-style vehicle diagram (current-tyre risk lit up per wheel), a detail panel
 * for the selected position (current tyre + full position history), an
 * all-positions table fallback, and one-click Move/Swap and Remove actions that
 * write through the existing tyre-record path.
 *
 * Presentational only: it receives already-loaded rows as props and never
 * fetches. Writes are gated by the page's approval lock (`locked`) and refresh
 * the parent via `onMoved`. User-facing errors go through safeError.toUserMessage.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Layers, ExternalLink, ArrowLeftRight, Trash2, X, Save, RefreshCw, Lock,
  History, ChevronDown, ChevronRight, CircleDot,
} from 'lucide-react'
import VehicleTyreDiagram from './VehicleTyreDiagram'
import {
  groupTyresByPosition, canonicalToSlotId, serialOf, tyreLifeKm, cpk, daysFitted,
  layoutPositionsFor,
} from '../lib/tyreBay'
import { moveTyre, removeTyre } from '../lib/api/tyreRecords'
import { formatCurrencyCompact, formatDate } from '../lib/formatters'
import toUserMessage from '../lib/safeError'

const RISK_BADGE = {
  Critical: 'bg-red-900/50 text-red-300',
  High:     'bg-orange-900/50 text-orange-300',
  Medium:   'bg-yellow-900/50 text-yellow-300',
  Low:      'bg-green-900/50 text-green-300',
}
function riskBadge(level) {
  return RISK_BADGE[level] || 'bg-[var(--surface-2)] text-[var(--text-secondary)]'
}
const fmtKm = (n) => (n == null ? null : Number(n).toLocaleString('en-US'))
const todayISO = () => new Date().toISOString().slice(0, 10)

function PassportLink({ serial, className = '' }) {
  if (!serial) return <span className="text-[var(--text-dim)]">-</span>
  return (
    <Link
      to={`/tyre-passport/${encodeURIComponent(serial)}`}
      className={`inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors ${className}`}
      title="Open tyre passport"
    >
      {serial}
      <ExternalLink className="w-3 h-3 shrink-0" />
    </Link>
  )
}

// ── Move / Swap modal ──────────────────────────────────────────────────────────
function MoveModal({ tyre, asset, positions, onClose, onDone }) {
  const currentPos = tyre.position || tyre.tyre_position || ''
  const [mode, setMode] = useState('same') // same | cross
  const [toPosition, setToPosition] = useState(
    (positions.find((p) => p.code !== currentPos)?.code) || '',
  )
  const [toAsset, setToAsset] = useState('')
  const [km, setKm] = useState(asset?.current_km != null ? String(asset.current_km) : '')
  const [date, setDate] = useState(todayISO())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function confirm() {
    const target = toPosition.trim()
    if (!target) { setError('Choose a target position.'); return }
    if (mode === 'cross' && !toAsset.trim()) { setError('Enter the target asset number.'); return }
    setSaving(true); setError('')
    const { error: err } = await moveTyre({
      tyre,
      toAssetNo: mode === 'cross' ? toAsset : '',
      toPosition: target,
      km,
      date,
    })
    setSaving(false)
    if (err) { setError(toUserMessage(err)); return }
    onDone()
  }

  return (
    <ModalShell title="Move / Swap tyre" icon={ArrowLeftRight} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-[var(--text-muted)]">
          Serial {serialOf(tyre) || 'N/A'} at {currentPos || 'Unassigned'} on {tyre.asset_no || asset?.asset_no}
        </p>

        <div className="flex gap-2">
          {['same', 'cross'].map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                mode === m
                  ? 'bg-blue-600 text-white border-blue-500'
                  : 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)] hover:bg-[var(--surface-3)]'
              }`}>
              {m === 'same' ? 'Same vehicle' : 'Another vehicle'}
            </button>
          ))}
        </div>

        {mode === 'cross' && (
          <Field label="Target asset number">
            <input value={toAsset} onChange={(e) => setToAsset(e.target.value.toUpperCase())}
              placeholder="e.g. TM518"
              className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500" />
          </Field>
        )}

        <Field label="Target position">
          {mode === 'same' && positions.length ? (
            <select value={toPosition} onChange={(e) => setToPosition(e.target.value)} className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500">
              {positions.map((p) => (
                <option key={p.code} value={p.code} disabled={p.code === currentPos}>
                  {p.code}{p.code === currentPos ? ' (current)' : ''}
                </option>
              ))}
            </select>
          ) : (
            <input value={toPosition} onChange={(e) => setToPosition(e.target.value.toUpperCase())}
              placeholder="e.g. LHR1-O" className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500" />
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Odometer at move (km)">
            <input type="number" min="0" value={km} onChange={(e) => setKm(e.target.value)}
              placeholder="optional" className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500" />
          </Field>
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500" />
          </Field>
        </div>

        {error && <p className="text-red-400 text-xs bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}
      </div>
      <ModalActions onClose={onClose} onConfirm={confirm} saving={saving} confirmLabel="Move tyre" />
    </ModalShell>
  )
}

// ── Remove modal ────────────────────────────────────────────────────────────────
function RemoveModal({ tyre, asset, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [km, setKm] = useState(asset?.current_km != null ? String(asset.current_km) : '')
  const [date, setDate] = useState(todayISO())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function confirm() {
    setSaving(true); setError('')
    const { error: err } = await removeTyre({ tyre, reason, km, date })
    setSaving(false)
    if (err) { setError(toUserMessage(err)); return }
    onDone()
  }

  return (
    <ModalShell title="Remove tyre" icon={Trash2} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-[var(--text-muted)]">
          Serial {serialOf(tyre) || 'N/A'} at {tyre.position || tyre.tyre_position || 'Unassigned'} on {tyre.asset_no || asset?.asset_no}
        </p>
        <Field label="Removal reason">
          <input value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Worn out, puncture, scrap" className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Odometer at removal (km)">
            <input type="number" min="0" value={km} onChange={(e) => setKm(e.target.value)}
              placeholder="optional" className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500" />
          </Field>
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500" />
          </Field>
        </div>
        {error && <p className="text-red-400 text-xs bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}
      </div>
      <ModalActions onClose={onClose} onConfirm={confirm} saving={saving} confirmLabel="Remove tyre" danger />
    </ModalShell>
  )
}

// ── Modal building blocks (fixed overlay - never clipped by a .card) ────────────
function ModalShell({ title, icon: Icon, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-[var(--surface-1)] rounded-2xl border border-[var(--border-dim)] w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-dim)]">
          <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
            {Icon && <Icon className="w-5 h-5 text-blue-400" />}{title}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
function ModalActions({ onClose, onConfirm, saving, confirmLabel, danger = false }) {
  return (
    <div className="flex justify-end gap-3 mt-5">
      <button onClick={onClose} className="px-4 py-2 rounded-lg bg-[var(--surface-2)] text-[var(--text-secondary)] text-sm hover:bg-[var(--surface-3)] transition-colors">Cancel</button>
      <button onClick={onConfirm} disabled={saving}
        className={`px-5 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 ${
          danger ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'
        }`}>
        {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {saving ? 'Saving' : confirmLabel}
      </button>
    </div>
  )
}
function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs text-[var(--text-secondary)] mb-1 block">{label}</label>
      {children}
    </div>
  )
}

// ── Selected-position detail ────────────────────────────────────────────────────
function PositionDetail({ posKey, group, currency, locked, onMove, onRemove }) {
  const [showHistory, setShowHistory] = useState(true)
  if (!posKey) {
    return (
      <div className="card h-full flex flex-col items-center justify-center text-center py-10">
        <CircleDot className="w-8 h-8 text-[var(--text-dim)] mb-2" />
        <p className="text-sm text-[var(--text-secondary)]">Select a wheel or a row to see its tyre and history.</p>
      </div>
    )
  }
  const current = group?.current || null
  const history = group?.history || []
  const days = current ? daysFitted(current) : null
  const km = current ? tyreLifeKm(current) : null
  const cpkVal = current ? cpk(current) : null

  return (
    <div className="card h-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--text-secondary)] flex items-center gap-2">
          <CircleDot className="w-4 h-4 text-blue-400" /> Position {posKey}
        </h3>
        {current?.risk_level && (
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${riskBadge(current.risk_level)}`}>
            {current.risk_level}
          </span>
        )}
      </div>

      {current ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-[var(--text-primary)]">
              <PassportLink serial={serialOf(current)} />
            </div>
            {!locked && (
              <div className="flex gap-2">
                <button onClick={() => onMove(current)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--border-bright)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs transition-colors">
                  <ArrowLeftRight className="w-3.5 h-3.5" /> Move / Swap
                </button>
                <button onClick={() => onRemove(current)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-900/30 hover:bg-red-900/50 border border-red-800/40 text-red-300 text-xs transition-colors">
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
              </div>
            )}
          </div>
          {locked && (
            <p className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
              <Lock className="w-3 h-3" /> Locked by approval workflow
            </p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
            <Meta label="Brand" value={current.brand} />
            <Meta label="Size" value={current.size} />
            <Meta label="Tread" value={current.tread_depth != null ? `${current.tread_depth} mm` : null} />
            <Meta label="Pressure" value={current.pressure_reading != null ? `${current.pressure_reading} psi` : null} />
            <Meta label="Days fitted" value={days != null ? `${days} d` : null} />
            <Meta label="KM run" value={km != null ? `${fmtKm(km)} km` : null} />
            <Meta label="CPK" value={cpkVal != null ? formatCurrencyCompact(cpkVal, currency) : null} />
            <Meta label="Fitted" value={current.fitment_date || current.issue_date ? formatDate(current.fitment_date || current.issue_date) : null} />
          </div>
        </div>
      ) : (
        <p className="text-sm text-[var(--text-muted)] py-3">No tyre fitted at this position.</p>
      )}

      {/* History */}
      <div className="mt-4 pt-3 border-t border-[var(--border-dim)]">
        <button onClick={() => setShowHistory((s) => !s)}
          className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
          {showHistory ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <History className="w-3.5 h-3.5" /> History ({history.length})
        </button>
        {showHistory && (
          history.length ? (
            <div className="mt-2 space-y-2">
              {history.map((h, i) => {
                const hkm = tyreLifeKm(h)
                return (
                  <div key={h.id ?? i} className="rounded-lg bg-[var(--surface-2)] border border-[var(--border-bright)] px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <PassportLink serial={serialOf(h)} />
                      <span className="text-[var(--text-muted)]">
                        {h.fitment_date || h.issue_date ? formatDate(h.fitment_date || h.issue_date) : 'N/A'}
                        {' to '}
                        {h.removal_date ? formatDate(h.removal_date) : 'present'}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[var(--text-muted)]">
                      {h.brand && <span>{h.brand}</span>}
                      {hkm != null && <span>{fmtKm(hkm)} km run</span>}
                      {(h.removal_reason || h.reason_for_removal) && <span>Reason: {h.removal_reason || h.reason_for_removal}</span>}
                      {h.cost_per_tyre != null && <span>Cost: {formatCurrencyCompact(h.cost_per_tyre, currency)}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="mt-2 text-xs text-[var(--text-muted)]">No history for this position.</p>
          )
        )}
      </div>
    </div>
  )
}
function Meta({ label, value }) {
  return (
    <div>
      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{label}</p>
      <p className="text-[var(--text-secondary)]">{value ?? '-'}</p>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────────
export default function TyreBay({ asset, tyres, currency, locked = false, onMoved }) {
  const vehicleType = asset?.vehicle_type
  const groups = useMemo(() => groupTyresByPosition(tyres), [tyres])
  const positions = useMemo(() => layoutPositionsFor(vehicleType), [vehicleType])

  // Map diagram slot ids <-> canonical position keys so a wheel click selects the
  // right group and a current tyre's risk lights the right wheel.
  const slotToKey = useMemo(() => {
    const m = {}
    for (const key of Object.keys(groups)) {
      const slot = canonicalToSlotId(vehicleType, key)
      if (slot) m[slot] = key
    }
    return m
  }, [groups, vehicleType])

  const diagramPositions = useMemo(() => {
    const out = []
    for (const [key, g] of Object.entries(groups)) {
      if (!g.current) continue
      const slot = canonicalToSlotId(vehicleType, key)
      if (slot) out.push({ position: slot, risk_level: g.current.risk_level })
    }
    return out
  }, [groups, vehicleType])

  const [selectedPos, setSelectedPos] = useState(null)
  const [moveTarget, setMoveTarget] = useState(null)
  const [removeTarget, setRemoveTarget] = useState(null)

  const sortedKeys = useMemo(
    () => Object.keys(groups).sort((a, b) => a.localeCompare(b)),
    [groups],
  )

  function handleDiagramClick(obj) {
    const slot = obj?.position
    setSelectedPos(slotToKey[slot] || slot || null)
  }

  const hasAnyTyre = sortedKeys.length > 0

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Diagram */}
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-400" /> Wheel bay
          </h3>
          <div className="flex justify-center">
            <VehicleTyreDiagram
              vehicleType={vehicleType}
              positions={diagramPositions}
              onPositionClick={handleDiagramClick}
              width={260}
            />
          </div>
        </div>

        {/* Selected position detail */}
        <PositionDetail
          posKey={selectedPos}
          group={selectedPos ? groups[selectedPos] : null}
          currency={currency}
          locked={locked}
          onMove={setMoveTarget}
          onRemove={setRemoveTarget}
        />
      </div>

      {/* All positions table (works even when the diagram cannot render this type) */}
      <div className="bg-[var(--surface-2)] rounded-xl border border-[var(--border-bright)] overflow-hidden">
        <div className="p-4 border-b border-[var(--border-bright)]">
          <h3 className="text-sm font-semibold text-[var(--text-secondary)] flex items-center gap-2">
            <Layers className="w-4 h-4 text-green-400" /> All positions ({sortedKeys.length})
          </h3>
        </div>
        {hasAnyTyre ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border-bright)]">
                  {['Position', 'Current serial', 'Brand', 'Size', 'Tread', 'Risk', 'Days', 'CPK', 'History'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-[var(--text-muted)] font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedKeys.map((key) => {
                  const g = groups[key]
                  const cur = g.current
                  const days = cur ? daysFitted(cur) : null
                  const cpkVal = cur ? cpk(cur) : null
                  const selected = selectedPos === key
                  return (
                    <tr key={key}
                      onClick={() => setSelectedPos(key)}
                      className={`border-b border-[var(--border-bright)] cursor-pointer transition-colors ${
                        selected ? 'bg-[var(--surface-3)]' : 'hover:bg-[var(--surface-3)]'
                      }`}>
                      <td className="px-3 py-2 font-mono text-[var(--text-secondary)] whitespace-nowrap">{key}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{cur ? <PassportLink serial={serialOf(cur)} /> : <span className="text-[var(--text-dim)]">No tyre fitted</span>}</td>
                      <td className="px-3 py-2 text-[var(--text-secondary)]">{cur?.brand ?? '-'}</td>
                      <td className="px-3 py-2 text-[var(--text-secondary)]">{cur?.size ?? '-'}</td>
                      <td className="px-3 py-2 text-[var(--text-secondary)]">{cur?.tread_depth != null ? `${cur.tread_depth}mm` : '-'}</td>
                      <td className="px-3 py-2">
                        {cur?.risk_level
                          ? <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${riskBadge(cur.risk_level)}`}>{cur.risk_level}</span>
                          : <span className="text-[var(--text-dim)]">-</span>}
                      </td>
                      <td className="px-3 py-2 text-[var(--text-secondary)]">{days != null ? `${days}d` : '-'}</td>
                      <td className="px-3 py-2 text-[var(--text-secondary)]">{cpkVal != null ? formatCurrencyCompact(cpkVal, currency) : '-'}</td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">{g.history.length}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6 text-center text-[var(--text-muted)] text-sm">No tyres on record for this vehicle.</div>
        )}
      </div>

      {moveTarget && (
        <MoveModal
          tyre={moveTarget}
          asset={asset}
          positions={positions}
          onClose={() => setMoveTarget(null)}
          onDone={() => { setMoveTarget(null); onMoved?.() }}
        />
      )}
      {removeTarget && (
        <RemoveModal
          tyre={removeTarget}
          asset={asset}
          onClose={() => setRemoveTarget(null)}
          onDone={() => { setRemoveTarget(null); onMoved?.() }}
        />
      )}
    </div>
  )
}
