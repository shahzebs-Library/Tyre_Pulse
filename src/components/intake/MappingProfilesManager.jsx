import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Bookmark, ChevronDown, ChevronRight, Trash2, Pencil, Eye, EyeOff,
  Loader2, RefreshCw, ArrowRight, AlertCircle,
} from 'lucide-react'
import * as imports from '../../lib/api/imports'
import { useLanguage } from '../../contexts/LanguageContext'
import { toUserMessage } from '../../lib/safeError'
import EnterpriseTable from '../ui/EnterpriseTable'
import { compareValues, isBlank } from '../../lib/consoleTable'

const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))

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
  const { t } = useLanguage()
  const [profiles, setProfiles] = useState(null) // null = loading
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [rules, setRules] = useState({})
  const [busyId, setBusyId] = useState(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try { setProfiles(await imports.listAllProfiles()) }
    catch (e) { setError(toUserMessage(e, t('intake.panels.profiles.errorLoad'))); setProfiles([]) }
  }, [t])
  useEffect(() => { load() }, [load])

  async function retryRules(id) {
    setRules((p) => { const n = { ...p }; delete n[id]; return n })
    try { const r = await imports.getProfileRules(id); setRules((p) => ({ ...p, [id]: r || [] })) }
    catch (e) { setRules((p) => ({ ...p, [id]: { error: toUserMessage(e, 'The column rules could not be loaded.') } })) }
  }

  async function toggleExpand(id) {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (!rules[id]) {
      try { const r = await imports.getProfileRules(id); setRules((p) => ({ ...p, [id]: r || [] })) }
      catch (e) { setRules((p) => ({ ...p, [id]: { error: toUserMessage(e, 'The column rules could not be loaded.') } })) }
    }
  }
  async function rename(p) {
    const name = window.prompt(t('intake.panels.profiles.renamePrompt'), p.name)
    if (!name || !name.trim() || name.trim() === p.name) return
    setBusyId(p.id)
    try { await imports.renameProfile(p.id, name); await load() } catch (e) { setError(toUserMessage(e)) } finally { setBusyId(null) }
  }
  async function toggleActive(p) {
    setBusyId(p.id)
    try { await imports.setProfileActive(p.id, !p.active); await load() } catch (e) { setError(toUserMessage(e)) } finally { setBusyId(null) }
  }
  async function remove(p) {
    if (!window.confirm(t('intake.panels.profiles.deleteConfirm', { name: p.name, count: p.rule_count }))) return
    setBusyId(p.id)
    try { await imports.deleteProfile(p.id); if (expanded === p.id) setExpanded(null); await load() }
    catch (e) { setError(toUserMessage(e)) } finally { setBusyId(null) }
  }

  const keptAsExtra = t('intake.panels.profiles.keptAsExtra')
  const ruleColumns = useMemo(() => [
    {
      id: 'source_header', header: t('intake.panels.profiles.sourceColumn'),
      accessorFn: (r) => (isBlank(r.source_header) ? undefined : r.source_header),
      sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => <span className="text-[var(--text-secondary)]">{getValue() ?? 'N/A'}</span>,
    },
    {
      id: 'target_field', header: t('intake.panels.profiles.mappedTo'),
      accessorFn: (r) => (isBlank(r.target_field) ? undefined : r.target_field),
      sortingFn: valueSort, sortUndefined: 'last',
      meta: { exportValue: (r) => r.target_field || keptAsExtra },
      cell: ({ getValue }) => (getValue()
        ? <span className="text-[var(--text-primary)]">{getValue()}</span>
        : <span className="text-amber-500">{keptAsExtra}</span>),
    },
  ], [t, keptAsExtra])

  const count = profiles?.length ?? 0
  const groups = {}
  for (const p of profiles || []) (groups[p.module] ||= []).push(p)

  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : 'N/A')

  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex items-center gap-1 pr-2 hover:bg-[var(--surface-2)] transition-colors">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex-1 min-w-0 min-h-[44px] flex items-center gap-2 px-4 py-3 text-left"
        >
          {open ? <ChevronDown size={16} className="text-[var(--text-muted)]" aria-hidden="true" /> : <ChevronRight size={16} className="text-[var(--text-muted)]" aria-hidden="true" />}
          <Bookmark size={16} className="text-[var(--accent)]" aria-hidden="true" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">{t('intake.panels.profiles.header')}</span>
          <span className="text-xs text-[var(--text-muted)] bg-[var(--surface-2)] rounded-full px-2 py-0.5">{profiles == null ? '…' : count}</span>
        </button>
        <button
          type="button"
          onClick={() => load()}
          title={t('intake.panels.profiles.refresh')}
          aria-label={t('intake.panels.profiles.refresh')}
          className="shrink-0 inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </div>

      {open && (
        <div className="border-t border-[var(--card-border)] p-4 space-y-4">
          {error && (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-primary)] bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2">
              <AlertCircle size={15} className="text-red-500" aria-hidden="true" /> <span className="flex-1">{error}</span>
              <button type="button" onClick={() => load()} className="btn-secondary text-xs px-3 min-h-[44px]">Retry</button>
            </div>
          )}

          {profiles == null && (
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> {t('intake.panels.profiles.loading')}</div>
          )}

          {profiles != null && count === 0 && !error && (
            <div className="text-sm text-[var(--text-muted)]">
              {t('intake.panels.profiles.empty')}
            </div>
          )}

          {Object.entries(groups).map(([mod, list]) => (
            <div key={mod}>
              <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-1.5">
                {moduleLabels[mod] || mod} <span className="opacity-60">· {list.length}</span>
              </div>
              <div className="space-y-1.5">
                {list.map((p) => (
                  <div key={p.id} className={`rounded-lg border ${p.active ? 'border-[var(--card-border)]' : 'border-dashed border-[var(--border)] opacity-70'} bg-[var(--surface-2)]`}>
                    <div className="flex items-center gap-2 px-3 py-2">
                      <button type="button" onClick={() => toggleExpand(p.id)} aria-expanded={expanded === p.id} className="flex items-center gap-2 min-w-0 flex-1 min-h-[44px] text-left">
                        {expanded === p.id ? <ChevronDown size={14} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" /> : <ChevronRight size={14} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" />}
                        <span className="text-sm text-[var(--text-primary)] truncate">{p.name}</span>
                        {!p.active && <span className="text-[10px] text-[var(--text-muted)] border border-[var(--border)] rounded px-1">{t('intake.panels.profiles.inactive')}</span>}
                      </button>
                      <span className="hidden sm:block text-xs text-[var(--text-muted)] shrink-0">{p.source_system || 'N/A'}</span>
                      <span className="text-xs text-[var(--text-muted)] shrink-0" title={t('intake.panels.profiles.colsSuffix')}>{p.rule_count} {t('intake.panels.profiles.colsSuffix')}</span>
                      <span className="hidden md:block text-xs text-[var(--text-muted)] shrink-0" title={fmtDate(p.last_used_at)}>{fmtDate(p.last_used_at)}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        {onApply && (
                          <button type="button" onClick={() => onApply(p.id)} title={t('intake.panels.profiles.applyTitle')} aria-label={`${t('intake.panels.profiles.applyTitle')}: ${p.name}`} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded hover:bg-[var(--surface-3,var(--surface-2))] text-[var(--accent)]"><ArrowRight size={14} aria-hidden="true" /></button>
                        )}
                        <button type="button" onClick={() => rename(p)} disabled={busyId === p.id} title={t('intake.panels.profiles.renameTitle')} aria-label={`${t('intake.panels.profiles.renameTitle')}: ${p.name}`} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded hover:bg-[var(--surface-3,var(--surface-2))] text-[var(--text-muted)] disabled:opacity-40"><Pencil size={13} aria-hidden="true" /></button>
                        <button type="button" onClick={() => toggleActive(p)} disabled={busyId === p.id} title={p.active ? t('intake.panels.profiles.deactivateTitle') : t('intake.panels.profiles.activateTitle')} aria-label={`${p.active ? t('intake.panels.profiles.deactivateTitle') : t('intake.panels.profiles.activateTitle')}: ${p.name}`} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded hover:bg-[var(--surface-3,var(--surface-2))] text-[var(--text-muted)] disabled:opacity-40">{p.active ? <EyeOff size={13} aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}</button>
                        <button type="button" onClick={() => remove(p)} disabled={busyId === p.id} title={t('intake.panels.profiles.deleteTitle')} aria-label={`${t('intake.panels.profiles.deleteTitle')}: ${p.name}`} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded hover:bg-[var(--surface-3,var(--surface-2))] text-red-500 disabled:opacity-40">{busyId === p.id ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Trash2 size={13} aria-hidden="true" />}</button>
                      </div>
                    </div>

                    {expanded === p.id && (
                      <div className="border-t border-[var(--card-border)] px-3 py-2">
                        {!rules[p.id] ? (
                          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><Loader2 size={12} className="animate-spin" /> {t('intake.panels.profiles.loadingColumns')}</div>
                        ) : rules[p.id].error ? (
                          <div role="alert" className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-red-500">{rules[p.id].error}</span>
                            <button type="button" onClick={() => retryRules(p.id)} className="btn-secondary text-xs px-3 min-h-[44px]">Retry</button>
                          </div>
                        ) : rules[p.id].length === 0 ? (
                          <div className="text-xs text-[var(--text-muted)]">{t('intake.panels.profiles.noRules')}</div>
                        ) : (
                          <EnterpriseTable
                            columns={ruleColumns}
                            data={rules[p.id]}
                            getRowId={(r, i) => `${r.source_header ?? ''}:${i}`}
                            initialPageSize={25}
                            enableColumnVisibility={false}
                            searchPlaceholder={t('intake.panels.profiles.sourceColumn')}
                            exportFileName={`Mapping ${p.name}`}
                            reportMeta={{ title: `Saved mapping: ${p.name}` }}
                          />
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
