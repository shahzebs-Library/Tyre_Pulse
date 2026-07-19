/**
 * ReportShareBuilder - full-screen visual designer for CUSTOM TV / kiosk boards.
 *
 * Lets an elevated user turn a report share into bespoke boards: add / resize /
 * restyle blocks, arrange them on a fixed one-screen grid, and preview live via the
 * shared ShareBlockView renderer. Saving stores a normalized `layout` on the share
 * (or clears back to fixed pages). All geometry / catalog logic comes from the pure
 * engine src/lib/reportShareLayout so this UI never disagrees with the viewer.
 *
 * Chrome matches the dark app theme (var(--*) tokens, like ReportSharesPanel); the
 * live preview is a white "paper" board so it looks like the public wall board.
 * No em / en dashes, arrows, middle dots or curly quotes in any user-facing string.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Plus, Trash2, X, Save, Loader2, LayoutGrid, ChevronUp, ChevronDown,
  Copy, ExternalLink, Palette, Type,
} from 'lucide-react'
import ShareBlockView from './ShareBlockView'
import { colorAt } from '../../lib/reportColors'
import {
  SOURCES, SOURCE_BY_KEY, SOURCE_GROUPS, vizOptionsFor, defaultViz,
  BLOCK_PRESETS, blockFromPreset, normalizeBlock, normalizeBoard,
  normalizeLayout, emptyLayout, STARTER_LAYOUTS,
  BOARD_COLS_MIN, BOARD_COLS_MAX, BOARD_ROWS_MIN, BOARD_ROWS_MAX,
  MAX_BOARDS, MAX_BLOCKS_PER_BOARD, BLOCK_W_MIN, BLOCK_H_MIN,
} from '../../lib/reportShareLayout'
import { getReportSnapshot, updateReportShare, buildShareUrl } from '../../lib/api/reportShares'
import { toUserMessage } from '../../lib/safeError'

const clampInt = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}

const ACCENT_SWATCHES = Array.from({ length: 12 }, (_, i) => colorAt(i))

/** A short label describing what a block shows (source label or heading text). */
function blockLabel(block) {
  if (!block) return 'Block'
  if (block.type === 'text') return block.text ? `Heading: ${block.text}` : 'Heading'
  const s = SOURCE_BY_KEY[block.source]
  return block.title || (s ? s.label : 'Block')
}

