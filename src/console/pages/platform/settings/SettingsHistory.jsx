/**
 * System Settings > Change history: every recorded setting change (who, when,
 * old value, new value, reason) since 30 Sep 2026, plus the older console
 * saves that were logged without a key or old value.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Info } from 'lucide-react'
import { Btn, Panel, PanelHeader, Note, SearchInput, LoadingState, ErrorState, EmptyState } from '../../../components/ui'
import { listConfigHistory, listConsoleConfigSaves, namesFor } from '../../../../lib/api/consolePlatform'
import { displaySettingValue, fmtRiyadh } from '../../../../lib/consolePlatform'
import { exportConsoleRows } from '../../../../lib/consoleTable'
import { toUserMessage } from '../../../../lib/safeError'

const show = (v) => (v == null ? 'Not set' : displaySettingValue(null, v) ?? 'Not set')

export default function SettingsHistory() {
  const [state, setState] = useState({ loading: true })
  const [search, setSearch] = useState('')
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    try {
      const [hist, saves] = await Promise.all([listConfigHistory({ limit: 1000 }), listConsoleConfigSaves({ limit: 100 }).catch(() => null)])
      const names = await namesFor([...(hist || []).map((h) => h.changed_by), ...(saves || []).map((s) => s.admin_id)])
      setState({ loading: false, hist: hist || [], saves, names })
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e, 'Could not load the change history.') })
    }
  }, [])
  useEffect(() => { load() }, [load])

  const { loading, hist = [], saves, names = {}, error } = state
  const q = search.trim().toLowerCase()
  const shown = useMemo(() => hist.filter((h) => !q || `${h.key} ${h.reason || ''} ${names[h.changed_by] || ''}`.toLowerCase().includes(q)), [hist, q, names])

  if (loading) return <LoadingState label="Loading history" rows={6} />
  if (error) return <ErrorState message={error} onRetry={load} />

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Recorded changes" subtitle="Who, when, old value, new value and reason, from 30 Sep 2026"
          actions={<Btn size="xs" icon={Download} disabled={!shown.length} onClick={() => exportConsoleRows({
            rows: shown, title: 'Settings change history', columns: [
              { key: 'changed_at', header: 'When (Riyadh)', value: (h) => fmtRiyadh(h.changed_at, { year: true }) },
              { key: 'key', header: 'Setting' }, { key: 'action', header: 'Action' },
              { key: 'old', header: 'Old value', value: (h) => show(h.old_value) },
              { key: 'new', header: 'New value', value: (h) => show(h.new_value) },
              { key: 'by', header: 'By', value: (h) => names[h.changed_by] || 'Not recorded' },
              { key: 'reason', header: 'Reason', value: (h) => h.reason || 'Not recorded' },
            ] })}>Excel</Btn>} />
        <div className="p-4 space-y-3">
          <div className="w-full sm:w-72"><SearchInput value={search} onChange={setSearch} placeholder="Search setting, person or reason" /></div>
          {shown.length === 0 ? (
            <EmptyState title="No changes recorded yet" reason="Recording started on 30 Sep 2026. The next saved setting appears here with its old and new value." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[11px] text-gray-500 border-b border-gray-800">
                  <tr>{['When', 'Setting', 'Change', 'By', 'Reason'].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-800/70">
                  {shown.map((h) => (
                    <tr key={h.id}>
                      <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{fmtRiyadh(h.changed_at, { year: true })}</td>
                      <td className="px-3 py-2 font-mono text-gray-300">{h.key}</td>
                      <td className="px-3 py-2 text-gray-200">{h.action === 'insert' ? `Created as ${show(h.new_value)}` : h.action === 'delete' ? `Removed (was ${show(h.old_value)})` : `${show(h.old_value)} to ${show(h.new_value)}`}</td>
                      <td className="px-3 py-2 text-gray-400">{names[h.changed_by] || 'Not recorded'}</td>
                      <td className="px-3 py-2 text-gray-400">{h.reason || 'Not recorded'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Panel>
      <Panel>
        <PanelHeader title="Older console saves" subtitle="Logged before history started: no setting name, old value or reason was kept" />
        <div className="p-4 space-y-2">
          <Note icon={Info}>These rows only prove that someone saved System Config on that day. They cannot be restored.</Note>
          {saves == null ? <p className="text-xs text-gray-500">N/A: the console audit log could not be read.</p> : saves.length === 0 ? <p className="text-xs text-gray-500">None.</p> : (
            <ul className="divide-y divide-gray-800/70 text-xs">
              {saves.map((s) => (
                <li key={s.id} className="py-1.5 flex flex-wrap gap-x-3">
                  <span className="text-gray-400">{fmtRiyadh(s.created_at, { year: true })}</span>
                  <span className="text-gray-300">{names[s.admin_id] || 'Not recorded'}</span>
                  <span className="text-gray-500 truncate">{s.details && typeof s.details === 'object' ? Object.keys(s.details).slice(0, 4).join(', ') || 'No detail' : 'No detail'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
    </div>
  )
}
