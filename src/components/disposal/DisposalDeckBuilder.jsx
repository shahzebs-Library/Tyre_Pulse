/**
 * DisposalDeckBuilder - the deck designer for the Asset Disposal module.
 *
 * The owner asked for a downloadable PowerPoint of the scrap list, and asked for
 * it to be BUILT rather than a fixed export. This is that builder: pick the
 * slides, pick the cut of the data on each one, reorder them, save the layout by
 * name, and download the pack as .pptx or .pdf.
 *
 * WHAT THIS FILE OWNS: the interaction. Nothing else.
 *   - the block catalog, presets, filters and every number come from the pure
 *     engine (src/lib/assetDisposalDeck.js),
 *   - the .pptx and .pdf come from src/lib/assetDisposalDeckRender.js,
 *   - the preview renders the SAME resolved slide list the renderers walk, and
 *     hands its live chart canvases back through `chartImageFor`, so the slide
 *     the committee gets is the slide shown here.
 *
 * It fetches nothing: `rows` and `totals` arrive from the page.
 *
 * Two house rules that are easy to break here and expensive to debug:
 *   - use the shared <Modal>. A hand rolled `fixed inset-0` panel gets its own
 *     sizing and scroll bugs, and `.card` has overflow:hidden so anything opened
 *     inside one is clipped.
 *   - one chart per slide. A slide with four charts on it is unreadable in a
 *     meeting room, which this codebase has already fixed once.
 */
import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  ArcElement, LineElement, PointElement, Filler, Tooltip, Legend,
} from 'chart.js'
import {
  Plus, Trash2, ChevronUp, ChevronDown, Copy, Save, FolderOpen, X,
  FileText, Presentation, Settings2, LayoutTemplate, Loader2, Info,
  ChevronLeft, ChevronRight, AlertTriangle,
} from 'lucide-react'
import Modal from '../ui/Modal'
import {
  DECK_BLOCKS, DECK_BLOCK_KEYS, DECK_PRESETS, DECK_PRESET_KEYS,
  KPI_ITEMS, KPI_KEYS, CHART_SOURCES, CHART_SOURCE_KEYS, CHART_METRICS,
  CHART_METRIC_KEYS, CHART_VIZ, CHART_VIZ_KEYS, TABLE_COLUMNS, TABLE_COLUMN_KEYS,
  TYRE_COLUMNS, TYRE_COLUMN_KEYS, ROW_FILTERS, SORTS,
  RELIABILITY_KPI_ITEMS, RELIABILITY_KPI_KEYS, RELIABILITY_COLUMNS,
  RELIABILITY_COLUMN_KEYS, RANKABLE_METRICS, RECOMMENDATION_PRIORITIES,
  NOT_MEASURED,
  makeBlock, normalizeDeckConfig, buildDeck, presetConfig,
  loadDeckLayout, saveDeckLayout, listSavedDecks, saveNamedDeck, deleteNamedDeck,
} from '../../lib/assetDisposalDeck'
import { renderDisposalDeckPptx, renderDisposalDeckPdf, slideChartConfig, PRIORITY_LABEL } from '../../lib/assetDisposalDeckRender'
import { captureChartOnPaper } from '../../lib/chartCapture'
import { toUserMessage } from '../../lib/safeError'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, LineElement, PointElement, Filler, Tooltip, Legend)

const BLOCK_ICON_TONE = 'var(--text-secondary)'

