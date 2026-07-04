import { useState, useEffect, useCallback } from 'react'
import {
  Bookmark, ChevronDown, ChevronRight, Trash2, Pencil, Eye, EyeOff,
  Loader2, RefreshCw, ArrowRight, AlertCircle,
} from 'lucide-react'
import * as imports from '../../lib/api/imports'

/**
 * Saved Mappings manager — browse, inspect and manage the reusable column-mapping
 * profiles the user has saved. Fixes the gap where saved mappings were only ever
 * reachable as a nameless dropdown mid-upload: here every profile is listed,
 * grouped by module, and expands to show its actual source → target column rules.
 *
 * @param {object}   props
 * @param {Record<string,string>} props.moduleLabels  module key → display label
 * @param {(profileId:string)=>void} [props.onApply]   when provided, an "Apply"
 *        button appears (used from the mapping step to apply a profile to the
 *        current upload)
 */
export default function MappingProfilesManager({ moduleLabels = {}, onApply }) {
  const [profiles, setProfiles] = useState(null) // null = loading
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [rules, setRules] = useState({})
  const [busyId, setBusyId] = useState(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try { setProfiles(await imports.listAllProfiles()) }
    catch (e) { setError(e?.message || 'Could not load saved mappings.'); setProfiles([]) }
  }, [])
  useEffect(() => { load() }, [load])

  async function toggleExpand(id) {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (!rules[id]) {
      try { const r = await imports.getProfileRules(id); setRules((p) => ({ ...p, [id]: r || [] })) }
      catch { setRules((p) => ({ ...p, [id]: [] })) }
    }
  }
  async function rename(p) {
    const name = window.prompt('Rename this saved mapping:', p.name)
    if (!name || !name.trim() || name.trim() === p.name) return
    setBusyId(p.id)
    try { await imports.renameProfile(p.id, name); await load() } catch (e) { setError(e.message) } finally { setBusyId(null) }
  }
  async function toggleActive(p) {
    setBusyId(p.id)
    try { await imports.setProfileActive(p.id, !p.active); await load() } catch (e) { setError(e.message) } finally { setBusyId(null) }
  }
  async function remove(p) {
    if (!window.confirm(`Delete the saved mapping “${p.name}” and its ${p.rule_count} column rule(s)? This cannot be undone.`)) return
    setBusyId(p.id)
    try { await imports.deleteProfile(p.id); if (expanded === p.id) setExpanded(null); await load() }
    catch (e) { setError(e.message) } finally { setBusyId(null) }
  }

  const count = profiles?.length ?? 0
  const groups = {}
  for (const p of profiles || []) (groups[p.module] ||= []).push(p)

  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : '—')

  return (
    <div className="card p-0 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-800/40 transition-colors"
      >
        {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
        <Bookmark size={16} className="text-[var(--accent)]" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">Saved column mappings</span>
        <span className="text-xs text-[var(--text-muted)] bg-gray-800 rounded-full px-2 py-0.5">{profiles == null ? '…' : count}</span>
        <span className="ml-auto" />
        <RefreshCw
          size={14}
          className="text-gray-500 hover:text-gray-300"
          onClick={(e) => { e.stopPropagation(); load() }}
          title="Refresh"
        />
      </button>

      {open && (
        <div className="border-t border-[var(--card-border)] p-4 space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg px-3 py-2">
              <AlertCircle size={15} /> {error}
            </div>
          )}

          {profiles == null && (
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 size={15} className="animate-spin" /> Loading your saved mappings…</div>
          )}

          {profiles != null && count === 0 && !error && (
            <div className="text-sm text-[var(--text-muted)]">
              No saved mappings yet. Upload a file, map its columns, and choose <span className="text-[var(--text-secondary)] font-medium">“Save as profile”</span> — it will appear here for reuse.
            </div>
          )}

          {Object.entries(groups).map(([mod, list]) => (
            <div key={mod}>
              <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-1.5">
                {moduleLabels[mod] || mod} <span className="opacity-60">· {list.length}</span>
              </div>
              <div className="space-y-1.5">
                {list.map((p) => (
                  <div key={p.id} className={`rounded-lg border ${p.active ? 'border-[var(--card-border)]' : 'border-dashed border-gray-700 opacity-70'} bg-gray-900/40`}>
                    <div className="flex items-center gap-2 px-3 py-2">
                      <button onClick={() => toggleExpand(p.id)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
                        {expanded === p.id ? <ChevronDown size={14} className="text-gray-500 shrink-0" /> : <ChevronRight size={14} className="text-gray-500 shrink-0" />}
                        <span className="text-sm text-[var(--text-primary)] truncate">{p.name}</span>
                        {!p.active && <span className="text-[10px] text-gray-500 border border-gray-700 rounded px-1">inactive</span>}
                      </button>
                      <span className="hidden sm:block text-xs text-[var(--text-muted)] shrink-0">{p.source_system || '—'}</span>
                      <span className="text-xs text-[var(--text-muted)] shrink-0" title="Columns mapped">{p.rule_count} col{p.rule_count === 1 ? '' : 's'}</span>
                      <span className="hidden md:block text-xs text-[var(--text-muted)] shrink-0" title="Last used">{fmtDate(p.last_used_at)}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        {onApply && (
                          <button onClick={() => onApply(p.id)} title="Apply to current upload" className="p-1.5 rounded hover:bg-gray-700 text-[var(--accent)]"><ArrowRight size={14} /></button>
                        )}
                        <button onClick={() => rename(p)} disabled={busyId === p.id} title="Rename" className="p-1.5 rounded hover:bg-gray-700 text-gray-400 disabled:opacity-40"><Pencil size={13} /></button>
                        <button onClick={() => toggleActive(p)} disabled={busyId === p.id} title={p.active ? 'Deactivate' : 'Activate'} className="p-1.5 rounded hover:bg-gray-700 text-gray-400 disabled:opacity-40">{p.active ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                        <button onClick={() => remove(p)} disabled={busyId === p.id} title="Delete" className="p-1.5 rounded hover:bg-gray-700 text-red-400 disabled:opacity-40">{busyId === p.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}</button>
                      </div>
                    </div>

                    {expanded === p.id && (
                      <div className="border-t border-[var(--card-border)] px-3 py-2">
                        {!rules[p.id] ? (
                          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><Loader2 size={12} className="animate-spin" /> Loading columns…</div>
                        ) : rules[p.id].length === 0 ? (
                          <div className="text-xs text-[var(--text-muted)]">No column rules stored for this mapping.</div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-[var(--text-muted)] text-left">
                                  <th className="py-1 pr-4 font-medium">Your column (source)</th>
                                  <th className="py-1 pr-4 font-medium">Mapped to (field)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rules[p.id].map((r, i) => (
                                  <tr key={i} className="border-t border-gray-800/60">
                                    <td className="py-1 pr-4 text-[var(--text-secondary)]">{r.source_header}</td>
                                    <td className="py-1 pr-4">
                                      {r.target_field
                                        ? <span className="text-[var(--text-primary)]">{r.target_field}</span>
                                        : <span className="text-amber-400/80">kept as extra data</span>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
