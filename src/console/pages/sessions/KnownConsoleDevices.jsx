/**
 * KnownConsoleDevices - the "Known console devices" panel on the Sessions &
 * Devices console page. Every (IP, browser) pair a super admin has signed in
 * to the console from. A sign-in from a pair not on this list notifies every
 * super admin. "Forget" removes a pair so its next sign-in alerts again.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Fingerprint, RefreshCw, Trash2 } from 'lucide-react'
import {
  Panel, PanelHeader, Note, Badge, Btn, SearchInput, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, ConfirmImpactDialog,
} from '../../components/ui'
import { usePaged, Pager } from '../shared/pageKit'
import ExportButtons from '../shared/ExportButtons'
import { ImpactLine } from '../platform/SectionKit'
import { useConsoleAuth } from '../../ConsoleAuthContext'
import { listKnownDevices, forgetKnownDevice, summarizeKnownDevices } from '../../../lib/api/consoleKnownDevices'
import { toUserMessage } from '../../../lib/safeError'

function fmt(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function KnownConsoleDevices({ onChanged }) {
  const { logAction } = useConsoleAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      setRows(await listKnownDevices())
    } catch (err) {
      setError(toUserMessage(err, 'Could not load known console devices.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeKnownDevices(rows), [rows])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => [r.adminName, r.ip, r.device, r.userAgent]
      .some((v) => String(v || '').toLowerCase().includes(q)))
  }, [rows, search])

  const paged = usePaged(filtered, 25, search)

  async function handleForget(reason) {
    if (!confirm) return
    setBusy(true)
    try {
      await forgetKnownDevice(confirm.id)
      await logAction?.('forget_console_device_reason', null, 'console_device', { device: confirm.device, reason: reason || null })
      setConfirm(null)
      await load()
      onChanged?.()
    } catch (err) {
      setError(toUserMessage(err, 'Could not forget that device.'))
      setConfirm(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel flush>
      <div className="p-4 pb-3 space-y-3">
        <PanelHeader icon={Fingerprint} title="Known console devices"
          subtitle={`${summary.total} device(s) across ${summary.admins} super admin(s), ${summary.newThisWeek} first seen in the last 7 days`}
          actions={(<>
            {!error && <ExportButtons rows={filtered} title="Known console devices" columns={[
              { key: 'adminName', header: 'Admin' }, { key: 'ip', header: 'IP address', value: (d) => d.ip || 'Unknown' },
              { key: 'ipSource', header: 'IP verified', value: (d) => (d.ipSource === 'header' ? 'Yes' : 'No') },
              { key: 'device', header: 'Browser' }, { key: 'firstSeen', header: 'First seen', value: (d) => fmt(d.firstSeen) },
              { key: 'lastSeen', header: 'Last seen', value: (d) => fmt(d.lastSeen) }, { key: 'loginCount', header: 'Sign-ins' },
            ]} />}
            <Btn icon={RefreshCw} onClick={load} busy={loading}>Refresh</Btn>
          </>)} />
        <Note>
          A console sign-in from an IP address or browser that is not on this list notifies every super admin
          and writes a warning to System Health. The first sign-in for an admin is recorded quietly.
          Forget a device to be alerted the next time it is used.
        </Note>
        {summary.unverifiedIp > 0 && (
          <Note tone="warning">
            {summary.unverifiedIp} device(s) have an IP taken from the browser because the server saw no forwarding
            header. Treat those addresses as unverified.
          </Note>
        )}
        <ErrorState message={error} onRetry={load} />
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search admin, IP or browser" className="flex-1 min-w-[180px]" />
        </Toolbar>
        <ImpactLine change="Forget removes a device from the trusted list, so its next console sign-in alerts every super admin. Nobody is signed out."
          who="Only the super admin who used that device." />
      </div>

      {loading ? (
        <div className="px-4"><LoadingState label="Loading devices" rows={3} /></div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Fingerprint} title="No console devices recorded yet"
          reason="Devices are recorded from the next console sign-in onward." />
      ) : filtered.length === 0 ? (
        <EmptyState title="No devices match your search" action={<Btn onClick={() => setSearch('')}>Clear search</Btn>} />
      ) : (
        <>
        <Table className="border-0 rounded-none">
          <THead>
            <Th>Admin</Th>
            <Th>IP address</Th>
            <Th>Browser</Th>
            <Th>First seen</Th>
            <Th>Last seen</Th>
            <Th align="right">Sign-ins</Th>
            <Th align="right">Actions</Th>
          </THead>
          <tbody>
            {paged.pageRows.map((d) => (
              <Tr key={d.id}>
                <Td className="text-gray-200">{d.adminName}</Td>
                <Td nowrap>
                  <span className="text-gray-300 tabular-nums">{d.ip || 'Unknown'}</span>
                  {d.ipSource !== 'header' && <span className="ml-1.5"><Badge tone="warning">Unverified</Badge></span>}
                </Td>
                <Td className="text-gray-400" ><span title={d.userAgent || ''}>{d.device}</span></Td>
                <Td nowrap className="text-gray-400">{fmt(d.firstSeen)}</Td>
                <Td nowrap className="text-gray-400">{fmt(d.lastSeen)}</Td>
                <Td align="right" className="text-gray-300 tabular-nums">{d.loginCount}</Td>
                <Td align="right">
                  <Btn size="xs" icon={Trash2} onClick={() => setConfirm(d)}>Forget</Btn>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        <Pager {...paged} onPage={paged.setPage} />
        </>
      )}

      <ConfirmImpactDialog
        open={!!confirm}
        title="Forget this device"
        confirmLabel="Forget device"
        requireReason
        busy={busy}
        impact={confirm ? {
          what: `${confirm.device} at ${confirm.ip || 'an unknown IP'} for ${confirm.adminName}.`,
          change: 'It leaves the trusted list. The next console sign-in from it alerts every super admin.',
          who: `${confirm.adminName}. Nobody is signed out.`,
          undo: 'It is recorded again, quietly flagged, on its next sign-in.',
        } : undefined}
        onCancel={() => { if (!busy) setConfirm(null) }}
        onConfirm={({ reason }) => handleForget(reason)}
      />
    </Panel>
  )
}