export default function ReportShareBuilder({ share, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => normalizeLayout(share?.layout) || emptyLayout())
  const [activeBoardIdx, setActiveBoardIdx] = useState(0)
  const [selectedBlockId, setSelectedBlockId] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [previewNote, setPreviewNote] = useState(false)
  const [needPassword, setNeedPassword] = useState(false)
  const [pw, setPw] = useState('')
  const [pwChecking, setPwChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)          // { type: 'ok'|'err', text }
  const [copied, setCopied] = useState(false)

  const boards = draft.boards
  const activeBoard = boards[Math.min(activeBoardIdx, boards.length - 1)] || boards[0]
  const selectedBlock = activeBoard?.blocks.find((b) => b.id === selectedBlockId) || null
  const shareUrl = share?.token ? buildShareUrl(share.token) : ''

  // ── Preview data ────────────────────────────────────────────────────────────
  const applySnap = useCallback((snap) => {
    if (snap?.ok) { setSnapshot(snap); setNeedPassword(false); setPreviewNote(false); return true }
    if (snap?.reason === 'password') { setNeedPassword(true); return false }
    setSnapshot({}); setNeedPassword(false); setPreviewNote(true); return false
  }, [])

  useEffect(() => {
    let alive = true
    if (!share?.token) { setSnapshot({}); setPreviewNote(true); return () => {} }
    getReportSnapshot(share.token)
      .then((snap) => { if (alive) applySnap(snap) })
      .catch(() => { if (alive) { setSnapshot({}); setPreviewNote(true) } })
    return () => { alive = false }
  }, [share?.token, applySnap])

  async function submitPassword(e) {
    e.preventDefault()
    if (pwChecking) return
    setPwChecking(true)
    try {
      const snap = await getReportSnapshot(share.token, pw.trim() || null)
      applySnap(snap)
    } catch {
      setSnapshot({}); setPreviewNote(true); setNeedPassword(false)
    } finally {
      setPwChecking(false)
    }
  }

  // ── Draft mutation helpers ──────────────────────────────────────────────────
  const boardIndex = useCallback(() => Math.min(activeBoardIdx, boards.length - 1), [activeBoardIdx, boards.length])

  const updateBoard = useCallback((idx, updater) => {
    setDraft((d) => {
      const next = d.boards.map((b, i) => (i === idx ? updater(b) : b))
      return { ...d, boards: next }
    })
  }, [])

  /** Replace one block in the active board, re-normalizing + clamping to grid. */
  const patchBlock = useCallback((blockId, patch) => {
    const idx = boardIndex()
    updateBoard(idx, (board) => {
      const blocks = board.blocks.map((b) => {
        if (b.id !== blockId) return b
        const merged = normalizeBlock({ ...b, ...patch })
        return {
          ...merged,
          id: b.id,
          w: Math.min(merged.w, board.cols),
          h: Math.min(merged.h, board.rows),
        }
      })
      return { ...board, blocks }
    })
  }, [boardIndex, updateBoard])

  function addBlock(presetId) {
    const idx = boardIndex()
    const board = boards[idx]
    if (board.blocks.length >= MAX_BLOCKS_PER_BOARD) {
      setMsg({ type: 'err', text: `A board can hold up to ${MAX_BLOCKS_PER_BOARD} blocks.` })
      return
    }
    const fresh = blockFromPreset(presetId)
    const placed = { ...fresh, w: Math.min(fresh.w, board.cols), h: Math.min(fresh.h, board.rows) }
    updateBoard(idx, (b) => ({ ...b, blocks: [...b.blocks, placed] }))
    setSelectedBlockId(placed.id)
    setMsg(null)
  }

  function moveBlock(blockId, dir) {
    const idx = boardIndex()
    updateBoard(idx, (board) => {
      const list = [...board.blocks]
      const at = list.findIndex((b) => b.id === blockId)
      const to = at + dir
      if (at < 0 || to < 0 || to >= list.length) return board
      const [item] = list.splice(at, 1)
      list.splice(to, 0, item)
      return { ...board, blocks: list }
    })
  }

  function deleteBlock(blockId) {
    const idx = boardIndex()
    updateBoard(idx, (board) => ({ ...board, blocks: board.blocks.filter((b) => b.id !== blockId) }))
    setSelectedBlockId((s) => (s === blockId ? null : s))
  }

  function setBoardCols(cols) {
    const idx = boardIndex()
    const c = clampInt(cols, BOARD_COLS_MIN, BOARD_COLS_MAX, 4)
    updateBoard(idx, (board) => ({
      ...board, cols: c,
      blocks: board.blocks.map((b) => ({ ...b, w: Math.min(b.w, c) })),
    }))
  }

  function setBoardRows(rows) {
    const idx = boardIndex()
    const r = clampInt(rows, BOARD_ROWS_MIN, BOARD_ROWS_MAX, 3)
    updateBoard(idx, (board) => ({
      ...board, rows: r,
      blocks: board.blocks.map((b) => ({ ...b, h: Math.min(b.h, r) })),
    }))
  }

  function renameBoard(title) {
    const idx = boardIndex()
    updateBoard(idx, (board) => ({ ...board, title: String(title).slice(0, 60) }))
  }

  function addBoard() {
    if (boards.length >= MAX_BOARDS) {
      setMsg({ type: 'err', text: `You can have up to ${MAX_BOARDS} boards.` })
      return
    }
    const board = normalizeBoard({ title: `Board ${boards.length + 1}`, cols: 4, rows: 3, blocks: [] })
    setDraft((d) => ({ ...d, boards: [...d.boards, board] }))
    setActiveBoardIdx(boards.length)
    setSelectedBlockId(null)
    setMsg(null)
  }

  function deleteBoard() {
    if (boards.length <= 1) return
    const idx = boardIndex()
    setDraft((d) => ({ ...d, boards: d.boards.filter((_, i) => i !== idx) }))
    setActiveBoardIdx((i) => Math.max(0, Math.min(i, boards.length - 2)))
    setSelectedBlockId(null)
  }

  function applyStarter(starter) {
    if (!window.confirm('Replace the whole design with this starter layout? Your current boards will be lost.')) return
    const built = starter.build?.() || emptyLayout()
    const normalized = normalizeLayout(built) || emptyLayout()
    setDraft(normalized)
    setActiveBoardIdx(0)
    setSelectedBlockId(null)
    setMsg(null)
  }

  // ── Source change resets viz + block type (kpi vs chart) ────────────────────
  function changeSource(newSource) {
    if (!selectedBlock) return
    patchBlock(selectedBlock.id, { source: newSource, viz: defaultViz(newSource) })
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  async function save() {
    if (saving || busy) return
    setSaving(true); setMsg(null)
    try {
      const layout = normalizeLayout(draft)
      await updateReportShare(share.id, { layout })
      onSaved?.()
    } catch (err) {
      setMsg({ type: 'err', text: toUserMessage(err, 'Could not save the design.') })
    } finally {
      setSaving(false)
    }
  }

  async function clearLayout() {
    if (saving || busy) return
    if (!window.confirm('Use the fixed report pages instead of custom boards? Your custom design will be removed.')) return
    setBusy(true); setMsg(null)
    try {
      await updateReportShare(share.id, { layout: null })
      onSaved?.()
    } catch (err) {
      setMsg({ type: 'err', text: toUserMessage(err, 'Could not clear the design.') })
    } finally {
      setBusy(false)
    }
  }

  function copyLink() {
    if (!shareUrl || !navigator.clipboard?.writeText) return
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }).catch(() => {})
  }

  const disabled = saving || busy

  // Grouped source options for the source picker.
  const sourcesByGroup = useMemo(() => SOURCE_GROUPS.map((g) => ({
    group: g,
    items: SOURCES.filter((s) => s.group === g),
  })), [])

  const cols = activeBoard?.cols || 4
  const rows = activeBoard?.rows || 3

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/70 backdrop-blur-sm">
      <div className="w-[97vw] max-w-[1760px] h-[93vh] flex flex-col rounded-2xl bg-[var(--card-bg)] border border-[var(--input-border)] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--input-border)] shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <LayoutGrid size={15} className="text-[var(--accent)]" /> Design report boards
            </h2>
            <p className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">{share?.name || 'Shared report'}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {shareUrl && (
              <>
                <button type="button" onClick={copyLink} title="Copy link"
                  className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--accent)]">
                  {copied ? <Copy size={14} className="text-[var(--accent)]" /> : <Copy size={14} />}
                </button>
                <a href={shareUrl} target="_blank" rel="noopener noreferrer" title="Open report"
                  className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--accent)]">
                  <ExternalLink size={14} />
                </a>
              </>
            )}
            <button type="button" onClick={save} disabled={disabled}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white flex items-center gap-1.5 disabled:opacity-50 hover:opacity-90 transition-opacity">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
            </button>
            <button type="button" onClick={onClose} disabled={disabled} title="Close"
              className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50">
              <X size={16} />
            </button>
          </div>
        </div>

        {msg && (
          <div className={`mx-4 mt-3 text-sm rounded-lg px-3 py-2 flex items-center gap-2 shrink-0 ${msg.type === 'ok' ? 'bg-emerald-950/30 border border-emerald-800/40 text-emerald-300' : 'bg-red-900/25 border border-red-700/40 text-red-300'}`}>
            {msg.text}
          </div>
        )}

        {/* Body: controls (left) + preview (right) */}
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="flex flex-col lg:flex-row gap-4 p-4">
            {/* LEFT CONTROLS */}
            <div className="lg:w-[400px] shrink-0 space-y-4">
              {/* Board tabs */}
              <div>
                <div className="flex items-center flex-wrap gap-1.5 mb-2">
                  {boards.map((b, i) => (
                    <button key={b.id} type="button"
                      onClick={() => { setActiveBoardIdx(i); setSelectedBlockId(null) }}
                      className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${i === boardIndex() ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--input-border)] hover:border-[var(--accent)]'}`}>
                      {b.title || `Board ${i + 1}`}
                    </button>
                  ))}
                  {boards.length < MAX_BOARDS && (
                    <button type="button" onClick={addBoard}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:border-[var(--accent)] flex items-center gap-1">
                      <Plus size={12} /> Board
                    </button>
                  )}
                </div>

                {/* Active board settings */}
                <div className="rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <input value={activeBoard?.title || ''} onChange={(e) => renameBoard(e.target.value)}
                      placeholder="Board title"
                      className="flex-1 text-sm px-2.5 py-1.5 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]" />
                    {boards.length > 1 && (
                      <button type="button" onClick={deleteBoard} title="Delete this board"
                        className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-red-400">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Stepper label="Columns" value={cols} min={BOARD_COLS_MIN} max={BOARD_COLS_MAX} onChange={setBoardCols} />
                    <Stepper label="Rows" value={rows} min={BOARD_ROWS_MIN} max={BOARD_ROWS_MAX} onChange={setBoardRows} />
                  </div>
                </div>
              </div>

              {/* Add block palette */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Add block</p>
                <div className="flex flex-wrap gap-1.5">
                  {BLOCK_PRESETS.map((p) => (
                    <button key={p.id} type="button" onClick={() => addBlock(p.id)}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] flex items-center gap-1 transition-colors">
                      <Plus size={12} /> {p.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mt-3 mb-1.5">Start from</p>
                <div className="flex flex-wrap gap-1.5">
                  {STARTER_LAYOUTS.map((st) => (
                    <button key={st.id} type="button" onClick={() => applyStarter(st)}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:border-[var(--accent)] transition-colors">
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Block list for the active board */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">
                  Blocks on this board <span className="text-[var(--text-muted)] font-semibold">({activeBoard?.blocks.length || 0} of {MAX_BLOCKS_PER_BOARD})</span>
                </p>
                {(!activeBoard || activeBoard.blocks.length === 0) ? (
                  <div className="rounded-lg px-3 py-3 text-xs text-[var(--text-muted)] bg-[var(--input-bg)] border border-[var(--input-border)] text-center">
                    No blocks yet. Add one from the palette above.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {activeBoard.blocks.map((b, i) => (
                      <div key={b.id}
                        className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border transition-colors cursor-pointer ${selectedBlockId === b.id ? 'bg-[var(--card-bg)] border-[var(--accent)]' : 'bg-[var(--input-bg)] border-[var(--input-border)] hover:border-[var(--accent)]'}`}
                        onClick={() => setSelectedBlockId(b.id)}>
                        <span className="w-1.5 h-6 rounded-full shrink-0" style={{ background: ACCENT_SWATCHES[b.accent] || ACCENT_SWATCHES[0] }} />
                        <span className="flex-1 min-w-0 text-sm text-[var(--text-primary)] truncate">{blockLabel(b)}</span>
                        <span className="text-[10px] text-[var(--text-muted)] shrink-0">{Math.min(b.w, cols)}x{Math.min(b.h, rows)}</span>
                        <button type="button" title="Move up" disabled={i === 0}
                          onClick={(e) => { e.stopPropagation(); moveBlock(b.id, -1) }}
                          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent)] disabled:opacity-30">
                          <ChevronUp size={14} />
                        </button>
                        <button type="button" title="Move down" disabled={i === activeBoard.blocks.length - 1}
                          onClick={(e) => { e.stopPropagation(); moveBlock(b.id, 1) }}
                          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent)] disabled:opacity-30">
                          <ChevronDown size={14} />
                        </button>
                        <button type="button" title="Delete block"
                          onClick={(e) => { e.stopPropagation(); deleteBlock(b.id) }}
                          className="p-1 rounded text-[var(--text-muted)] hover:text-red-400">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Selected block editor */}
              {selectedBlock && (
                <div className="rounded-lg bg-[var(--input-bg)] border border-[var(--accent)] p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                      <Palette size={13} className="text-[var(--accent)]" /> Selected block
                    </p>
                    <button type="button" onClick={() => deleteBlock(selectedBlock.id)}
                      className="text-[11px] font-semibold px-2 py-1 rounded-md text-red-300 hover:text-red-200 flex items-center gap-1">
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>

                  {selectedBlock.type === 'text' ? (
                    <div>
                      <label className="text-[11px] font-semibold text-[var(--text-secondary)] block mb-1 flex items-center gap-1">
                        <Type size={11} /> Heading text
                      </label>
                      <input value={selectedBlock.text} onChange={(e) => patchBlock(selectedBlock.id, { text: e.target.value })}
                        placeholder="Heading"
                        className="w-full text-sm px-2.5 py-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]" />
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="text-[11px] font-semibold text-[var(--text-secondary)] block mb-1">Data source</label>
                        <select value={selectedBlock.source || ''} onChange={(e) => changeSource(e.target.value)}
                          className="w-full text-sm px-2.5 py-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]">
                          {sourcesByGroup.map((grp) => (
                            <optgroup key={grp.group} label={grp.group}>
                              {grp.items.map((s) => (
                                <option key={s.key} value={s.key}>{s.label}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </div>

                      {vizOptionsFor(selectedBlock.source).length > 1 && (
                        <div>
                          <label className="text-[11px] font-semibold text-[var(--text-secondary)] block mb-1">Chart style</label>
                          <select value={selectedBlock.viz || ''} onChange={(e) => patchBlock(selectedBlock.id, { viz: e.target.value })}
                            className="w-full text-sm px-2.5 py-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]">
                            {vizOptionsFor(selectedBlock.source).map((v) => (
                              <option key={v.key} value={v.key}>{v.label}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div>
                        <label className="text-[11px] font-semibold text-[var(--text-secondary)] block mb-1">Title</label>
                        <input value={selectedBlock.title} onChange={(e) => patchBlock(selectedBlock.id, { title: e.target.value })}
                          placeholder="Block title"
                          className="w-full text-sm px-2.5 py-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]" />
                        <label className="mt-1.5 flex items-center gap-2 text-[11px] text-[var(--text-secondary)] cursor-pointer">
                          <input type="checkbox" checked={selectedBlock.showTitle !== false}
                            onChange={(e) => patchBlock(selectedBlock.id, { showTitle: e.target.checked })}
                            className="accent-[var(--accent)]" />
                          Show title
                        </label>
                      </div>
                    </>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <Stepper label="Width" value={Math.min(selectedBlock.w, cols)} min={BLOCK_W_MIN} max={cols}
                      onChange={(v) => patchBlock(selectedBlock.id, { w: v })} />
                    <Stepper label="Height" value={Math.min(selectedBlock.h, rows)} min={BLOCK_H_MIN} max={rows}
                      onChange={(v) => patchBlock(selectedBlock.id, { h: v })} />
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-[var(--text-secondary)] block mb-1.5">Accent colour</label>
                    <div className="flex flex-wrap gap-1.5">
                      {ACCENT_SWATCHES.map((hex, i) => (
                        <button key={i} type="button" title={`Accent ${i + 1}`}
                          onClick={() => patchBlock(selectedBlock.id, { accent: i })}
                          className={`w-6 h-6 rounded-md border-2 transition-transform ${selectedBlock.accent === i ? 'border-white scale-110' : 'border-transparent'}`}
                          style={{ background: hex }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* RIGHT PREVIEW */}
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                  Live preview: {activeBoard?.title || 'Board'}
                </p>
                <button type="button" onClick={clearLayout} disabled={disabled}
                  className="text-[11px] font-semibold px-2 py-1 rounded-md bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:border-[var(--accent)] disabled:opacity-50 flex items-center gap-1">
                  {busy ? <Loader2 size={11} className="animate-spin" /> : null} Use fixed pages instead
                </button>
              </div>

              {needPassword && (
                <form onSubmit={submitPassword} className="rounded-lg px-3 py-2.5 bg-[var(--input-bg)] border border-[var(--input-border)] flex items-center gap-2">
                  <span className="text-xs text-[var(--text-secondary)] shrink-0">This report is password protected:</span>
                  <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password"
                    className="flex-1 text-sm px-2.5 py-1.5 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]" />
                  <button type="submit" disabled={pwChecking}
                    className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-[var(--accent)] text-white disabled:opacity-50">
                    {pwChecking ? <Loader2 size={12} className="animate-spin" /> : 'Load'}
                  </button>
                </form>
              )}
              {previewNote && (
                <p className="text-[11px] text-[var(--text-muted)]">
                  Live preview data is unavailable; layout still editable.
                </p>
              )}

              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${cols},1fr)`,
                gridTemplateRows: `repeat(${rows},1fr)`,
                gap: 10, height: 'min(72vh, 900px)', minHeight: 460,
                background: '#f1f5f9', padding: 12, borderRadius: 12,
              }}>
                {(!activeBoard || activeBoard.blocks.length === 0) ? (
                  <div style={{
                    gridColumn: '1 / -1', gridRow: '1 / -1',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#64748b', fontSize: 14, fontWeight: 600, textAlign: 'center',
                  }}>
                    Add blocks from the left to build this board.
                  </div>
                ) : activeBoard.blocks.map((block) => {
                  const selected = selectedBlockId === block.id
                  return (
                    <div key={block.id}
                      onClick={() => setSelectedBlockId(block.id)}
                      style={{
                        gridColumn: `span ${Math.min(block.w, cols)}`,
                        gridRow: `span ${Math.min(block.h, rows)}`,
                        minHeight: 0, minWidth: 0,
                        outline: selected ? '2px solid #6366f1' : 'none',
                        borderRadius: 14, cursor: 'pointer',
                      }}>
                      <ShareBlockView block={block} snapshot={snapshot || {}} />
                    </div>
                  )
                })}
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                The board fills exactly one screen. Rows and columns size every block, so it never scrolls on a TV.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Small integer stepper with minus / plus, matched to the dark theme. */
function Stepper({ label, value, min, max, onChange }) {
  const set = (v) => onChange(Math.min(max, Math.max(min, v)))
  return (
    <div>
      <label className="text-[11px] font-semibold text-[var(--text-secondary)] block mb-1">{label}</label>
      <div className="flex items-center rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] overflow-hidden">
        <button type="button" onClick={() => set(Number(value) - 1)} disabled={Number(value) <= min}
          className="px-2.5 py-1.5 text-[var(--text-secondary)] hover:text-[var(--accent)] disabled:opacity-30">
          -
        </button>
        <span className="flex-1 text-center text-sm font-semibold text-[var(--text-primary)] tabular-nums">{value}</span>
        <button type="button" onClick={() => set(Number(value) + 1)} disabled={Number(value) >= max}
          className="px-2.5 py-1.5 text-[var(--text-secondary)] hover:text-[var(--accent)] disabled:opacity-30">
          +
        </button>
      </div>
    </div>
  )
}
