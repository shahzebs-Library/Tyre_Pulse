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
  KeyRound, Ban, CalendarClock, FileSpreadsheet, FileText, AlertTriangle, Info, Activity, Building2,
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
import { exportConsoleRows, sortRows, useTableSort } from '../../lib/consoleTable'
import { PageHeader, useUrlTab, useRefreshStamp, usePaged, Pager, Drawer, DetailList, AttentionList } from './shared/pageKit'

const TABS = ['keys', 'usage']

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
  const { sort, onSort } = useTableSort({ key: 'created_at', dir: 'desc' })
  const [revokeTarget, setRevokeTarget] = useState(null)
  const [expiryTarget, setExpiryTarget] = useState(null)
  const [detail, setDetail] = useState(null)
  const [flash, setFlash] = useState(null)
  const [tab, setTab] = useUrlTab(TABS, 'keys')
  const { refreshedAt, stamp } = useRefreshStamp()

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await listAllApiKeys()); stamp() } catch (e) { setError(toUserMessage(e, 'Could not load API keys.')) }
    finally { setLoading(false) }
  }, [stamp])
  useEffect(() => { load() }, [load])

  const decorated = useMemo(() => decorateKeys(data?.keys || [], { maxAgeDays: data?.maxAgeDays }), [data])
  const summary = useMemo(() => summarizeKeys(decorated), [decorated])
  const orgOptions = useMemo(() => {
    const m = new Map()
    for (const k of decorated) if (k.organisation_id) m.set(k.organisation_id, k.organisation_name || k.organisation_id)
    return [...m.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [decorated])

  const rows = useMemo(() => sortRows(filterKeys(decorated, { status, search, org }), sort), [decorated, status, search, org, sort])
  const paged = usePaged(rows, 20, `${status}|${search}|${org}|${sort?.key}|${sort?.dir}`)

  // Keys per organisation: which tenant carries the rotation debt.
  const byOrg = useMemo(() => {
    const m = new Map()
    for (const k of decorated) {
      const key = k.organisation_id || 'unknown'
      const o = m.get(key) || { id: key, name: k.organisation_name || 'Unknown', total: 0, active: 0, attention: 0, requests: 0 }
      o.total += 1
      if (k.status === 'active') o.active += 1
      if (k.flags.length) o.attention += 1
      o.requests += Number(k.requests_last_hour) || 0
      m.set(key, o)
    }
    return [...m.values()].sort((a, b) => b.attention - a.attention || b.total - a.total)
  }, [decorated])

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

  const [exporting, setExporting] = useState('')
  const [exportError, setExportError] = useState(null)
  const doExport = async (format) => {
    setExporting(format); setExportError(null)
    try {
      await exportConsoleRows({
        rows,
        title: 'API Keys',
        format,
        columns: [
          { key: 'name', header: 'Name' },
          { key: 'organisation_name', header: 'Organisation' },
          { key: 'key_prefix', header: 'Prefix' },
          { key: 'scopes', header: 'Scopes', value: (k) => (k.scopes || []).join(', ') },
          { key: 'status', header: 'Status', value: (k) => STATUS_META[k.status].label },
          { key: 'created_by_name', header: 'Created by' },
          { key: 'created_at', header: 'Created', value: (k) => fmtWhen(k.created_at) },
          { key: 'last_used_at', header: 'Last used', value: (k) => fmtWhen(k.last_used_at) },
          { key: 'expires_at', header: 'Expires', value: (k) => fmtDate(k.expires_at) },
          { key: 'ageDays', header: 'Age (days)', value: (k) => k.ageDays ?? 'N/A' },
          { key: 'requests_last_hour', header: 'Requests (last hour)', value: (k) => k.requests_last_hour ?? 0 },
          { key: 'findings', header: 'Findings', value: (k) => k.flags.map((f) => FLAG_META[f].label).join('; ') },
          { key: 'revoked_at', header: 'Revoked', value: (k) => (k.revoked_at ? fmtWhen(k.revoked_at) : '') },
          { key: 'revoke_reason', header: 'Revoke reason' },
        ],
      })
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not create the export file.'))
    } finally {
      setExporting('')
    }
  }

  const done = (msg) => { setRevokeTarget(null); setExpiryTarget(null); setFlash(msg); load() }
  // Actions opened from the drawer close it first so two dialogs never stack.
  const openRevoke = (k) => { setDetail(null); setFlash(null); setRevokeTarget(k) }
  const openExpiry = (k) => { setDetail(null); setFlash(null); setExpiryTarget(k) }
  const pick = (st) => { setStatus(status === st ? 'all' : st); setTab('keys') }

  const tabs = [
    { key: 'all', label: 'All', count: summary.total },
    { key: 'attention', label: 'Needs attention', count: summary.needsAttention },
    { key: 'active', label: 'Active', count: summary.active },
    { key: 'expired', label: 'Expired', count: summary.expired },
    { key: 'revoked', label: 'Revoked', count: summary.revoked },
  ]

  const attention = useMemo(() => {
    const out = []
    if (summary.over_policy) out.push({ key: 'over', tone: 'danger', title: `${summary.over_policy} key${summary.over_policy === 1 ? ' is' : 's are'} over the maximum age policy`, detail: FLAG_META.over_policy.hint, action: { label: 'Show', onClick: () => { setStatus('over_policy'); setTab('keys') } } })
    if (summary.stale) out.push({ key: 'stale', tone: 'warning', title: `${summary.stale} key${summary.stale === 1 ? ' has' : 's have'} not been used in ${STALE_AFTER_DAYS} days`, detail: FLAG_META.stale.hint, action: { label: 'Show', onClick: () => { setStatus('stale'); setTab('keys') } } })
    if (summary.rotate) out.push({ key: 'rotate', tone: 'warning', title: `${summary.rotate} key${summary.rotate === 1 ? ' is' : 's are'} older than ${ROTATE_AFTER_DAYS} days`, detail: FLAG_META.rotate.hint, action: { label: 'Show', onClick: () => { setStatus('rotate'); setTab('keys') } } })
    if (summary.expiring) out.push({ key: 'expiring', tone: 'info', title: `${summary.expiring} key${summary.expiring === 1 ? ' expires' : 's expire'} soon`, detail: FLAG_META.expiring.hint, action: { label: 'Show', onClick: () => { setStatus('expiring'); setTab('keys') } } })
    return out
  }, [summary, setTab])

  function actionsFor(k) {
    if (k.status === 'revoked') return <span className="text-gray-400">No actions</span>
    return (
      <span className="inline-flex gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Btn size="xs" icon={CalendarClock} onClick={() => openExpiry(k)}>Expiry</Btn>
        <Btn size="xs" variant="danger" icon={Ban} onClick={() => openRevoke(k)}>Revoke</Btn>
      </span>
    )
  }

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader icon={KeyRound} title="API Keys"
        purpose={`Every public API key across all organisations. Only the prefix is shown; the secret is never stored. Last read ${fmtWhen(data?.generatedAt)}.`}
        actions={(
          <>
            <Btn icon={FileSpreadsheet} onClick={() => doExport('excel')} busy={exporting === 'excel'} disabled={!!error || !rows.length}>Excel</Btn>
            <Btn icon={FileText} onClick={() => doExport('pdf')} busy={exporting === 'pdf'} disabled={!!error || !rows.length}>PDF</Btn>
          </>
        )}
        refreshedAt={refreshedAt} onRefresh={load} refreshing={loading} />

      {flash && <Note icon={Info} tone="accent">{flash}</Note>}
      {exportError && <ErrorState message={exportError} />}

      {loading && !data ? <LoadingState label="Loading API keys" /> : error ? <ErrorState message={error} onRetry={load} /> : (
        <>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Keys" value={summary.total} sub={`${summary.orgs} organisation${summary.orgs === 1 ? '' : 's'}`} icon={KeyRound}
              onClick={() => pick('all')} active={status === 'all'} />
            <StatTile label="Active" value={summary.active} tone="good" onClick={() => pick('active')} active={status === 'active'} />
            <StatTile label="Needs attention" value={summary.needsAttention} tone={summary.needsAttention ? 'warning' : 'muted'} onClick={() => pick('attention')} active={status === 'attention'} />
            <StatTile label={`Older than ${ROTATE_AFTER_DAYS}d`} value={summary.rotate} tone={summary.rotate ? 'warning' : 'muted'} onClick={() => pick('rotate')} active={status === 'rotate'} />
            <StatTile label={`Unused ${STALE_AFTER_DAYS}d+`} value={summary.stale} tone={summary.stale ? 'warning' : 'muted'} onClick={() => pick('stale')} active={status === 'stale'} />
            <StatTile label="No expiry" value={summary.no_expiry} tone={summary.no_expiry ? 'accent' : 'muted'} onClick={() => pick('no_expiry')} active={status === 'no_expiry'} />
          </div>

          <Segmented ariaLabel="API key views" value={tab} onChange={setTab} options={[
            { key: 'keys', label: 'Keys', count: summary.total },
            { key: 'usage', label: 'Usage, policy and tenants' },
          ]} />

          {tab === 'keys' && (
            <div role="tabpanel" aria-label="Keys" className="space-y-4">
              <AttentionList items={attention} clearText="No key is over policy, stale, old or about to expire." />
              <Panel flush>
                <div className="p-4 pb-3 space-y-3">
                  <PanelHeader icon={KeyRound} title="Keys" subtitle={`${rows.length} of ${summary.total} shown. Select a row for its full record.`} />
                  <Toolbar>
                    <Segmented options={tabs} value={Object.keys(FLAG_META).includes(status) ? '' : status} onChange={setStatus} ariaLabel="Filter by status" />
                    <SearchInput value={search} onChange={setSearch} placeholder="Search name, prefix, organisation, creator" className="w-72" />
                    <Select value={org} onChange={setOrg} options={orgOptions} placeholder="All organisations" ariaLabel="Filter by organisation" className="w-52" />
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
                  <>
                    <Table className="rounded-none border-x-0 border-b-0">
                      <THead>
                        <Th sortKey="name" sort={sort} onSort={onSort}>Key</Th>
                        <Th sortKey="organisation_name" sort={sort} onSort={onSort}>Organisation</Th>
                        <Th sortKey="last_used_at" sort={sort} onSort={onSort}>Last used</Th>
                        <Th sortKey="expires_at" sort={sort} onSort={onSort}>Expires</Th>
                        <Th sortKey="status" sort={sort} onSort={onSort}>Status</Th>
                        <Th>Findings</Th>
                        <Th align="right">Actions</Th>
                      </THead>
                      <tbody>
                        {paged.pageRows.map((k) => (
                          <Tr key={k.id} tone={k.flags.length ? 'warning' : undefined} onClick={() => setDetail(k)} ariaLabel={`Open key ${k.name}`}>
                            <Td>
                              <div className="text-gray-200">{k.name}</div>
                              <div className="mt-0.5"><Code>{k.key_prefix}...</Code></div>
                            </Td>
                            <Td><span className="inline-flex items-center gap-1 text-gray-300"><Building2 size={11} className="text-gray-500" aria-hidden="true" />{k.organisation_name || 'Unknown'}</span></Td>
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
                                )) : <span className="text-gray-400">None</span>}
                              </div>
                            </Td>
                            <Td align="right" nowrap>{actionsFor(k)}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                    <Pager {...paged} onPage={paged.setPage} />
                  </>
                )}
              </Panel>
            </div>
          )}

          {tab === 'usage' && (
            <div role="tabpanel" aria-label="Usage, policy and tenants" className="space-y-4">
              <Panel>
                <PanelHeader icon={Activity} title="Requests in the last hour"
                  subtitle={`${summary.requestsLastHour} authenticated call${summary.requestsLastHour === 1 ? '' : 's'} across all keys.`} />
                <TrendChart labels={usageSeries.labels} series={[{ label: 'Requests', values: usageSeries.values }]} height={160}
                  summary={`${summary.requestsLastHour} requests in the last 60 minutes`}
                  emptyText="No API calls in the last hour." />
                <p className="text-[11px] text-gray-400 mt-2">
                  Only the last 60 minutes exist: the per-minute counter behind rate limiting is pruned to one hour on every call, and there is no per-request log. Older activity is known only through each key&apos;s last used time.
                </p>
              </Panel>
              <div className="grid gap-4 lg:grid-cols-2">
                <Panel>
                  <PanelHeader icon={AlertTriangle} title="Key policy" tone="warning"
                    subtitle="Findings are advice. Nothing is revoked automatically." />
                  <div className="space-y-2 text-xs text-gray-400">
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
                <Panel flush>
                  <div className="p-4 pb-2"><PanelHeader icon={Building2} title="Keys by organisation" subtitle="Tenants carrying the most findings first" /></div>
                  {byOrg.length === 0 ? (
                    <div className="px-4 pb-4"><EmptyState title="No keys" reason="No organisation has an API key yet." /></div>
                  ) : (
                    <Table className="border-0 rounded-none">
                      <THead><Th>Organisation</Th><Th align="right">Keys</Th><Th align="right">Active</Th><Th align="right">Findings</Th><Th align="right">Calls (1h)</Th></THead>
                      <tbody>
                        {byOrg.map((o) => (
                          <Tr key={o.id} onClick={o.id !== 'unknown' ? () => { setOrg(o.id); setStatus('all'); setTab('keys') } : undefined}
                            ariaLabel={`Show keys for ${o.name}`}>
                            <Td className="text-gray-200">{o.name}</Td>
                            <Td align="right" className="tabular-nums">{o.total}</Td>
                            <Td align="right" className="tabular-nums">{o.active}</Td>
                            <Td align="right">{o.attention ? <Badge tone="warning">{o.attention}</Badge> : <span className="text-gray-500 tabular-nums">0</span>}</Td>
                            <Td align="right" className="tabular-nums">{o.requests}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </Panel>
              </div>
            </div>
          )}
        </>
      )}

      <Drawer open={!!detail} title={detail?.name} subtitle={detail ? `${detail.key_prefix}... in ${detail.organisation_name || 'unknown organisation'}` : undefined}
        onClose={() => setDetail(null)} footer={detail ? actionsFor(detail) : null}>
        {detail && (
          <>
            <DetailList items={[
              ['Status', STATUS_META[detail.status].label],
              ['Scopes', (detail.scopes || []).join(', ')],
              ['Created', `${fmtWhen(detail.created_at)}${detail.created_by_name ? ` by ${detail.created_by_name}` : ''}`],
              ['Age', detail.ageDays == null ? null : `${detail.ageDays} days`],
              ['Last used', detail.last_used_at ? fmtWhen(detail.last_used_at) : 'Never'],
              ['Calls (last hour)', String(detail.requests_last_hour ?? 0)],
              ['Expires', detail.expires_at ? fmtDate(detail.expires_at) : 'Never'],
              detail.status === 'revoked' && ['Revoked', `${fmtWhen(detail.revoked_at)}${detail.revoked_by_name ? ` by ${detail.revoked_by_name}` : ''}`],
              detail.status === 'revoked' && ['Revoke reason', detail.revoke_reason],
            ]} />
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Findings</p>
              {detail.flags.length === 0 ? <p className="text-xs text-gray-400">None.</p> : (
                <ul className="space-y-1.5">
                  {detail.flags.map((f) => (
                    <li key={f} className="text-xs text-gray-300"><Badge tone={FLAG_META[f].tone}>{FLAG_META[f].label}</Badge> <span className="text-gray-400">{FLAG_META[f].hint}</span></li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </Drawer>

      {revokeTarget && <RevokeModal target={revokeTarget} onClose={() => setRevokeTarget(null)} onDone={done} />}
      {expiryTarget && <ExpiryModal target={expiryTarget} onClose={() => setExpiryTarget(null)} onDone={done} />}
    </div>
  )
}
