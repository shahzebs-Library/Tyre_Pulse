/**
 * Bulk update (CSV): download the current list as the template, change Role,
 * Sites or Approved in a spreadsheet, upload it, review exactly what changes,
 * then apply with a reason. Writes reuse the existing audited writers
 * (admin_bulk_set_role, admin_set_user_sites, admin_mobile_user_action).
 */
import { useState } from 'react'
import { Download, Upload, Info } from 'lucide-react'
import { Modal, Btn, Note, ImpactBox, EmptyState } from '../../../components/ui'
import { exportConsoleRows } from '../../../../lib/consoleTable'
import { parseWorkbook } from '../../../../lib/import/parseWorkbook'
import { bulkSetRole, adminSetUserSites } from '../../../../lib/api/adminAccess'
import { approvePerson } from '../../../../lib/api/consolePlatform'
import { shortName } from '../../../../lib/consolePlatform'
import { toUserMessage } from '../../../../lib/safeError'
import { useConsoleAuth } from '../../../ConsoleAuthContext'

const norm = (s) => String(s ?? '').trim()
const sitesKey = (list) => (Array.isArray(list) ? list : []).map((s) => String(s).trim().toUpperCase()).filter(Boolean).sort().join(';')

/** Pure: compare uploaded rows with current people. */
export function diffCsv(rows = [], people = [], roles = []) {
  const byId = new Map(people.map((p) => [p.id, p]))
  const roleSet = new Set(roles)
  const changes = []; const problems = []
  rows.forEach((r, i) => {
    const id = norm(r['User ID'] ?? r.user_id ?? r.id)
    if (!id) return
    const p = byId.get(id)
    if (!p) { problems.push(`Row ${i + 2}: no person with this id`); return }
    const role = norm(r.Role ?? r.role)
    const sitesRaw = norm(r.Sites ?? r.sites)
    const approved = norm(r.Approved ?? r.approved).toLowerCase()
    const ch = { id, name: shortName(p.full_name) }
    if (role && role !== p.role) {
      if (!roleSet.has(role)) problems.push(`Row ${i + 2}: unknown role "${role}"`)
      else ch.role = role
    }
    if (sitesRaw) {
      const next = sitesRaw.split(/[;,]/).map((s) => s.trim().toUpperCase()).filter(Boolean)
      if (sitesKey(next) !== sitesKey(p.sites)) ch.sites = next
    }
    if (approved === 'yes' && p.approved === false) ch.approve = true
    if (ch.role || ch.sites || ch.approve) changes.push(ch)
  })
  return { changes, problems }
}