// ── Small building blocks (kept local: this is presentation, not logic) ──────
function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>{label}</span>
      {children}
      {hint && <span className="block text-[11px] mt-1" style={{ color: 'var(--text-dim)' }}>{hint}</span>}
    </label>
  )
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-1 w-full rounded-lg px-2 py-1.5 text-sm border"
      style={{ background: 'var(--surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function TextInput({ value, onChange, placeholder }) {
  return (
    <input
      type="text" value={value || ''} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="mt-1 w-full rounded-lg px-2 py-1.5 text-sm border"
      style={{ background: 'var(--surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
    />
  )
}

function CheckList({ all, labelOf, selected, onToggle }) {
  return (
    <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border p-2 space-y-1" style={{ borderColor: 'var(--border-subtle)' }}>
      {all.map((k) => (
        <label key={k} className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={selected.includes(k)} onChange={() => onToggle(k)} />
          <span className="truncate">{labelOf(k)}</span>
        </label>
      ))}
    </div>
  )
}

const toggleIn = (arr, k) => (arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k])

// ── Slide preview (WYSIWYG: this is what the renderers draw) ─────────────────
const PAPER = {
  bg: '#ffffff', ink: '#0f172a', subtle: '#475569', muted: '#94a3b8',
  border: '#e2e8f0', accent: '#4f46e5', warn: '#b45309', head: '#1e293b', zebra: '#f8fafc',
  good: '#15803d', watch: '#b45309', bad: '#b91c1c',
}
const PRIORITY_COLOR = { high: PAPER.bad, medium: PAPER.warn, low: PAPER.subtle }
const isUnmeasured = (v) => String(v) === NOT_MEASURED
/** Preview tone for one table cell, mirroring cellTone() in the renderers. */
const previewCellColor = (cell, band) => {
  if (cell === 'NOT IN REGISTER') return PAPER.warn
  if (isUnmeasured(cell)) return PAPER.muted
  if (band && PAPER[band]) return PAPER[band]
  return PAPER.subtle
}

function SlidePreview({ slide, deck, registerChart }) {
  if (!slide) return null

  const head = (title, sub) => (
    <div style={{ borderBottom: `2px solid ${PAPER.accent}`, paddingBottom: 6, marginBottom: 10 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: PAPER.ink, textTransform: 'uppercase', letterSpacing: 0.3 }}>{title}</div>
      {sub && <div style={{ fontSize: 10, color: PAPER.subtle, marginTop: 2 }}>{sub}</div>}
    </div>
  )
  const empty = (text) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '70%', color: PAPER.muted, fontStyle: 'italic', fontSize: 12, textAlign: 'center', padding: '0 12%' }}>
      {text}
    </div>
  )

  if (slide.kind === 'title') {
    return (
      <div style={{ height: '100%', display: 'flex' }}>
        <div style={{ width: 8, background: PAPER.accent }} />
        <div style={{ width: '32%', background: '#f1f4fb' }} />
        <div style={{ position: 'absolute', left: '5%', top: '22%', right: '5%' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: PAPER.accent, letterSpacing: 2 }}>{String(deck.company || '').toUpperCase()}</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: PAPER.ink, marginTop: 10, lineHeight: 1.15 }}>{slide.title}</div>
          {(slide.subtitle || deck.country) && (
            <div style={{ fontSize: 13, color: PAPER.subtle, marginTop: 12 }}>{[slide.subtitle, deck.country].filter(Boolean).join('  |  ')}</div>
          )}
          <div style={{ fontSize: 11, color: PAPER.subtle, marginTop: 8 }}>{slide.assetCount} assets proposed for disposal</div>
          {deck.unvaluedCount > 0 && (
            <div style={{ fontSize: 10, color: PAPER.warn, marginTop: 16, fontStyle: 'italic' }}>
              {deck.unvaluedCount >= deck.assetCount
                ? 'No asset on this list has been valued. No recovery figure can be quoted.'
                : `${deck.unvaluedCount} of ${deck.assetCount} assets have not been valued.`}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (slide.kind === 'kpis') {
    const items = slide.items.slice(0, 9)
    const perRow = items.length <= 4 ? Math.max(1, items.length) : 3
    const notes = Array.isArray(slide.notes) ? slide.notes.filter(Boolean) : []
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {head(slide.title)}
        {slide.empty || !items.length ? empty(slide.emptyNote) : (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${perRow}, 1fr)`, gap: 8 }}>
            {items.map((k) => {
              const soft = k.unmeasured || isUnmeasured(k.value)
              return (
                <div key={k.key} style={{ border: `1px solid ${PAPER.border}`, borderTop: `3px solid ${soft ? PAPER.muted : (k.valuation ? PAPER.warn : PAPER.accent)}`, borderRadius: 4, padding: 8 }}>
                  <div style={{ fontSize: 8, fontWeight: 700, color: PAPER.muted, letterSpacing: 0.6 }}>{k.label.toUpperCase()}</div>
                  <div style={{ fontSize: k.valuation || soft ? 15 : 20, fontWeight: 800, color: soft ? PAPER.muted : (k.valuation ? PAPER.warn : PAPER.ink), marginTop: 4 }}>{k.value}</div>
                  {k.note && <div style={{ fontSize: 7.5, color: PAPER.subtle, marginTop: 4, lineHeight: 1.3 }}>{k.note}</div>}
                </div>
              )
            })}
          </div>
        )}
        {notes.length > 0 && (
          <div style={{ marginTop: 'auto', paddingTop: 6, fontSize: 7.5, color: PAPER.warn, fontStyle: 'italic', lineHeight: 1.35 }}>
            {notes.join('  ')}
          </div>
        )}
      </div>
    )
  }

  if (slide.kind === 'recommendations') {
    return (
      <div style={{ height: '100%', overflow: 'hidden' }}>
        {head(slide.title, `${slide.count} recommendation${slide.count === 1 ? '' : 's'}, each one carrying the figures it rests on`)}
        {slide.empty ? empty(slide.emptyNote) : slide.groups.map((g) => (
          <div key={g.priority} style={{ marginBottom: 8 }}>
            <span style={{ display: 'inline-block', background: PRIORITY_COLOR[g.priority] || PAPER.subtle, color: '#fff', fontSize: 7, fontWeight: 700, letterSpacing: 0.8, padding: '2px 6px', borderRadius: 3 }}>
              {PRIORITY_LABEL[g.priority] || g.priority.toUpperCase()}
            </span>
            {g.items.map((it, i) => (
              <div key={i} style={{ marginTop: 5 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: PAPER.ink, lineHeight: 1.3 }}>{it.title}</div>
                {slide.showEvidence && it.evidence && (
                  <div style={{ fontSize: 8.5, color: PAPER.subtle, marginTop: 2, marginLeft: 8, lineHeight: 1.35 }}>{it.evidence}</div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  if (slide.kind === 'comparison') {
    return (
      <div style={{ height: '100%', overflow: 'hidden' }}>
        {head(slide.title, slide.country ? `Country: ${slide.country}` : '')}
        {slide.headlines.map((h, i) => (
          <div key={i} style={{ borderLeft: `3px solid ${h.tone === 'limit' ? PAPER.warn : PAPER.accent}`, paddingLeft: 8, marginBottom: 7, fontSize: 10, color: PAPER.ink, lineHeight: 1.4 }}>
            {h.text}
          </div>
        ))}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 8.5, marginTop: 4 }}>
          <thead>
            <tr>{['Measure', slide.onLabel, slide.restLabel, 'Ratio'].map((h, i) => (
              <th key={h} style={{ background: PAPER.head, color: '#fff', padding: '3px 4px', textAlign: i ? 'right' : 'left', border: `1px solid ${PAPER.border}` }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {slide.metrics.map((m) => {
              const color = m.confounded ? PAPER.muted : (m.trust ? PAPER.ink : PAPER.subtle)
              return (
                <tr key={m.key}>
                  <td style={{ padding: '2px 4px', border: `1px solid ${PAPER.border}`, color, fontWeight: m.trust ? 700 : 400 }}>
                    {m.label}{m.trust ? ' (read this one)' : (m.confounded ? ' (confounded)' : '')}
                  </td>
                  <td style={{ padding: '2px 4px', border: `1px solid ${PAPER.border}`, color, textAlign: 'right', fontWeight: m.trust ? 700 : 400 }}>{m.onList}</td>
                  <td style={{ padding: '2px 4px', border: `1px solid ${PAPER.border}`, color, textAlign: 'right' }}>{m.rest}</td>
                  <td style={{ padding: '2px 4px', border: `1px solid ${PAPER.border}`, color: m.trust ? PAPER.warn : PAPER.subtle, textAlign: 'right', fontWeight: m.trust ? 700 : 400 }}>{m.ratio}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {slide.confound && (
          <div style={{ marginTop: 8, padding: 6, background: '#fff7ed', border: `1px solid ${PAPER.warn}`, borderRadius: 3, fontSize: 8, color: PAPER.warn, fontStyle: 'italic', lineHeight: 1.4 }}>
            {slide.confound}
          </div>
        )}
      </div>
    )
  }

  if (slide.kind === 'findings') {
    return (
      <div style={{ height: '100%' }}>
        {head(slide.title)}
        {slide.empty ? empty(slide.emptyNote) : (
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {slide.bullets.map((b, i) => (
              <li key={i} style={{ fontSize: 11.5, color: PAPER.subtle, marginBottom: 7, lineHeight: 1.4 }}>{b}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  if (slide.kind === 'chart') {
    const cfg = slideChartConfig(slide, { paper: true, fontScale: 1 })
    const C = slide.viz === 'doughnut' ? Doughnut : slide.viz === 'line' ? Line : Bar
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {head(slide.title, slide.note)}
        {slide.empty ? empty(slide.emptyNote) : (
          <>
            <div style={{ flex: 1, minHeight: 0 }}>
              <C
                data={cfg.data}
                options={cfg.options}
                ref={(inst) => registerChart(slide.id, inst)}
              />
            </div>
            {slide.digest && <div style={{ fontSize: 9, color: PAPER.subtle, marginTop: 6 }}>{slide.digest}</div>}
          </>
        )}
      </div>
    )
  }

  if (slide.kind === 'table') {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {head(slide.title)}
        {slide.empty ? empty(slide.emptyNote) : (
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: slide.density === 'compact' ? 7.5 : 8.5 }}>
              <thead>
                <tr>
                  {slide.columns.map((c) => (
                    <th key={c.key} style={{ background: PAPER.head, color: '#fff', padding: '3px 4px', textAlign: c.align === 'right' ? 'right' : 'left', border: `1px solid ${PAPER.border}` }}>{c.header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slide.rows.map((r, ri) => (
                  <tr key={ri} style={{ background: ri % 2 ? PAPER.zebra : '#fff' }}>
                    {r.map((cell, ci) => {
                      const band = slide.cellBands?.[ri]?.[ci]
                      return (
                        <td key={ci} style={{
                          padding: '2px 4px', border: `1px solid ${PAPER.border}`,
                          textAlign: slide.columns[ci]?.align === 'right' ? 'right' : 'left',
                          color: previewCellColor(cell, band),
                          fontWeight: cell === 'NOT IN REGISTER' || band === 'bad' ? 700 : 400,
                          fontStyle: isUnmeasured(cell) ? 'italic' : 'normal',
                        }}>{cell}</td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {Array.isArray(slide.notes) && slide.notes.filter(Boolean).length > 0 && (
          <div style={{ fontSize: 7.5, color: PAPER.warn, fontStyle: 'italic', marginTop: 5, lineHeight: 1.35 }}>
            {slide.notes.filter(Boolean).join('  ')}
          </div>
        )}
        <div style={{ fontSize: 8, color: PAPER.muted, marginTop: 5 }}>{slide.caption}</div>
      </div>
    )
  }

  if (slide.kind === 'asset') {
    const half = Math.ceil(slide.facts.length / 2)
    const cols = [slide.facts.slice(0, half), slide.facts.slice(half)]
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {head(slide.title, slide.subtitle)}
        {slide.flags.length > 0 && (
          <div style={{ fontSize: 10, fontWeight: 700, color: PAPER.warn, marginBottom: 6 }}>{slide.flags.join('   |   ')}</div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {cols.map((group, gi) => (
            <div key={gi}>
              {group.map((f) => (
                <div key={f.label} style={{ display: 'flex', fontSize: 9, marginBottom: 2 }}>
                  <span style={{ width: '44%', color: PAPER.muted }}>{f.label}</span>
                  <span style={{ flex: 1, fontWeight: 700, color: f.value === 'Not valued' ? PAPER.warn : PAPER.ink }}>{f.value}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        {Array.isArray(slide.reliability) && slide.reliability.length > 0 ? (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 8, fontWeight: 700, color: PAPER.muted, letterSpacing: 0.6 }}>RELIABILITY RECORD</div>
            <div style={{ fontSize: 9, color: PAPER.ink, marginTop: 3, lineHeight: 1.5 }}>
              {slide.reliability.map((f, i) => (
                <span key={f.label}>
                  <span style={{ color: PAPER.muted }}>{f.label}: </span>
                  <span style={{ fontWeight: isUnmeasured(f.value) ? 400 : 700, color: isUnmeasured(f.value) ? PAPER.muted : PAPER.ink, fontStyle: isUnmeasured(f.value) ? 'italic' : 'normal' }}>{f.value}</span>
                  {i < slide.reliability.length - 1 && <span style={{ color: PAPER.border }}>{'   |   '}</span>}
                </span>
              ))}
            </div>
            {Array.isArray(slide.reliabilityNotes) && slide.reliabilityNotes.filter(Boolean).length > 0 && (
              <div style={{ fontSize: 7.5, color: PAPER.warn, fontStyle: 'italic', marginTop: 3, lineHeight: 1.35 }}>
                {slide.reliabilityNotes.filter(Boolean).join('  ')}
              </div>
            )}
          </div>
        ) : slide.reliabilityNote ? (
          <div style={{ marginTop: 8, fontSize: 9, fontStyle: 'italic', color: PAPER.muted }}>{slide.reliabilityNote}</div>
        ) : null}
        {slide.remarks.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 8, fontWeight: 700, color: PAPER.muted, letterSpacing: 0.6 }}>COMMITTEE REMARKS</div>
            <ul style={{ margin: '4px 0 0', paddingLeft: 14 }}>
              {slide.remarks.map((r, i) => <li key={i} style={{ fontSize: 9, color: PAPER.subtle, lineHeight: 1.35 }}>{r}</li>)}
            </ul>
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          {slide.tyres.length > 0 ? (
            <>
              <div style={{ fontSize: 8, fontWeight: 700, color: PAPER.muted, letterSpacing: 0.6 }}>TYRES STILL FITTED ({slide.tyres.length})</div>
              <table style={{ width: '72%', borderCollapse: 'collapse', fontSize: 8, marginTop: 3 }}>
                <thead>
                  <tr>{['Serial', 'Position', 'Brand', 'Size', 'Km'].map((h) => (
                    <th key={h} style={{ background: PAPER.head, color: '#fff', padding: '2px 3px', textAlign: 'left', border: `1px solid ${PAPER.border}` }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {slide.tyres.slice(0, 6).map((t, i) => (
                    <tr key={i}>
                      {[t.serial, t.position, t.brand, t.size, t.km].map((v, j) => (
                        <td key={j} style={{ padding: '1px 3px', border: `1px solid ${PAPER.border}`, color: PAPER.subtle }}>{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div style={{ fontSize: 9, fontStyle: 'italic', color: PAPER.muted }}>{slide.tyreNote}</div>
          )}
        </div>
      </div>
    )
  }

  if (slide.kind === 'divider') {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: PAPER.subtle, letterSpacing: 2 }}>{String(slide.label).toUpperCase()}</div>
        <div style={{ flex: 1, height: 1, background: PAPER.border }} />
      </div>
    )
  }

  // text
  return (
    <div style={{ height: '100%' }}>
      {head(slide.title)}
      <div style={{ fontSize: 11.5, color: PAPER.subtle, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{slide.body}</div>
    </div>
  )
}

// ── Block settings panel ─────────────────────────────────────────────────────
function BlockSettings({ block, onPatch }) {
  if (!block) {
    return <p className="text-xs" style={{ color: 'var(--text-dim)' }}>Select a slide on the left to change what it shows.</p>
  }
  const set = (patch) => onPatch(patch)
  const def = DECK_BLOCKS[block.type]
  const filterOpts = ROW_FILTERS.map((f) => ({ value: f.key, label: f.label }))
  const sortOpts = SORTS.map((s) => ({ value: s.key, label: s.label }))

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{def?.label || block.type}</p>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-dim)' }}>{def?.description}</p>
      </div>

      {block.type === 'title' && (
        <>
          <Field label="Title"><TextInput value={block.title} onChange={(v) => set({ title: v })} /></Field>
          <Field label="Subtitle"><TextInput value={block.subtitle} onChange={(v) => set({ subtitle: v })} placeholder="For disposal committee approval" /></Field>
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={block.showDate !== false} onChange={(e) => set({ showDate: e.target.checked })} />
            Show the date the deck was prepared
          </label>
        </>
      )}

      {block.type === 'summary_kpis' && (
        <>
          <Field label="Slide title"><TextInput value={block.title} onChange={(v) => set({ title: v })} /></Field>
          <Field label="Numbers to show" hint="Up to 9. Valuation tiles print Not valued until the list is valued.">
            <CheckList
              all={KPI_KEYS} labelOf={(k) => KPI_ITEMS[k].label}
              selected={block.items}
              onToggle={(k) => set({ items: toggleIn(block.items, k).slice(0, 9) })}
            />
          </Field>
        </>
      )}

      {block.type === 'findings' && (
        <Field label="Slide title"><TextInput value={block.title} onChange={(v) => set({ title: v })} /></Field>
      )}

      {block.type === 'chart' && (
        <>
          <Field label="Title" hint="Leave blank to use the cut's own name.">
            <TextInput value={block.title} onChange={(v) => set({ title: v })} />
          </Field>
          <Field label="Cut">
            <Select value={block.source} onChange={(v) => set({ source: v })} options={CHART_SOURCE_KEYS.map((k) => ({ value: k, label: CHART_SOURCES[k].label }))} />
          </Field>
          <Field label="Measure">
            <Select value={block.metric} onChange={(v) => set({ metric: v })} options={CHART_METRIC_KEYS.map((k) => ({ value: k, label: CHART_METRICS[k].label }))} />
          </Field>
          <Field label="Chart type">
            <Select value={block.viz} onChange={(v) => set({ viz: v })} options={CHART_VIZ_KEYS.map((k) => ({ value: k, label: CHART_VIZ[k].label }))} />
          </Field>
          <Field label="Assets included">
            <Select value={block.filter} onChange={(v) => set({ filter: v })} options={filterOpts} />
          </Field>
        </>
      )}

      {block.type === 'table' && (
        <>
          <Field label="Slide title"><TextInput value={block.title} onChange={(v) => set({ title: v })} /></Field>
          <Field label="Assets included"><Select value={block.filter} onChange={(v) => set({ filter: v })} options={filterOpts} /></Field>
          <Field label="Order by"><Select value={block.sort} onChange={(v) => set({ sort: v })} options={sortOpts} /></Field>
          <Field label="Density"><Select value={block.density} onChange={(v) => set({ density: v })} options={[{ value: 'normal', label: 'Normal' }, { value: 'compact', label: 'Compact' }]} /></Field>
          <Field label="Rows per slide">
            <Select value={String(block.rowsPerSlide)} onChange={(v) => set({ rowsPerSlide: Number(v) })} options={[8, 10, 12, 14, 16, 18, 20].map((n) => ({ value: String(n), label: `${n} rows` }))} />
          </Field>
          <Field label="Limit" hint="0 shows every matching asset.">
            <Select value={String(block.limit)} onChange={(v) => set({ limit: Number(v) })} options={[0, 5, 10, 20, 50].map((n) => ({ value: String(n), label: n === 0 ? 'No limit' : `Top ${n}` }))} />
          </Field>
          <Field label="Columns">
            <CheckList all={TABLE_COLUMN_KEYS} labelOf={(k) => TABLE_COLUMNS[k].header} selected={block.columns} onToggle={(k) => set({ columns: toggleIn(block.columns, k) })} />
          </Field>
        </>
      )}

      {block.type === 'asset_detail' && (
        <>
          <Field label="Title prefix" hint="Leave blank to use the asset number alone.">
            <TextInput value={block.title} onChange={(v) => set({ title: v })} />
          </Field>
          <Field label="Assets included" hint="One slide is produced per matching asset.">
            <Select value={block.filter} onChange={(v) => set({ filter: v })} options={filterOpts} />
          </Field>
          <Field label="Order by"><Select value={block.sort} onChange={(v) => set({ sort: v })} options={sortOpts} /></Field>
          <Field label="Limit"><Select value={String(block.limit)} onChange={(v) => set({ limit: Number(v) })} options={[0, 5, 10, 20, 50].map((n) => ({ value: String(n), label: n === 0 ? 'Every asset' : `First ${n}` }))} /></Field>
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={block.showRemarks !== false} onChange={(e) => set({ showRemarks: e.target.checked })} />
            Show the committee remarks
          </label>
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={block.showTyres !== false} onChange={(e) => set({ showTyres: e.target.checked })} />
            Show the tyres still fitted
          </label>
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={block.showReliability !== false} onChange={(e) => set({ showReliability: e.target.checked })} />
            Show its reliability record
          </label>
        </>
      )}

      {block.type === 'reliability_kpis' && (
        <>
          <Field label="Slide title"><TextInput value={block.title} onChange={(v) => set({ title: v })} /></Field>
          <Field label="Assets included"><Select value={block.filter} onChange={(v) => set({ filter: v })} options={filterOpts} /></Field>
          <Field label="Numbers to show" hint="Up to 9. Anything the history cannot support prints Not measured.">
            <CheckList
              all={RELIABILITY_KPI_KEYS} labelOf={(k) => RELIABILITY_KPI_ITEMS[k].label}
              selected={block.items}
              onToggle={(k) => set({ items: toggleIn(block.items, k).slice(0, 9) })}
            />
          </Field>
        </>
      )}

      {block.type === 'reliability_table' && (
        <>
          <Field label="Slide title"><TextInput value={block.title} onChange={(v) => set({ title: v })} /></Field>
          <Field label="Assets included"><Select value={block.filter} onChange={(v) => set({ filter: v })} options={filterOpts} /></Field>
          <Field label="Worst first by" hint="Machines with no figure sink to the bottom rather than sorting as zero.">
            <Select value={block.sort} onChange={(v) => set({ sort: v })} options={RELIABILITY_COLUMN_KEYS.map((k) => ({ value: k, label: RELIABILITY_COLUMNS[k].header }))} />
          </Field>
          <Field label="Density"><Select value={block.density} onChange={(v) => set({ density: v })} options={[{ value: 'normal', label: 'Normal' }, { value: 'compact', label: 'Compact' }]} /></Field>
          <Field label="Rows per slide">
            <Select value={String(block.rowsPerSlide)} onChange={(v) => set({ rowsPerSlide: Number(v) })} options={[8, 10, 12, 14, 16, 18, 20].map((n) => ({ value: String(n), label: `${n} rows` }))} />
          </Field>
          <Field label="Limit" hint="0 shows every matching machine.">
            <Select value={String(block.limit)} onChange={(v) => set({ limit: Number(v) })} options={[0, 5, 10, 20, 50].map((n) => ({ value: String(n), label: n === 0 ? 'No limit' : `Top ${n}` }))} />
          </Field>
          <Field label="Columns">
            <CheckList all={RELIABILITY_COLUMN_KEYS} labelOf={(k) => RELIABILITY_COLUMNS[k].header} selected={block.columns} onToggle={(k) => set({ columns: toggleIn(block.columns, k) })} />
          </Field>
        </>
      )}

      {block.type === 'worst_offenders' && (
        <>
          <Field label="Title" hint="Leave blank to name the measure automatically.">
            <TextInput value={block.title} onChange={(v) => set({ title: v })} />
          </Field>
          <Field label="Measure" hint="Only measures where one end of the scale is a verdict can be ranked.">
            <Select value={block.metric} onChange={(v) => set({ metric: v })} options={RANKABLE_METRICS.map((k) => ({ value: k, label: RELIABILITY_COLUMNS[k].header }))} />
          </Field>
          <Field label="How many"><Select value={String(block.limit)} onChange={(v) => set({ limit: Number(v) })} options={[5, 8, 10, 12, 15, 20].map((n) => ({ value: String(n), label: `Worst ${n}` }))} /></Field>
          <Field label="Assets included"><Select value={block.filter} onChange={(v) => set({ filter: v })} options={filterOpts} /></Field>
        </>
      )}

      {block.type === 'spend_trend' && (
        <>
          <Field label="Title"><TextInput value={block.title} onChange={(v) => set({ title: v })} /></Field>
          <Field label="Show" hint="Per machine puts the latest full year in its own column.">
            <Select value={block.scope} onChange={(v) => set({ scope: v })} options={[{ value: 'fleet', label: 'The whole list, year by year' }, { value: 'per_asset', label: 'Machine by machine' }]} />
          </Field>
          <Field label="Years shown"><Select value={String(block.years)} onChange={(v) => set({ years: Number(v) })} options={[0, 4, 6, 8, 10].map((n) => ({ value: String(n), label: n === 0 ? 'Every year on record' : `Last ${n} years` }))} /></Field>
          {block.scope === 'fleet' && (
            <Field label="Chart type"><Select value={block.viz} onChange={(v) => set({ viz: v })} options={[{ value: 'bar', label: 'Column' }, { value: 'line', label: 'Line' }]} /></Field>
          )}
          {block.scope === 'per_asset' && (
            <Field label="Machines shown"><Select value={String(block.limit)} onChange={(v) => set({ limit: Number(v) })} options={[0, 10, 12, 14, 20].map((n) => ({ value: String(n), label: n === 0 ? 'Every machine' : `Top ${n}` }))} /></Field>
          )}
          <Field label="Assets included"><Select value={block.filter} onChange={(v) => set({ filter: v })} options={filterOpts} /></Field>
        </>
      )}

      {block.type === 'maintenance_mix' && (
        <>
          <Field label="Title"><TextInput value={block.title} onChange={(v) => set({ title: v })} /></Field>
          <Field label="Show">
            <Select value={block.scope} onChange={(v) => set({ scope: v })} options={[{ value: 'fleet', label: 'The whole list' }, { value: 'per_asset', label: 'Machine by machine' }]} />
          </Field>
          {block.scope === 'fleet' && (
            <Field label="Chart type"><Select value={block.viz} onChange={(v) => set({ viz: v })} options={[{ value: 'doughnut', label: 'Doughnut' }, { value: 'bar', label: 'Column' }, { value: 'bar_h', label: 'Bar' }]} /></Field>
          )}
          {block.scope === 'per_asset' && (
            <Field label="Machines shown"><Select value={String(block.limit)} onChange={(v) => set({ limit: Number(v) })} options={[0, 10, 14, 20].map((n) => ({ value: String(n), label: n === 0 ? 'Every machine' : `Lowest ${n}` }))} /></Field>
          )}
          <Field label="Assets included"><Select value={block.filter} onChange={(v) => set({ filter: v })} options={filterOpts} /></Field>
        </>
      )}

      {block.type === 'fleet_comparison' && (
        <>
          <Field label="Slide title"><TextInput value={block.title} onChange={(v) => set({ title: v })} /></Field>
          <p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
            Compares this list against the machines staying in service. It needs the fleet baseline from the page; without it the slide says so rather than guessing.
          </p>
        </>
      )}

      {block.type === 'recommendations' && (
        <>
          <Field label="Slide title"><TextInput value={block.title} onChange={(v) => set({ title: v })} /></Field>
          <Field label="Priorities to show">
            <CheckList
              all={RECOMMENDATION_PRIORITIES}
              labelOf={(k) => PRIORITY_LABEL[k] || k}
              selected={block.priorities}
              onToggle={(k) => set({ priorities: toggleIn(block.priorities, k) })}
            />
          </Field>
          <Field label="Limit"><Select value={String(block.limit)} onChange={(v) => set({ limit: Number(v) })} options={[0, 4, 6, 8, 12].map((n) => ({ value: String(n), label: n === 0 ? 'All of them' : `First ${n}` }))} /></Field>
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={block.showEvidence !== false} onChange={(e) => set({ showEvidence: e.target.checked })} />
            Show the figures each one rests on
          </label>
        </>
      )}

      {block.type === 'basis' && (
        <>
          <Field label="Slide title"><TextInput value={block.title} onChange={(v) => set({ title: v })} /></Field>
          <p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
            States the parked job card exclusion and the job card date coverage, both read from this list. Every reliability slide rests on them.
          </p>
        </>
      )}

      {block.type === 'tyre_recovery' && (
        <>
          <Field label="Slide title"><TextInput value={block.title} onChange={(v) => set({ title: v })} /></Field>
          <Field label="Assets included"><Select value={block.filter} onChange={(v) => set({ filter: v })} options={filterOpts} /></Field>
          <Field label="Rows per slide">
            <Select value={String(block.rowsPerSlide)} onChange={(v) => set({ rowsPerSlide: Number(v) })} options={[10, 12, 14, 16, 18, 20].map((n) => ({ value: String(n), label: `${n} rows` }))} />
          </Field>
          <Field label="Columns">
            <CheckList all={TYRE_COLUMN_KEYS} labelOf={(k) => TYRE_COLUMNS[k].header} selected={block.columns} onToggle={(k) => set({ columns: toggleIn(block.columns, k) })} />
          </Field>
        </>
      )}

      {block.type === 'text' && (
        <>
          <Field label="Slide title"><TextInput value={block.title} onChange={(v) => set({ title: v })} /></Field>
          <Field label="Body">
            <textarea
              value={block.body || ''} rows={7}
              onChange={(e) => set({ body: e.target.value })}
              className="mt-1 w-full rounded-lg px-2 py-1.5 text-sm border"
              style={{ background: 'var(--surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              placeholder="What the committee is being asked to approve."
            />
          </Field>
        </>
      )}

      {block.type === 'divider' && (
        <Field label="Section label"><TextInput value={block.label} onChange={(v) => set({ label: v })} /></Field>
      )}
    </div>
  )
}

// ── The builder ──────────────────────────────────────────────────────────────
export default function DisposalDeckBuilder({
  rows = [], totals = null, country = '', company = 'TyrePulse',
  // Optional. The page supplies the fleet baseline (this list against the
  // machines staying in service). Every other block renders unchanged without it.
  fleetBaseline = null,
  onClose,
}) {
  const [config, setConfig] = useState(() => loadDeckLayout())
  const [selectedId, setSelectedId] = useState(null)
  const [slideIdx, setSlideIdx] = useState(0)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [saved, setSaved] = useState(() => listSavedDecks())
  const [saveName, setSaveName] = useState('')
  const chartRefs = useRef(new Map())

  const currency = useMemo(() => {
    const r = (rows || []).find((x) => x && x.currency)
    return (r && r.currency) || 'SAR'
  }, [rows])

  // Persist the working layout so the builder reopens where the owner left it.
  useEffect(() => { saveDeckLayout(config) }, [config])

  const deck = useMemo(
    () => buildDeck(config, { rows, totals, currency, company, country, fleetBaseline }),
    [config, rows, totals, currency, company, country, fleetBaseline],
  )

  // Keep the visible slide in range when blocks change.
  useEffect(() => {
    setSlideIdx((i) => Math.max(0, Math.min(i, deck.slides.length - 1)))
  }, [deck.slides.length])

  const registerChart = useCallback((id, inst) => {
    if (inst) chartRefs.current.set(id, inst)
    else chartRefs.current.delete(id)
  }, [])

  const setBlocks = (fn) => setConfig((c) => normalizeDeckConfig({ ...c, blocks: fn(c.blocks) }))
  const patchBlock = (id, patch) => setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  const addBlock = (type) => {
    const b = makeBlock(type)
    setBlocks((bs) => [...bs, b])
    setSelectedId(b.id)
    setShowAdd(false)
  }
  const removeBlock = (id) => {
    setBlocks((bs) => bs.filter((b) => b.id !== id))
    setSelectedId((s) => (s === id ? null : s))
  }
  const duplicateBlock = (id) => setBlocks((bs) => {
    const i = bs.findIndex((b) => b.id === id)
    if (i < 0) return bs
    // Keep every setting, take a fresh id: two blocks sharing an id would make
    // the rail select and the settings panel edit the wrong one.
    const copy = { ...bs[i], id: makeBlock(bs[i].type).id }
    const next = [...bs]
    next.splice(i + 1, 0, copy)
    return next
  })
  const moveBlock = (id, dir) => setBlocks((bs) => {
    const i = bs.findIndex((b) => b.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= bs.length) return bs
    const next = [...bs]
    const [x] = next.splice(i, 1)
    next.splice(j, 0, x)
    return next
  })

  const selected = config.blocks.find((b) => b.id === selectedId) || null

  /**
   * WYSIWYG bridge: hand the renderers the PNG of the live preview canvas,
   * captured on WHITE at print scale. A chart that is not currently mounted
   * (the preview shows one slide at a time) returns null and the renderer falls
   * back to its own offscreen render, then to a native chart, then to the
   * figures as a table.
   */
  const chartImageFor = useCallback((slide) => {
    const inst = chartRefs.current.get(slide?.id)
    if (!inst) return null
    return captureChartOnPaper(inst, { widthPt: 640, aspect: 0.5 })
  }, [])

  const download = async (kind) => {
    setError(''); setNotice(''); setBusy(kind)
    try {
      const args = { deck, company, country, chartImageFor, save: true }
      const res = kind === 'pptx' ? await renderDisposalDeckPptx(args) : await renderDisposalDeckPdf(args)
      setNotice(`Downloaded ${res.filename}`)
    } catch (e) {
      setError(toUserMessage(e, 'The deck could not be produced.'))
    } finally {
      setBusy('')
    }
  }

  const applyPreset = (key) => {
    setConfig(presetConfig(key, { currency }))
    setSelectedId(null)
    setSlideIdx(0)
    setShowLibrary(false)
  }

  const doSaveNamed = () => {
    const name = saveName.trim()
    if (!name) return
    setSaved(saveNamedDeck(name, config))
    setSaveName('')
    setNotice(`Layout "${name}" saved.`)
  }

  const hasRows = Array.isArray(rows) && rows.length > 0
  const slide = deck.slides[slideIdx] || null

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="full"
        title="Disposal deck builder"
        subtitle={`${deck.assetCount} assets | ${deck.slides.length} slides | download as PowerPoint or PDF`}
        footer={(
          <div className="flex flex-wrap items-center justify-between gap-3 w-full">
            <div className="text-xs min-w-0" style={{ color: error ? 'var(--danger)' : 'var(--text-dim)' }}>
              {error || notice || (deck.unvaluedCount > 0
                ? `${deck.unvaluedCount} of ${deck.assetCount} assets are not valued. Valuation figures print "Not valued".`
                : 'Every figure comes from the disposal list itself.')}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button" onClick={() => download('pdf')} disabled={!!busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border disabled:opacity-50"
                style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              >
                {busy === 'pdf' ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
                Download PDF
              </button>
              <button
                type="button" onClick={() => download('pptx')} disabled={!!busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                {busy === 'pptx' ? <Loader2 size={15} className="animate-spin" /> : <Presentation size={15} />}
                Download PowerPoint
              </button>
            </div>
          </div>
        )}
      >
        {!hasRows && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border p-3 text-xs"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
            <AlertTriangle size={15} style={{ color: 'var(--warning)' }} className="shrink-0 mt-0.5" />
            <span>There are no assets on the disposal list, so every slide will say so rather than show an empty chart. The deck can still be downloaded.</span>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[250px_minmax(0,1fr)_270px] gap-4">
          {/* ── Slides rail ── */}
          <aside className="space-y-2 min-w-0">
            <div className="flex items-center gap-2">
              <button
                type="button" onClick={() => setShowAdd(true)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                <Plus size={14} /> Add slide
              </button>
              <button
                type="button" onClick={() => setShowLibrary(true)}
                title="Presets and saved layouts"
                className="px-2 py-1.5 rounded-lg text-xs border"
                style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
              >
                <LayoutTemplate size={14} />
              </button>
            </div>

            <ol className="space-y-1.5 max-h-[52vh] overflow-y-auto pr-1">
              {config.blocks.map((b, i) => {
                const def = DECK_BLOCKS[b.type]
                const active = b.id === selectedId
                return (
                  <li key={b.id}>
                    <div
                      className="rounded-lg border p-2 cursor-pointer"
                      style={{
                        borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
                        background: active ? 'var(--surface-2)' : 'transparent',
                      }}
                      onClick={() => setSelectedId(b.id)}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] w-4 shrink-0" style={{ color: 'var(--text-dim)' }}>{i + 1}</span>
                        <span className="text-xs font-medium truncate flex-1" style={{ color: 'var(--text-primary)' }}>
                          {b.title || b.label || def?.label}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] truncate" style={{ color: BLOCK_ICON_TONE }}>{def?.label}</span>
                        <span className="flex items-center gap-0.5">
                          <button type="button" title="Move up" onClick={(e) => { e.stopPropagation(); moveBlock(b.id, -1) }} className="p-0.5" style={{ color: 'var(--text-dim)' }}><ChevronUp size={13} /></button>
                          <button type="button" title="Move down" onClick={(e) => { e.stopPropagation(); moveBlock(b.id, 1) }} className="p-0.5" style={{ color: 'var(--text-dim)' }}><ChevronDown size={13} /></button>
                          <button type="button" title="Duplicate" onClick={(e) => { e.stopPropagation(); duplicateBlock(b.id) }} className="p-0.5" style={{ color: 'var(--text-dim)' }}><Copy size={13} /></button>
                          <button type="button" title="Remove" onClick={(e) => { e.stopPropagation(); removeBlock(b.id) }} className="p-0.5" style={{ color: 'var(--danger)' }}><Trash2 size={13} /></button>
                        </span>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>

            <div className="rounded-lg border p-2 space-y-1.5" style={{ borderColor: 'var(--border-subtle)' }}>
              <span className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>Save this layout</span>
              <div className="flex gap-1.5">
                <input
                  type="text" value={saveName} placeholder="Name"
                  onChange={(e) => setSaveName(e.target.value)}
                  className="flex-1 min-w-0 rounded-lg px-2 py-1 text-xs border"
                  style={{ background: 'var(--surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                />
                <button
                  type="button" onClick={doSaveNamed} disabled={!saveName.trim()}
                  className="px-2 py-1 rounded-lg text-xs border disabled:opacity-40"
                  style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                >
                  <Save size={13} />
                </button>
              </div>
            </div>
          </aside>

          {/* ── Preview ── */}
          <section className="min-w-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs" style={{ color: 'var(--text-dim)' }}>
                Slide {deck.slides.length ? slideIdx + 1 : 0} of {deck.slides.length}
              </span>
              <span className="flex items-center gap-1">
                <button
                  type="button" onClick={() => setSlideIdx((i) => Math.max(0, i - 1))} disabled={slideIdx <= 0}
                  className="p-1 rounded border disabled:opacity-30" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  type="button" onClick={() => setSlideIdx((i) => Math.min(deck.slides.length - 1, i + 1))} disabled={slideIdx >= deck.slides.length - 1}
                  className="p-1 rounded border disabled:opacity-30" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                >
                  <ChevronRight size={15} />
                </button>
              </span>
            </div>
            {/* 16:9, white, exactly the proportions the deck exports at. */}
            <div
              className="relative w-full rounded-lg overflow-hidden"
              style={{ aspectRatio: '16 / 9', background: PAPER.bg, border: `1px solid ${PAPER.border}`, boxShadow: '0 6px 24px rgba(0,0,0,0.18)' }}
            >
              <div style={{ position: 'absolute', inset: 0, padding: '4.5%' }}>
                <SlidePreview slide={slide} deck={deck} registerChart={registerChart} />
              </div>
            </div>
            <p className="mt-2 text-[11px] flex items-start gap-1.5" style={{ color: 'var(--text-dim)' }}>
              <Info size={13} className="shrink-0 mt-0.5" />
              This preview is what the PowerPoint and the PDF render. One chart per slide, so it reads across a meeting room.
            </p>
          </section>

          {/* ── Settings ── */}
          <aside className="min-w-0">
            <div className="flex items-center gap-1.5 mb-2">
              <Settings2 size={14} style={{ color: 'var(--text-dim)' }} />
              <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>Slide settings</span>
            </div>
            <BlockSettings block={selected} onPatch={(patch) => patchBlock(selected.id, patch)} />
          </aside>
        </div>
      </Modal>

      {/* ── Add slide picker (its own dialog: a menu inside a .card is clipped) ── */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} size="md" title="Add a slide">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {DECK_BLOCK_KEYS.map((k) => (
            <button
              key={k} type="button" onClick={() => addBlock(k)}
              className="text-left rounded-lg border p-3 hover:border-[var(--accent)]"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <span className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{DECK_BLOCKS[k].label}</span>
              <span className="block text-[11px] mt-1" style={{ color: 'var(--text-dim)' }}>{DECK_BLOCKS[k].description}</span>
            </button>
          ))}
        </div>
      </Modal>

      {/* ── Presets + saved layouts ── */}
      <Modal open={showLibrary} onClose={() => setShowLibrary(false)} size="lg" title="Presets and saved layouts">
        <div className="space-y-5">
          <div>
            <p className="text-xs uppercase tracking-wide mb-2" style={{ color: 'var(--text-dim)' }}>Presets</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {DECK_PRESET_KEYS.map((k) => (
                <button
                  key={k} type="button" onClick={() => applyPreset(k)}
                  className="text-left rounded-lg border p-3 hover:border-[var(--accent)]"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <span className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{DECK_PRESETS[k].label}</span>
                  <span className="block text-[11px] mt-1" style={{ color: 'var(--text-dim)' }}>{DECK_PRESETS[k].description}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide mb-2" style={{ color: 'var(--text-dim)' }}>Saved layouts</p>
            {saved.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-dim)' }}>Nothing saved yet. Name a layout on the slides rail to keep it.</p>
            ) : (
              <ul className="space-y-1.5">
                {saved.map((d) => (
                  <li key={d.name} className="flex items-center gap-2 rounded-lg border p-2" style={{ borderColor: 'var(--border-subtle)' }}>
                    <FolderOpen size={14} style={{ color: 'var(--text-dim)' }} />
                    <span className="flex-1 truncate text-sm" style={{ color: 'var(--text-primary)' }}>{d.name}</span>
                    <button
                      type="button"
                      onClick={() => { setConfig(normalizeDeckConfig(d.config)); setSelectedId(null); setSlideIdx(0); setShowLibrary(false) }}
                      className="px-2 py-1 rounded text-xs border" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                    >
                      Open
                    </button>
                    <button
                      type="button" onClick={() => setSaved(deleteNamedDeck(d.name))}
                      className="p-1 rounded" style={{ color: 'var(--danger)' }} title="Delete"
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Modal>
    </>
  )
}
