/**
 * ConsoleReleases.jsx - the release and impact center.
 *
 * When a number changes, the first question is "what did we ship?". This page
 * records every release and the metrics or assets it touched, so a figure that
 * moves can be traced back to the deployment that moved it.
 *
 * An impact is a claim about cause, so it is entered deliberately per release,
 * never inferred.
 *
 * Layout: three tabs synced to ?tab=. Releases (searchable, paged, with a
 * "no impact recorded" filter; a row opens the release and its impact form in a
 * side drawer), Impacts (every recorded impact across releases, searchable and
 * exportable) and Insights (releases per month, impacts by type, and the
 * metrics that releases touch most).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Rocket, Tag, Plus, AlertTriangle, CheckCircle2, Clock, ExternalLink, BarChart3, HelpCircle,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Toolbar, Modal, SearchInput, Segmented,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState,
} from '../components/ui'
import { sortRows, searchRows, useTableSort } from '../../lib/consoleTable'
import ExportButtons from './shared/ExportButtons'
import { listReleases, recordRelease, addReleaseImpact } from '../../lib/api/lineageOps'
import { toUserMessage } from '../../lib/safeError'
import { BarsChart, TrendChart } from '../components/ui/charts'
import PageHeader, { fmtRelative } from './ops/PageHeader'
import TabBar from './ops/TabBar'
import useUrlTab from './ops/useUrlTab'
import usePaged from './ops/usePaged'
import Pager from './ops/Pager'
import SideDrawer from './ops/SideDrawer'

const TABS = ['releases', 'impacts', 'insights']
const IMPACT_EXPORT_COLUMNS = [
  { key: 'version', header: 'Release' },
  { key: 'metric_id', header: 'Metric' },
  { key: 'asset_id', header: 'Asset' },
  { key: 'impact_type', header: 'Type' },
  { key: 'note', header: 'Note' },
]

const nf = new Intl.NumberFormat('en-US')

function fmtWhen(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const IMPACT_TONE = { increase: 'good', decrease: 'danger', fix: 'accent', change: 'info' }

export default function ConsoleReleases() {
  const [state, setState] = useState({ loading: true, error: null, releases: [], impacts: [] })
  const [flash, setFlash] = useState(null) // {tone, text}

  // record-release modal
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ version: '', notes: '' })
  const [savingRelease, setSavingRelease] = useState(false)

  // detail modal
  const [detail, setDetail] = useState(null) // release row
  const [impactForm, setImpactForm] = useState({ metric: '', asset: '', impact: '', note: '' })
  const [savingImpact, setSavingImpact] = useState(false)
  const [tab, setTab] = useUrlTab(TABS, 'releases')
  const [readAt, setReadAt] = useState(null)
  const [coverage, setCoverage] = useState('all')
  const [impactQuery, setImpactQuery] = useState('')

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const { releases, impacts } = await listReleases()
      setState({ loading: false, error: null, releases, impacts })
      setReadAt(Date.now())
      return { releases, impacts }
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e), releases: [], impacts: [] })
      return null
    }
  }, [])

  useEffect(() => { load() }, [load])

  const impactsByRelease = useMemo(() => {
    const m = new Map()
    for (const it of state.impacts) {
      const arr = m.get(it.release_id) || []
      arr.push(it)
      m.set(it.release_id, arr)
    }
    return m
  }, [state.impacts])

  const [query, setQuery] = useState('')
  const { sort, onSort } = useTableSort(null)
  const visibleReleases = useMemo(() => sortRows(
    searchRows(state.releases.filter((r) => {
      const n = impactsByRelease.get(r.id)?.length || 0
      return coverage === 'all' || (coverage === 'none' ? n === 0 : n > 0)
    }), query, ['version', 'notes']),
    sort,
    { impacts: (r) => impactsByRelease.get(r.id)?.length || 0 },
  ), [state.releases, query, sort, impactsByRelease, coverage])
  const paged = usePaged(visibleReleases)
  const noImpactCount = useMemo(() => state.releases.filter((r) => !(impactsByRelease.get(r.id)?.length)).length, [state.releases, impactsByRelease])
  const lastRelease = useMemo(() => state.releases.reduce((a, r) => (r.released_at && (!a || r.released_at > a) ? r.released_at : a), null), [state.releases])

  const releaseById = useMemo(() => new Map(state.releases.map((r) => [r.id, r])), [state.releases])
  const allImpacts = useMemo(() => state.impacts.map((it) => ({ ...it, version: releaseById.get(it.release_id)?.version || 'N/A' })), [state.impacts, releaseById])
  const { sort: impactSort, onSort: onImpactSort } = useTableSort(null)
  const visibleImpacts = useMemo(() => sortRows(
    searchRows(allImpacts, impactQuery, ['version', 'metric_id', 'asset_id', 'impact_type', 'note']), impactSort,
  ), [allImpacts, impactQuery, impactSort])
  const impactPaged = usePaged(visibleImpacts)

  const perMonth = useMemo(() => {
    const m = new Map()
    for (const r of state.releases) {
      const k = String(r.released_at || '').slice(0, 7)
      if (k) m.set(k, (m.get(k) || 0) + 1)
    }
    const keys = [...m.keys()].sort().slice(-12)
    return { labels: keys, values: keys.map((k) => m.get(k)) }
  }, [state.releases])
  const byType = useMemo(() => {
    const m = new Map()
    for (const it of state.impacts) {
      const k = it.impact_type ? String(it.impact_type).toLowerCase() : 'unspecified'
      m.set(k, (m.get(k) || 0) + 1)
    }
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  }, [state.impacts])
  const topMetrics = useMemo(() => {
    const m = new Map()
    for (const it of state.impacts) if (it.metric_id) m.set(it.metric_id, (m.get(it.metric_id) || 0) + 1)
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8)
  }, [state.impacts])
  const exportColumns = useMemo(() => ([
    { key: 'version', header: 'Version' },
    { key: 'notes', header: 'Notes' },
    { key: 'released_at', header: 'Released at' },
    { key: 'impacts', header: 'Impacts', value: (r) => impactsByRelease.get(r.id)?.length || 0 },
  ]), [impactsByRelease])

  const detailImpacts = useMemo(
    () => (detail ? (impactsByRelease.get(detail.id) || []) : []),
    [detail, impactsByRelease],
  )

  const openCreate = () => { setForm({ version: '', notes: '' }); setCreating(true) }

  const saveRelease = async () => {
    const version = form.version.trim()
    if (!version) { setFlash({ tone: 'bad', text: 'A version is required to record a release.' }); return }
    setSavingRelease(true)
    try {
      await recordRelease(version, form.notes.trim() || null)
      setFlash({ tone: 'ok', text: `Release "${version}" recorded.` })
      setCreating(false)
      await load()
    } catch (e) {
      setFlash({ tone: 'bad', text: toUserMessage(e) })
    } finally {
      setSavingRelease(false)
    }
  }

  const saveImpact = async () => {
    if (!detail) return
    const metric = impactForm.metric.trim()
    const asset = impactForm.asset.trim()
    if (!metric && !asset) {
      setFlash({ tone: 'bad', text: 'Enter a metric id or an asset id for the impact.' })
      return
    }
    setSavingImpact(true)
    try {
      await addReleaseImpact(detail.id, {
        metric: metric || null,
        asset: asset || null,
        impact: impactForm.impact.trim() || null,
        note: impactForm.note.trim() || null,
      })
      setFlash({ tone: 'ok', text: 'Impact added.' })
      setImpactForm({ metric: '', asset: '', impact: '', note: '' })
      const res = await load()
      if (res) {
        const updated = res.releases.find((r) => r.id === detail.id)
        if (updated) setDetail(updated)
      }
    } catch (e) {
      setFlash({ tone: 'bad', text: toUserMessage(e) })
    } finally {
      setSavingImpact(false)
    }
  }

  const na = state.loading || state.error
  const showNoImpact = () => { setCoverage('none'); setQuery(''); setTab('releases') }
  const inputCls = 'w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-600 focus:border-gray-700 focus:outline-none'

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader icon={Rocket} title="Release & Impact Center"
        purpose="Record each release and the metrics or assets it affects, so a number change can be traced to a deployment."
        refreshedAt={readAt} onRefresh={load} refreshing={state.loading}
        actions={<Btn icon={Plus} variant="primary" onClick={openCreate}>Record release</Btn>} />

      {flash && (
        <Note icon={flash.tone === 'ok' ? CheckCircle2 : AlertTriangle} tone={flash.tone === 'ok' ? 'accent' : 'danger'}>
          {flash.text}
        </Note>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Releases" value={na ? 'N/A' : nf.format(state.releases.length)} icon={Tag}
          onClick={() => { setCoverage('all'); setTab('releases') }} active={tab === 'releases' && coverage === 'all'} />
        <StatTile label="Recorded impacts" value={na ? 'N/A' : nf.format(state.impacts.length)} icon={BarChart3}
          onClick={() => setTab('impacts')} active={tab === 'impacts'} />
        <StatTile label="No impact recorded" value={na ? 'N/A' : nf.format(noImpactCount)} icon={HelpCircle}
          tone={!na && noImpactCount ? 'warning' : 'default'} sub="Untraceable if a number moves"
          onClick={showNoImpact} active={tab === 'releases' && coverage === 'none'} />
        <StatTile label="Last release" value={na || !lastRelease ? 'N/A' : fmtRelative(lastRelease)} icon={Clock}
          sub={na || !lastRelease ? undefined : fmtWhen(lastRelease)} />
      </div>

      <TabBar tabs={[
        { key: 'releases', label: 'Releases', count: na ? undefined : state.releases.length },
        { key: 'impacts', label: 'Impacts', count: na ? undefined : state.impacts.length },
        { key: 'insights', label: 'Insights' },
      ]} value={tab} onChange={setTab} label="Release sections" />

      {tab === 'releases' && (
      <Panel>
        <PanelHeader icon={Tag} title="Releases" subtitle="Select a release to see and add its impacts."
          actions={(
            <Toolbar>
              <Segmented value={coverage} onChange={setCoverage} ariaLabel="Filter by impacts" role="group" options={[
                { key: 'all', label: 'All', count: state.releases.length },
                { key: 'with', label: 'With impacts', count: state.releases.length - noImpactCount },
                { key: 'none', label: 'No impact', count: noImpactCount },
              ]} />
              <SearchInput value={query} onChange={setQuery} placeholder="Search version or notes" className="w-full sm:w-56" ariaLabel="Search releases" />
              <ExportButtons rows={visibleReleases} columns={exportColumns} title="Releases" disabled={!!state.error} />
            </Toolbar>
          )} />

        {state.loading ? (
          <LoadingState label="Reading releases" rows={5} />
        ) : state.error ? (
          <div className="p-4 pt-0"><ErrorState message={state.error} onRetry={load} /></div>
        ) : state.releases.length === 0 ? (
          <EmptyState
            icon={Rocket}
            title="No releases recorded yet"
            reason="Record a release to start tracing number changes to deployments."
            action={<Btn icon={Plus} variant="primary" onClick={openCreate}>Record release</Btn>}
          />
        ) : visibleReleases.length === 0 ? (
          <EmptyState icon={Tag} title="No releases match this search"
            reason="Clear or change the search and filter to see every release."
            action={<Btn onClick={() => { setQuery(''); setCoverage('all') }}>Clear filters</Btn>} />
        ) : (
          <>
          <Table>
            <THead>
              <Th sortKey="version" sort={sort} onSort={onSort}>Version</Th>
              <Th sortKey="notes" sort={sort} onSort={onSort}>Notes</Th>
              <Th sortKey="released_at" sort={sort} onSort={onSort}>Released at</Th>
              <Th align="right" sortKey="impacts" sort={sort} onSort={onSort}>Impacts</Th>
            </THead>
            <tbody>
              {paged.rows.map((r) => (
                <Tr key={r.id} onClick={() => setDetail(r)} ariaLabel={`Open release ${r.version || ''}`.trim()}>
                  <Td><span className="font-medium text-gray-100">{r.version || 'N/A'}</span></Td>
                  <Td className="text-gray-400 break-words max-w-md">{r.notes || 'No notes'}</Td>
                  <Td nowrap>
                    <span className="inline-flex items-center gap-1 text-gray-400">
                      <Clock size={11} />{fmtWhen(r.released_at)}
                    </span>
                  </Td>
                  <Td align="right">
                    <Badge tone={(impactsByRelease.get(r.id)?.length || 0) ? 'accent' : 'quiet'}>
                      {nf.format(impactsByRelease.get(r.id)?.length || 0)}
                    </Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pager paged={paged} label="releases" />
          </>
        )}
      </Panel>
      )}

      {tab === 'impacts' && (
        <Panel>
          <PanelHeader icon={BarChart3} title="All recorded impacts" subtitle="Every metric or asset a release was recorded as touching. Select one to open its release."
            actions={(
              <Toolbar>
                <SearchInput value={impactQuery} onChange={setImpactQuery} placeholder="Search release, metric, asset or note" className="w-full sm:w-64" />
                <ExportButtons rows={visibleImpacts} columns={IMPACT_EXPORT_COLUMNS} title="Release Impacts" disabled={!!state.error} />
              </Toolbar>
            )} />
          {state.loading ? <LoadingState label="Reading impacts" /> : state.error ? (
            <ErrorState message={state.error} onRetry={load} />
          ) : allImpacts.length === 0 ? (
            <EmptyState icon={Tag} title="No impacts recorded yet" reason="Open a release and add the metrics or assets it affected." />
          ) : visibleImpacts.length === 0 ? (
            <EmptyState icon={Tag} title="No impacts match" reason="Clear the search to see every impact." />
          ) : (
            <>
              <Table>
                <THead>
                  <Th sortKey="version" sort={impactSort} onSort={onImpactSort}>Release</Th>
                  <Th sortKey="metric_id" sort={impactSort} onSort={onImpactSort}>Metric</Th>
                  <Th sortKey="asset_id" sort={impactSort} onSort={onImpactSort}>Asset</Th>
                  <Th sortKey="impact_type" sort={impactSort} onSort={onImpactSort}>Type</Th>
                  <Th>Note</Th>
                </THead>
                <tbody>
                  {impactPaged.rows.map((it) => (
                    <Tr key={it.id} onClick={() => { const r = releaseById.get(it.release_id); if (r) setDetail(r) }} ariaLabel={`Open release ${it.version}`}>
                      <Td nowrap><span className="text-gray-200">{it.version}</span></Td>
                      <Td nowrap><span className="font-mono text-gray-400">{it.metric_id || 'N/A'}</span></Td>
                      <Td nowrap><span className="font-mono text-gray-400">{it.asset_id || 'N/A'}</span></Td>
                      <Td>{it.impact_type ? <Badge tone={IMPACT_TONE[String(it.impact_type).toLowerCase()] || 'default'}>{it.impact_type}</Badge> : <span className="text-gray-500">N/A</span>}</Td>
                      <Td className="text-gray-300 break-words">{it.note || 'No note'}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <Pager paged={impactPaged} label="impacts" />
            </>
          )}
        </Panel>
      )}

      {tab === 'insights' && (
        state.error ? <ErrorState message={state.error} onRetry={load} /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel className="lg:col-span-2">
            <PanelHeader icon={Rocket} title="Releases per month" subtitle="The last 12 months with a recorded release." />
            {state.loading ? <LoadingState rows={2} /> : (
              <TrendChart labels={perMonth.labels} series={[{ label: 'Releases', values: perMonth.values }]} height={180} area={false}
                summary={perMonth.labels.map((l, i) => `${l} ${perMonth.values[i]}`).join(', ')} emptyText="No releases recorded yet." />
            )}
          </Panel>
          <Panel>
            <PanelHeader icon={Tag} title="Impacts by type" />
            {state.loading ? <LoadingState rows={2} /> : (
              <BarsChart bars={byType} summary={byType.map((b) => `${b.label} ${b.value}`).join(', ')} emptyText="No impacts recorded yet." />
            )}
          </Panel>
          <Panel>
            <PanelHeader icon={BarChart3} title="Metrics touched most" subtitle="Metrics that releases were recorded as affecting."
              actions={<a href="/console/metric-catalogue" className="text-xs text-orange-300 hover:text-orange-200 inline-flex items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">Metric catalogue <ExternalLink size={11} aria-hidden="true" /></a>} />
            {state.loading ? <LoadingState rows={2} /> : (
              <BarsChart bars={topMetrics} summary={topMetrics.map((b) => `${b.label} ${b.value}`).join(', ')} emptyText="No impact names a metric yet." />
            )}
          </Panel>
        </div>
        )
      )}

      {/* ── record release ─────────────────────────────────────────────────── */}
      <Modal
        open={creating}
        title="Record a release"
        subtitle="Name the version you shipped. Add its impacts afterwards from the release detail."
        onClose={() => { if (!savingRelease) setCreating(false) }}
        width="max-w-lg"
        footer={(
          <Toolbar className="justify-end">
            <Btn onClick={() => setCreating(false)} disabled={savingRelease}>Cancel</Btn>
            <Btn variant="primary" icon={CheckCircle2} onClick={saveRelease} busy={savingRelease} disabled={!form.version.trim()}>
              {savingRelease ? 'Saving...' : 'Record release'}
            </Btn>
          </Toolbar>
        )}
      >
        <div className="space-y-3">
          {flash?.tone === 'bad' && <ErrorState message={flash.text} />}
          <div>
            <label htmlFor="release-version" className="block text-xs text-gray-400 mb-1">Version <span className="text-red-400">*</span></label>
            <input
              id="release-version"
              value={form.version}
              onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))}
              placeholder="e.g. V474"
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="release-notes" className="block text-xs text-gray-400 mb-1">Notes</label>
            <textarea
              id="release-notes"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="What changed in this release"
              rows={3}
              className={inputCls}
            />
          </div>
        </div>
      </Modal>

      {/* ── release detail + impacts ───────────────────────────────────────── */}
      <SideDrawer
        open={!!detail}
        title={detail ? `Release ${detail.version || ''}`.trim() : ''}
        subtitle={detail ? `Released ${fmtWhen(detail.released_at)}` : ''}
        onClose={() => { setDetail(null); setImpactForm({ metric: '', asset: '', impact: '', note: '' }) }}
        width="max-w-2xl"
      >
        {detail && (
          <div className="space-y-4">
            {flash?.tone === 'bad' && <ErrorState message={flash.text} />}
            {detail.notes && <Note>{detail.notes}</Note>}

            <div>
              <h4 className="text-xs uppercase tracking-wide text-gray-400 mb-2">Recorded impacts</h4>
              {detailImpacts.length === 0 ? (
                <EmptyState
                  icon={Tag}
                  title="No impacts recorded"
                  reason="Add the metrics or assets this release affected below."
                />
              ) : (
                <Table>
                  <THead>
                    <Th>Metric</Th>
                    <Th>Asset</Th>
                    <Th>Type</Th>
                    <Th>Note</Th>
                  </THead>
                  <tbody>
                    {detailImpacts.map((it) => (
                      <Tr key={it.id}>
                        <Td nowrap><span className="font-mono text-gray-400">{it.metric_id || 'N/A'}</span></Td>
                        <Td nowrap><span className="font-mono text-gray-400">{it.asset_id || 'N/A'}</span></Td>
                        <Td>
                          {it.impact_type
                            ? <Badge tone={IMPACT_TONE[String(it.impact_type).toLowerCase()] || 'default'}>{it.impact_type}</Badge>
                            : <span className="text-gray-500">N/A</span>}
                        </Td>
                        <Td className="text-gray-300 break-words">{it.note || 'No note'}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-3">
              <h4 className="text-xs uppercase tracking-wide text-gray-400 mb-2">Add an impact</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label htmlFor="impact-metric" className="block text-[11px] text-gray-400 mb-1">Metric id</label>
                  <input
                    id="impact-metric"
                    value={impactForm.metric}
                    onChange={(e) => setImpactForm((f) => ({ ...f, metric: e.target.value }))}
                    placeholder="e.g. fleet_cpk"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label htmlFor="impact-asset" className="block text-[11px] text-gray-400 mb-1">Asset id</label>
                  <input
                    id="impact-asset"
                    value={impactForm.asset}
                    onChange={(e) => setImpactForm((f) => ({ ...f, asset: e.target.value }))}
                    placeholder="optional asset id"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label htmlFor="impact-impact" className="block text-[11px] text-gray-400 mb-1">Impact type</label>
                  <input
                    id="impact-impact"
                    value={impactForm.impact}
                    onChange={(e) => setImpactForm((f) => ({ ...f, impact: e.target.value }))}
                    placeholder="e.g. increase, decrease, fix, change"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label htmlFor="impact-note" className="block text-[11px] text-gray-400 mb-1">Note</label>
                  <input
                    id="impact-note"
                    value={impactForm.note}
                    onChange={(e) => setImpactForm((f) => ({ ...f, note: e.target.value }))}
                    placeholder="what this release did to it"
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="flex justify-end mt-3">
                <Btn
                  variant="primary"
                  icon={Plus}
                  onClick={saveImpact}
                  busy={savingImpact}
                  disabled={!impactForm.metric.trim() && !impactForm.asset.trim()}
                >
                  {savingImpact ? 'Saving...' : 'Add impact'}
                </Btn>
              </div>
            </div>
          </div>
        )}
      </SideDrawer>
    </div>
  )
}