export default function BulkCsvDialog({ open, onClose, people = [], roles = [], onDone }) {
  const { logAction } = useConsoleAuth()
  const [diff, setDiff] = useState(null)
  const [error, setError] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')

  async function downloadTemplate() {
    await exportConsoleRows({
      rows: people, title: 'Users bulk update template', columns: [
        { key: 'id', header: 'User ID' },
        { key: 'full_name', header: 'Name' },
        { key: 'role', header: 'Role' },
        { key: 'sites', header: 'Sites', value: (p) => (Array.isArray(p.sites) ? p.sites.join(';') : '') },
        { key: 'approved', header: 'Approved', value: (p) => (p.approved === false ? 'no' : 'yes') },
      ],
    })
  }

  async function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(''); setResult('')
    try {
      const wb = await parseWorkbook(file, { fileName: file.name })
      const rows = wb?.sheets?.[0]?.rows || []
      setDiff(diffCsv(rows, people, roles))
    } catch (err) {
      setError(toUserMessage(err, 'The file could not be read. Use the downloaded template.'))
    }
  }

  async function apply() {
    if (!diff?.changes?.length || reason.trim().length < 3) return
    setBusy(true); setError('')
    let ok = 0; const failed = []
    const byRole = {}
    for (const c of diff.changes) if (c.role) (byRole[c.role] ||= []).push(c.id)
    for (const [role, ids] of Object.entries(byRole)) {
      try { await bulkSetRole(ids, role); ok += ids.length } catch (err) { failed.push(`${role}: ${toUserMessage(err, 'failed')}`) }
    }
    for (const c of diff.changes) {
      try {
        if (c.sites) { await adminSetUserSites(c.id, c.sites); ok += 1 }
        if (c.approve) { await approvePerson(c.id, reason.trim()); ok += 1 }
      } catch (err) { failed.push(`${c.name}: ${toUserMessage(err, 'failed')}`) }
    }
    await logAction?.('users_bulk_csv', null, 'user', { changes: diff.changes.length, ok, failed: failed.length, reason: reason.trim() })
    setBusy(false)
    setResult(`${ok} change${ok === 1 ? '' : 's'} applied.${failed.length ? ` ${failed.length} failed: ${failed.slice(0, 3).join(' | ')}` : ''}`)
    if (!failed.length) onDone?.()
  }

  const n = diff?.changes?.length || 0
  return (
    <Modal open={open} title="Bulk update (CSV)" subtitle="Download the current list, edit Role, Sites or Approved, upload it back" onClose={busy ? () => {} : onClose} width="max-w-3xl"
      footer={<>
        <Btn onClick={onClose} disabled={busy}>Close</Btn>
        <Btn variant="primary" busy={busy} disabled={!n || reason.trim().length < 3} onClick={apply}>Apply {n} change{n === 1 ? '' : 's'}</Btn>
      </>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Btn icon={Download} onClick={downloadTemplate}>Download current list as template</Btn>
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-800 text-xs text-gray-300 cursor-pointer hover:bg-gray-800/60 focus-within:ring-2 focus-within:ring-orange-500">
            <Upload size={13} aria-hidden="true" /> Upload filled file
            <input type="file" accept=".csv,.xlsx,.xls" className="sr-only" onChange={onFile} />
          </label>
        </div>
        <Note icon={Info}>Only Role, Sites (separate with ;) and Approved (yes) are read. Names and emails are never changed from a file. Unknown ids and roles are listed and skipped.</Note>
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        {diff && (
          diff.changes.length === 0 ? <EmptyState title="Nothing to change" reason="Every row matches what is stored now." /> : (
            <>
              <ImpactBox tone="warning" what={`${diff.changes.length} ${diff.changes.length === 1 ? 'person changes' : 'people change'}`}
                change={`${diff.changes.filter((c) => c.role).length} role, ${diff.changes.filter((c) => c.sites).length} sites, ${diff.changes.filter((c) => c.approve).length} approvals.`}
                who={diff.changes.slice(0, 6).map((c) => c.name).join(', ') + (diff.changes.length > 6 ? '...' : '')}
                undo="Yes. Upload the earlier file again, or change each person back. Every change is in the access audit log." />
              <div className="max-h-56 overflow-y-auto border border-gray-800 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="text-[11px] text-gray-500"><tr><th className="text-left px-2 py-1">Person</th><th className="text-left px-2 py-1">Change</th></tr></thead>
                  <tbody className="divide-y divide-gray-800">
                    {diff.changes.map((c) => (
                      <tr key={c.id}><td className="px-2 py-1 text-gray-200">{c.name}</td>
                        <td className="px-2 py-1 text-gray-400">{[c.role && `role to ${c.role}`, c.sites && `sites to ${c.sites.join(', ')}`, c.approve && 'approve'].filter(Boolean).join('; ')}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="block">
                <span className="block text-[11px] font-semibold text-gray-400 mb-1">Reason (goes to the audit log)</span>
                <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200" placeholder="Why are you doing this?" />
              </label>
            </>
          )
        )}
        {diff?.problems?.length > 0 && <Note tone="warning">Skipped: {diff.problems.slice(0, 5).join('; ')}{diff.problems.length > 5 ? ` and ${diff.problems.length - 5} more` : ''}</Note>}
        {result && <Note tone="accent">{result}</Note>}
      </div>
    </Modal>
  )
}
