/**
 * ConsoleApiKeys.jsx - super-admin API key lifecycle, across every organisation.
 *
 * Reads the SAME public.api_keys table the public-api edge function
 * authenticates against (V99). Shows the display prefix only: the secret was
 * shown once at creation and its hash never leaves the database.
 *
 * Revoke (reason required) and set/extend/clear expiry go through super-admin
 * RPCs that audit into console_sessions and access_audit. Rotation findings are
 * advice only; nothing is revoked automatically.
 *
 * Usage history is honest about its limit: api_key_authenticate prunes the
 * per-minute counter to the last hour, so the chart covers 60 minutes and
 * older usage is known only through "last used".
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  KeyRound, Ban, CalendarClock, RefreshCw, Download, AlertTriangle, Info, Activity, Building2,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Code, Btn, Segmented, SearchInput, Select, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Modal,
} from '../components/ui'
import { TrendChart } from '../components/ui/charts'
import { listAllApiKeys, revokeApiKeyAsAdmin, setApiKeyExpiry } from '../../lib/api/apiKeyAdmin'
import {
  decorateKeys, summarizeKeys, filterKeys, revokeReasonError, expiryError, extendedExpiry,
  FLAG_META, STATUS_META, ROTATE_AFTER_DAYS, STALE_AFTER_DAYS,
} from '../../lib/apiKeyLifecycle'
import { toUserMessage } from '../../lib/safeError'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'

function fmtWhen(v) {
  if (!v) return 'N/A'
  return new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function fmtDate(v) {
  if (!v) return 'N/A'
  return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
const toInputDate = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '')

function RevokeModal({ target, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const invalid = revokeReasonError(reason)
  const submit = async () => {
    if (invalid) { setErr(invalid); return }
    setBusy(true); setErr(null)
    try {
      const res = await revokeApiKeyAsAdmin(target.id, reason)
      if (res && res.ok === false) setErr('This key was already revoked.')
      else onDone('Key revoked. Any integration using it now gets 401.')
    } catch (e) {
      setErr(toUserMessage(e, 'Could not revoke the key.'))
    } finally { setBusy(false) }
  }
  return (
    <Modal open={!!target} onClose={onClose} title="Revoke API key"
      subtitle={target ? `${target.name} (${target.key_prefix}...) in ${target.organisation_name || 'unknown organisation'}` : ''}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="danger" icon={Ban} busy={busy} disabled={!!invalid} onClick={submit}>Revoke key</Btn>
      </>}>
      <div className="space-y-3">
        <Note icon={AlertTriangle} tone="warning">
          Revoking is immediate and permanent. The integration that uses this key stops working at once. Issue a replacement first if it is still needed.
        </Note>
        <label className="block text-xs text-gray-400">
          Reason (recorded in the audit trail)
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500}
            className="mt-1 w-full rounded-lg bg-gray-900 border border-gray-800 p-2 text-xs text-gray-200 focus:border-gray-700 focus:outline-none"
            placeholder="For example: key found in a public repository" />
        </label>
        {err && <p className="text-xs text-red-300">{err}</p>}
      </div>
    </Modal>
  )
}

function ExpiryModal({ target, onClose, onDone }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => { setValue(toInputDate(target?.expires_at)); setErr(null) }, [target])
  const iso = value ? new Date(`${value}T23:59:59`).toISOString() : null
  const invalid = expiryError(iso)
  const save = async (next) => {
    const problem = expiryError(next)
    if (problem) { setErr(problem); return }
    setBusy(true); setErr(null)
    try {
      await setApiKeyExpiry(target.id, next)
      onDone(next ? `Expiry set to ${fmtDate(next)}.` : 'Expiry removed.')
    } catch (e) {
      setErr(toUserMessage(e, 'Could not change the expiry.'))
    } finally { setBusy(false) }
  }
  return (
    <Modal open={!!target} onClose={onClose} title="Set key expiry"
      subtitle={target ? `${target.name} (${target.key_prefix}...). Current expiry: ${fmtDate(target.expires_at)}` : ''}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        {target?.expires_at && <Btn busy={busy} onClick={() => save(null)} title="The key never expires">Remove expiry</Btn>}
        <Btn variant="primary" icon={CalendarClock} busy={busy} disabled={!iso || !!invalid} onClick={() => save(iso)}>Save expiry</Btn>
      </>}>
      {target && (
        <div className="space-y-3">
          <Toolbar>
            {[30, 90, 180, 365].map((d) => (
              <Btn key={d} size="xs" onClick={() => setValue(toInputDate(extendedExpiry(target.expires_at, d)))}>+{d} days</Btn>
            ))}
          </Toolbar>
          <label className="block text-xs text-gray-400">
            Expires on (end of day)
            <input type="date" value={value} onChange={(e) => setValue(e.target.value)}
              className="mt-1 block rounded-lg bg-gray-900 border border-gray-800 px-2.5 py-1.5 text-xs text-gray-200 focus:border-gray-700 focus:outline-none" />
          </label>
          {(err || (value && invalid)) && <p className="text-xs text-red-300">{err || invalid}</p>}
        </div>
      )}
    </Modal>
  )
}

export default function ConsoleApiKeys() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [org, setOrg] = useState('')
  const [sort, setSort] = useState({ key: 'created_at', dir: 'desc' })
  const [revokeTarget, setRevokeTarget] = useState(null)
  const [expiryTarget, setExpiryTarget] = useState(null)
  const [flash, setFlash] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await listAllApiKeys()) } catch (e) { setError(toUserMessage(e, 'Could not load API keys.')) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const decorated = useMemo(() => decorateKeys(data?.keys || [], { maxAgeDays: data?.maxAgeDays }), [data])
  const summary = useMemo(() => summarizeKeys(decorated), [decorated])
  const orgOptions = useMemo(() => {
    const m = new Map()
    for (const k of decorated) if (k.organisation_id) m.set(k.organisation_id, k.organisation_name || k.organisation_id)
    return [...m.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [decorated])

  const rows = useMemo(() => {
    const list = filterKeys(decorated, { status, search, org })
    const dir = sort.dir === 'asc' ? 1 : -1
    const val = (k) => {
      const v = k[sort.key]
      if (v === null || v === undefined) return null
      return typeof v === 'number' ? v : String(v)
    }
    return [...list].sort((a, b) => {
      const x = val(a); const y = val(b)
      if (x === y) return 0
      if (x === null) return 1
      if (y === null) return -1
      return (x > y ? 1 : -1) * dir
    })
  }, [decorated, status, search, org, sort])

  const onSort = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))

  const usageSeries = useMemo(() => {
    const byMinute = new Map((data?.usageLastHour || []).map((p) => [new Date(p.minute).getTime(), Number(p.count) || 0]))
    const end = Math.floor(Date.now() / 60000) * 60000
    const labels = []; const values = []
    for (let i = 59; i >= 0; i -= 1) {
      const t = end - i * 60000
      labels.push(new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
      values.push(byMinute.get(t) || 0)
    }
    return { labels, values }
  }, [data])

  const doExport = () => {
    exportToExcel(
      rows.map((k) => ({
        name: k.name, organisation: k.organisation_name || '', prefix: k.key_prefix,
        scopes: (k.scopes || []).join(', '), status: STATUS_META[k.status].label,
        created_by: k.created_by_name || '', created_at: fmtWhen(k.created_at),
        last_used_at: fmtWhen(k.last_used_at), expires_at: fmtDate(k.expires_at),
        age_days: k.ageDays ?? 'N/A', requests_last_hour: k.requests_last_hour ?? 0,
        findings: k.flags.map((f) => FLAG_META[f].label).join('; '),
        revoked_at: fmtWhen(k.revoked_at), revoke_reason: k.revoke_reason || '',
      })),
      ['name', 'organisation', 'prefix', 'scopes', 'status', 'created_by', 'created_at', 'last_used_at', 'expires_at', 'age_days', 'requests_last_hour', 'findings', 'revoked_at', 'revoke_reason'],
      ['Name', 'Organisation', 'Prefix', 'Scopes', 'Status', 'Created by', 'Created', 'Last used', 'Expires', 'Age (days)', 'Requests (last hour)', 'Findings', 'Revoked', 'Revoke reason'],
      reportFileName('API Keys', new Date().toISOString().slice(0, 10)),
      'API Keys',
    )
  }

  const done = (msg) => { setRevokeTarget(null); setExpiryTarget(null); setFlash(msg); load() }

  const tabs = [
    { key: 'all', label: 'All', count: summary.total },
    { key: 'attention', label: 'Needs attention', count: summary.needsAttention },
    { key: 'active', label: 'Active', count: summary.active },
    { key: 'expired', label: 'Expired', count: summary.expired },
    { key: 'revoked', label: 'Revoked', count: summary.revoked },
  ]

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1><KeyRound size={18} className="text-orange-400" /> API Keys</h1>
          <p className="text-xs text-gray-500 mt-1">
            Every public API key across all organisations. Only the prefix is shown; the secret is never stored. Last read {fmtWhen(data?.generatedAt)}.
          </p>
        </div>
        <Toolbar>
          <Btn icon={RefreshCw} onClick={load} busy={loading}>Refresh</Btn>
          <Btn icon={Download} onClick={doExport} disabled={!rows.length}>Export</Btn>
        </Toolbar>
      </header>

      {flash && <Note icon={Info} tone="accent">{flash}</Note>}

      {loading && !data ? <LoadingState label="Loading API keys" /> : error ? <ErrorState message={error} onRetry={load} /> : (
        <>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Keys" value={summary.total} sub={`${summary.orgs} organisation${summary.orgs === 1 ? '' : 's'}`} icon={KeyRound} />
            <StatTile label="Active" value={summary.active} tone="good" onClick={() => setStatus('active')} active={status === 'active'} />
            <StatTile label="Needs attention" value={summary.needsAttention} tone={summary.needsAttention ? 'warning' : 'muted'} onClick={() => setStatus('attention')} active={status === 'attention'} />
            <StatTile label={`Older than ${ROTATE_AFTER_DAYS}d`} value={summary.rotate} tone={summary.rotate ? 'warning' : 'muted'} onClick={() => setStatus('rotate')} active={status === 'rotate'} />
            <StatTile label={`Unused ${STALE_AFTER_DAYS}d+`} value={summary.stale} tone={summary.stale ? 'warning' : 'muted'} onClick={() => setStatus('stale')} active={status === 'stale'} />
            <StatTile label="No expiry" value={summary.no_expiry} tone={summary.no_expiry ? 'accent' : 'muted'} onClick={() => setStatus('no_expiry')} active={status === 'no_expiry'} />
          </div>

          <Panel>
            <PanelHeader icon={AlertTriangle} title="Key policy" tone="warning"
              subtitle="Findings are advice. Nothing is revoked automatically." />
            <div className="grid gap-2 md:grid-cols-2 text-xs text-gray-400">
              <p>
                Maximum key age policy:{' '}
                {data?.maxAgeDays
                  ? <span className="text-gray-200">{data.maxAgeDays} days</span>
                  : <span className="text-gray-200">not set</span>}
                {data?.maxAgeDays ? ` (${summary.over_policy} active key${summary.over_policy === 1 ? '' : 's'} over it)` : ''}.
                {' '}Set <Code>api_key_max_age_days</Code> in System Configuration; 0 turns the finding off.
              </p>
              <p>
                Keys can be minted with no expiry ({summary.no_expiry} active key{summary.no_expiry === 1 ? ' has' : 's have'} none).
                Rotate keys older than {ROTATE_AFTER_DAYS} days and revoke keys unused for {STALE_AFTER_DAYS} days.
              </p>
            </div>
          </Panel>

          <Panel>
            <PanelHeader icon={Activity} title="Requests in the last hour"
              subtitle={`${summary.requestsLastHour} authenticated call${summary.requestsLastHour === 1 ? '' : 's'} across all keys.`} />
            <TrendChart labels={usageSeries.labels} series={[{ label: 'Requests', values: usageSeries.values }]} height={160}
              summary={`${summary.requestsLastHour} requests in the last 60 minutes`}
              emptyText="No API calls in the last hour." />
            <p className="text-[11px] text-gray-500 mt-2">
              Only the last 60 minutes exist: the per-minute counter behind rate limiting is pruned to one hour on every call, and there is no per-request log. Older activity is known only through each key&apos;s last used time.
            </p>
          </Panel>

          <Panel flush>
            <div className="p-4 pb-3 space-y-3">
              <PanelHeader icon={KeyRound} title="Keys" subtitle={`${rows.length} of ${summary.total} shown`} />
              <Toolbar>
                <Segmented options={tabs} value={Object.keys(FLAG_META).includes(status) ? '' : status} onChange={setStatus} ariaLabel="Filter by status" />
                <SearchInput value={search} onChange={setSearch} placeholder="Search name, prefix, organisation, creator" className="w-72" />
                <Select value={org} onChange={setOrg} options={orgOptions} placeholder="All organisations" className="w-52" />
                {FLAG_META[status] && <Badge tone={FLAG_META[status].tone}>Finding: {FLAG_META[status].label}</Badge>}
              </Toolbar>
            </div>
            {!summary.total ? (
              <div className="p-4 pt-0">
                <EmptyState icon={KeyRound} title="No API keys yet"
                  reason="No organisation has created a public API key. Keys are created by an organisation admin in the Developer Portal." />
              </div>
            ) : !rows.length ? (
              <div className="p-4 pt-0">
                <EmptyState title="No keys match" reason="No key matches the current filters." />
              </div>
            ) : (
              <Table className="rounded-none border-x-0 border-b-0">
                <THead>
                  <Th sortKey="name" sort={sort} onSort={onSort}>Key</Th>
                  <Th sortKey="organisation_name" sort={sort} onSort={onSort}>Organisation</Th>
                  <Th>Scopes</Th>
                  <Th sortKey="created_at" sort={sort} onSort={onSort}>Created</Th>
                  <Th sortKey="last_used_at" sort={sort} onSort={onSort}>Last used</Th>
                  <Th sortKey="expires_at" sort={sort} onSort={onSort}>Expires</Th>
                  <Th>Status</Th>
                  <Th>Findings</Th>
                  <Th align="right">Actions</Th>
                </THead>
                <tbody>
                  {rows.map((k) => (
                    <Tr key={k.id} tone={k.flags.length ? 'warning' : undefined}>
                      <Td>
                        <div className="text-gray-200">{k.name}</div>
                        <div className="mt-0.5"><Code>{k.key_prefix}...</Code></div>
                      </Td>
                      <Td><span className="inline-flex items-center gap-1 text-gray-300"><Building2 size={11} className="text-gray-600" />{k.organisation_name || 'Unknown'}</span></Td>
                      <Td>{(k.scopes || []).map((s) => <Badge key={s} tone="quiet">{s}</Badge>)}</Td>
                      <Td nowrap>
                        <div className="text-gray-300">{fmtDate(k.created_at)}</div>
                        <div className="text-[11px] text-gray-500">{k.created_by_name || 'Unknown'}{k.ageDays !== null ? `, ${k.ageDays}d old` : ''}</div>
                      </Td>
                      <Td nowrap>
                        <div className="text-gray-300">{k.last_used_at ? fmtWhen(k.last_used_at) : 'Never'}</div>
                        {k.requests_last_hour > 0 && <div className="text-[11px] text-gray-500">{k.requests_last_hour} in last hour</div>}
                      </Td>
                      <Td nowrap>
                        <div className="text-gray-300">{k.expires_at ? fmtDate(k.expires_at) : 'Never'}</div>
                        {k.expiresInDays !== null && k.status === 'active' && <div className="text-[11px] text-gray-500">in {k.expiresInDays}d</div>}
                      </Td>
                      <Td>
                        <Badge tone={STATUS_META[k.status].tone}>{STATUS_META[k.status].label}</Badge>
                        {k.status === 'revoked' && k.revoke_reason && (
                          <div className="text-[11px] text-gray-500 mt-1 max-w-[14rem]" title={k.revoke_reason}>
                            {fmtDate(k.revoked_at)}{k.revoked_by_name ? ` by ${k.revoked_by_name}` : ''}: {k.revoke_reason}
                          </div>
                        )}
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {k.flags.length ? k.flags.map((f) => (
                            <Badge key={f} tone={FLAG_META[f].tone} title={FLAG_META[f].hint}>{FLAG_META[f].label}</Badge>
                          )) : <span className="text-gray-600">None</span>}
                        </div>
                      </Td>
                      <Td align="right" nowrap>
                        {k.status === 'revoked' ? <span className="text-gray-600">No actions</span> : (
                          <span className="inline-flex gap-1.5">
                            <Btn size="xs" icon={CalendarClock} onClick={() => { setFlash(null); setExpiryTarget(k) }}>Expiry</Btn>
                            <Btn size="xs" variant="danger" icon={Ban} onClick={() => { setFlash(null); setRevokeTarget(k) }}>Revoke</Btn>
                          </span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </>
      )}

      {revokeTarget && <RevokeModal target={revokeTarget} onClose={() => setRevokeTarget(null)} onDone={done} />}
      {expiryTarget && <ExpiryModal target={expiryTarget} onClose={() => setExpiryTarget(null)} onDone={done} />}
    </div>
  )
}
