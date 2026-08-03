/**
 * ConsoleReleases.jsx - the release and impact center.
 *
 * When a number changes, the first question is "what did we ship?". This page
 * records every release and the metrics or assets it touched, so a figure that
 * moves can be traced back to the deployment that moved it.
 *
 * An impact is a claim about cause, so it is entered deliberately per release,
 * never inferred.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Rocket, Tag, Plus, RefreshCw, AlertTriangle, CheckCircle2, Clock,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Toolbar, Modal,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState,
} from '../components/ui'
import { listReleases, recordRelease, addReleaseImpact } from '../../lib/api/lineageOps'
import { toUserMessage } from '../../lib/safeError'

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

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const { releases, impacts } = await listReleases()
      setState({ loading: false, error: null, releases, impacts })
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

  const inputCls = 'w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-600 focus:border-gray-700 focus:outline-none'

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          icon={Rocket}
          title="Release & Impact Center"
          subtitle="Record each release and the metrics or assets it affects, so a number change can be traced to a deployment."
          actions={(
            <Toolbar>
              <Btn icon={Plus} variant="primary" onClick={openCreate}>Record release</Btn>
              <Btn icon={RefreshCw} onClick={load}>Refresh</Btn>
            </Toolbar>
          )}
        />

        {flash && (
          <div className="px-4 pb-3">
            <Note icon={flash.tone === 'ok' ? CheckCircle2 : AlertTriangle} tone={flash.tone === 'ok' ? 'accent' : 'danger'}>
              {flash.text}
            </Note>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 p-4 pt-0">
          <StatTile label="Releases" value={nf.format(state.releases.length)} icon={Tag} />
          <StatTile label="Recorded impacts" value={nf.format(state.impacts.length)} />
        </div>
      </Panel>

      <Panel>
        <PanelHeader icon={Tag} title="Releases" subtitle="Select a release to see and add its impacts." />

        {state.loading ? (
          <LoadingState label="Reading releases" rows={5} />
        ) : state.error ? (
          <div className="p-4 pt-0"><ErrorState message={state.error} onRetry={load} /></div>
        ) : state.releases.length === 0 ? (
          <EmptyState
            icon={Rocket}
            title="No releases recorded yet"
            reason="Record a release above to start tracing number changes to deployments."
            action={<Btn icon={Plus} variant="primary" onClick={openCreate}>Record release</Btn>}
          />
        ) : (
          <Table>
            <THead>
              <Th>Version</Th>
              <Th>Notes</Th>
              <Th>Released at</Th>
              <Th align="right">Impacts</Th>
            </THead>
            <tbody>
              {state.releases.map((r) => (
                <Tr key={r.id} onClick={() => setDetail(r)}>
                  <Td><span className="font-medium text-gray-100">{r.version || 'N/A'}</span></Td>
                  <Td className="text-gray-400">{r.notes || 'No notes'}</Td>
                  <Td nowrap>
                    <span className="inline-flex items-center gap-1 text-gray-500">
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
        )}
      </Panel>

      {/* ── record release ─────────────────────────────────────────────────── */}
      <Modal
        open={creating}
        title="Record a release"
        subtitle="Name the version you shipped. Add its impacts afterwards from the release detail."
        onClose={() => setCreating(false)}
        width="max-w-lg"
        footer={(
          <Toolbar className="justify-end">
            <Btn onClick={() => setCreating(false)}>Cancel</Btn>
            <Btn variant="primary" icon={CheckCircle2} onClick={saveRelease} busy={savingRelease} disabled={!form.version.trim()}>
              Record release
            </Btn>
          </Toolbar>
        )}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Version <span className="text-red-400">*</span></label>
            <input
              value={form.version}
              onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))}
              placeholder="e.g. V474"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Notes</label>
            <textarea
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
      <Modal
        open={!!detail}
        title={detail ? `Release ${detail.version || ''}`.trim() : ''}
        subtitle={detail ? `Released ${fmtWhen(detail.released_at)}` : ''}
        onClose={() => { setDetail(null); setImpactForm({ metric: '', asset: '', impact: '', note: '' }) }}
        width="max-w-3xl"
      >
        {detail && (
          <div className="space-y-4">
            {detail.notes && <Note>{detail.notes}</Note>}

            <div>
              <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-2">Recorded impacts</h4>
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
                            : <span className="text-gray-600">N/A</span>}
                        </Td>
                        <Td className="text-gray-300">{it.note || 'No note'}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-3">
              <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-2">Add an impact</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">Metric id</label>
                  <input
                    value={impactForm.metric}
                    onChange={(e) => setImpactForm((f) => ({ ...f, metric: e.target.value }))}
                    placeholder="e.g. fleet_cpk"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">Asset id</label>
                  <input
                    value={impactForm.asset}
                    onChange={(e) => setImpactForm((f) => ({ ...f, asset: e.target.value }))}
                    placeholder="optional asset id"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">Impact type</label>
                  <input
                    value={impactForm.impact}
                    onChange={(e) => setImpactForm((f) => ({ ...f, impact: e.target.value }))}
                    placeholder="e.g. increase, decrease, fix, change"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">Note</label>
                  <input
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
                  Add impact
                </Btn>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
