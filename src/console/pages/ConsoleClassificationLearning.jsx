/**
 * ConsoleClassificationLearning.jsx - where the classifier is taught.
 *
 * Three questions, in the order they matter:
 *   1. Is it getting better?          agreement over time
 *   2. Which part of it is wrong?     weak spots by layer
 *   3. What should it learn next?     proposals from the reviewed items
 *
 * A proposal is NEVER applied without a person seeing the exact rows it would
 * claim. The engine's very first proposal looked perfect on every statistic and
 * was still wrong about the world, so the preview is the point of this page, not
 * a courtesy.
 *
 * Layout: header, four KPI tiles (each opens its view), then tabs
 * (?tab=overview|suggestions|weak|rules). Tables are sorted, paged and
 * exportable; the preview stays a modal.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Brain, TrendingUp, TrendingDown, AlertTriangle, Check, X, Eye, Sparkles,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Table, THead, Th, Tr, Td,
  LoadingState, EmptyState, ErrorState, Modal, Toolbar, Segmented,
} from '../components/ui'
import { TrendChart, BarsChart } from '../components/ui/charts'
import { sortRows, useTableSort } from '../../lib/consoleTable'
import ExportButtons from './shared/ExportButtons'
import { PageHeader, useUrlTab, usePaged, Pager, AttentionList } from './shared/pageKit'
import {
  loadLearningOverview, previewLearnedRule, decideRule, applyLearnedRule,
} from '../../lib/api/classificationLearning'
import {
  liftBand, explainProposal, impactOf, rankProposals, isOfferable,
  accuracyTrend, describeWeakSpot, rankWeakSpots, categoryLabel,
} from '../../lib/classificationLearning'
import { toUserMessage } from '../../lib/safeError'

const nf = new Intl.NumberFormat('en-US')
const money = (v) => (v === null || v === undefined ? 'N/A' : nf.format(Math.round(Number(v))))

const PROPOSAL_ACCESSORS = {
  lines: (p) => impactOf(p)?.lines ?? null,
  value: (p) => impactOf(p)?.value ?? null,
  lift: (p) => Number(p.lift),
  category: (p) => categoryLabel(p.category),
}
const RULE_ACCESSORS = { category: (r) => categoryLabel(r.category) }
const TABS = ['overview', 'suggestions', 'weak', 'rules']

const RULE_EXPORT = [
  { key: 'token', header: 'Word' },
  { key: 'category', header: 'Means', value: (r) => categoryLabel(r.category) },
  { key: 'decision', header: 'Decision', value: (r) => (r.status === 'active' ? 'Learned' : 'Ruled out') },
  { key: 'note', header: 'Why', value: (r) => r.note || 'No reason given' },
]
const PROPOSAL_EXPORT = [
  { key: 'token', header: 'Word' },
  { key: 'category', header: 'Should mean', value: (p) => categoryLabel(p.category) },
  { key: 'evidence', header: 'Evidence', value: (p) => liftBand(p.lift).label },
  { key: 'lift', header: 'Lift' },
  { key: 'lines', header: 'Lines it would change', value: (p) => impactOf(p)?.lines ?? 0 },
  { key: 'value', header: 'Value', value: (p) => { const imp = impactOf(p); return imp ? Math.round(Number(imp.value) || 0) : 0 } },
]

function PageHead({ onRefresh, busy, at }) {
  return (
    <PageHeader
      icon={Brain}
      title="Teach the Classifier"
      purpose="Every category you correct is measured against what the machine would have said. What it gets wrong becomes the next thing it learns."
      refreshedAt={at}
      onRefresh={onRefresh}
      refreshing={busy}
    />
  )
}

export default function ConsoleClassificationLearning({ tabParam = 'tab' } = {}) {
  const [state, setState] = useState({ loading: true, error: null, data: null, at: null })
  const [tab, setTab] = useUrlTab(TABS, 'overview', tabParam)
  const [preview, setPreview] = useState(null)   // {proposal, rows, loading, error}
  const [busy, setBusy] = useState('')
  const [flash, setFlash] = useState(null)
  const [ruleView, setRuleView] = useState('all')

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await loadLearningOverview()
      setState({ loading: false, error: null, data, at: new Date() })
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e), data: null, at: null })
    }
  }, [])

  useEffect(() => { load() }, [load])

  const proposals = useMemo(
    () => rankProposals((state.data?.proposals || []).filter(isOfferable)),
    [state.data],
  )
  const spots = useMemo(() => rankWeakSpots(state.data?.spots || []), [state.data])
  const rules = useMemo(() => state.data?.rules || [], [state.data])
  const trend = useMemo(() => accuracyTrend(state.data?.periods || []), [state.data])
  const periodsSorted = useMemo(() => [...(state.data?.periods || [])].sort((a, b) =>
    String(a.period).localeCompare(String(b.period))), [state.data])
  // Unsorted keeps the engine's ranking (strongest evidence first).
  const proposalSort = useTableSort({ key: null, dir: 'desc' })
  const proposalSorted = useMemo(() => sortRows(proposals, proposalSort.sort, PROPOSAL_ACCESSORS), [proposals, proposalSort.sort])
  const proposalPaged = usePaged(proposalSorted, 20)
  const visibleRules = useMemo(() => rules.filter((r) => ruleView === 'all'
    || (ruleView === 'active' ? r.status === 'active' : r.status !== 'active')), [rules, ruleView])
  const ruleSort = useTableSort({ key: 'token', dir: 'asc' })
  const ruleSorted = useMemo(() => sortRows(visibleRules, ruleSort.sort, RULE_ACCESSORS), [visibleRules, ruleSort.sort])
  const rulePaged = usePaged(ruleSorted, 25)
  const previewPaged = usePaged(preview?.rows || [], 20)
  const spotBars = useMemo(() => spots.slice(0, 8).map((w) => ({
    label: w.machine_source || 'Unknown', value: Number(w.share_of_source_pct) || 0,
  })), [spots])

  const latest = useMemo(() => {
    const p = [...(state.data?.periods || [])].sort((a, b) =>
      String(a.period).localeCompare(String(b.period)))
    return p[p.length - 1] || null
  }, [state.data])

  const openPreview = async (p) => {
    setPreview({ proposal: p, rows: [], loading: true, error: null })
    try {
      const { rows } = await previewLearnedRule(p.token, p.category)
      setPreview({ proposal: p, rows, loading: false, error: null })
    } catch (e) {
      setPreview({ proposal: p, rows: [], loading: false, error: toUserMessage(e) })
    }
  }

  const decide = async (p, action) => {
    const key = `${p.token}:${p.category}:${action}`
    setBusy(key)
    try {
      await decideRule(p.token, p.category, action)
      if (action === 'accept') {
        // Accepting records the decision; applying is what moves anything, and
        // it is a separate press so nobody changes the books by accident.
        const res = await applyLearnedRule(p.token, p.category, false)
        setFlash({
          tone: 'ok',
          text: `Learned "${p.token}" as ${categoryLabel(p.category)}. `
            + `${res.items || 0} item code${res.items === 1 ? '' : 's'} marked. `
            + 'Run "Apply reviewed decisions" on Import History to move the money already loaded.',
        })
      } else {
        setFlash({ tone: 'ok', text: `Rejected "${p.token}". It will not be suggested again.` })
      }
      setPreview(null)
      await load()
    } catch (e) {
      // Which half failed changes what the person should do next, so say it.
      // If the decision landed and only the apply failed, the rule is learned
      // but not applied and "Apply again" below is the way to finish it.
      setFlash({ tone: 'bad', text: toUserMessage(e) })
      await load()
    } finally {
      setBusy('')
    }
  }

  const reapply = async (r) => {
    setBusy(`${r.token}:${r.category}:reapply`)
    try {
      const res = await applyLearnedRule(r.token, r.category, false)
      setFlash({
        tone: 'ok',
        text: res.items
          ? `Marked ${res.items} more item code${res.items === 1 ? '' : 's'} for "${r.token}".`
          : `Nothing left to mark for "${r.token}" : it has already been applied.`,
      })
      await load()
    } catch (e) {
      setFlash({ tone: 'bad', text: toUserMessage(e) })
    } finally {
      setBusy('')
    }
  }

  if (state.loading && !state.at) return <div className="space-y-4"><PageHead onRefresh={load} busy /><LoadingState label="Reading what the classifier has learned" rows={5} /></div>
  if (state.error) return <div className="space-y-4"><PageHead onRefresh={load} /><ErrorState message={state.error} onRetry={load} /></div>

  const d = state.data
  const attention = []
  if (proposals.length) {
    const top = proposals[0]
    attention.push({ key: 'sugg', tone: 'warning', title: `${proposals.length} suggestion${proposals.length === 1 ? '' : 's'} waiting for a decision`,
      detail: `Strongest: "${top.token}" as ${categoryLabel(top.category)}.`, action: { label: 'Look at it', onClick: () => openPreview(top) } })
  }
  if (spots[0]) {
    attention.push({ key: 'weak', tone: 'danger', title: `${spots[0].machine_source || 'One layer'} is overruled on ${spots[0].share_of_source_pct}% of its decisions`,
      detail: 'Fixing the weakest layer moves the agreement figure most.', action: { label: 'See weak spots', onClick: () => setTab('weak') } })
  }
  if (trend && Number(trend.delta) < 0) {
    attention.push({ key: 'trend', tone: 'warning', title: `Agreement fell ${Math.abs(trend.delta)} points over ${trend.periods} months`,
      detail: 'Review recent corrections in Material Master.', action: { label: 'Open Material Master', to: '/console/material-master' } })
  }

  return (
    <div className="space-y-4">
      <PageHead onRefresh={load} busy={state.loading} at={state.at} />

      {flash && (
        <div role="status">
          <Note icon={flash.tone === 'ok' ? Check : AlertTriangle} tone={flash.tone === 'ok' ? 'accent' : 'danger'}>
            {flash.text}
          </Note>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile
            label="Agreement with you"
            value={latest ? `${latest.agreement_pct}%` : 'N/A'}
            sub={latest ? `${nf.format(latest.agreed)} of ${nf.format(latest.corrections)} decisions` : 'No decisions recorded yet'}
            tone={latest && Number(latest.agreement_pct) >= 90 ? 'good' : 'default'}
            onClick={() => setTab('overview')} active={tab === 'overview'}
          />
          <StatTile
            label="Direction"
            value={trend ? `${trend.delta > 0 ? '+' : ''}${trend.delta} pts` : 'Not yet'}
            /* One month is not a trend. Saying "no change" from a single point
               would be a claim the data cannot support. */
            sub={trend ? `over ${trend.periods} months` : 'needs a second month to compare'}
            icon={trend ? (trend.improving ? TrendingUp : TrendingDown) : undefined}
            tone={trend ? (trend.improving ? 'good' : 'warning') : 'default'}
          />
          <StatTile
            label="Ready to learn"
            value={nf.format(proposals.length)}
            sub={proposals.length ? 'suggestions waiting for you' : 'nothing new to suggest'}
            tone={proposals.length ? 'warning' : 'default'}
            onClick={() => setTab('suggestions')} active={tab === 'suggestions'}
          />
          <StatTile
            label="Weakest part"
            value={spots[0]?.machine_source || 'None'}
            sub={spots[0] ? `overruled on ${spots[0].share_of_source_pct}% of its decisions` : 'nothing overruled yet'}
            tone={spots[0] ? 'danger' : 'good'}
            onClick={() => setTab('weak')} active={tab === 'weak'}
          />
      </div>

      <AttentionList quiet items={attention} />

      <Segmented ariaLabel="Classifier views" value={tab} onChange={setTab} options={[
        { key: 'overview', label: 'Learning trend' },
        { key: 'suggestions', label: 'Suggestions', count: proposals.length },
        { key: 'weak', label: 'Weak spots', count: spots.length },
        { key: 'rules', label: 'What it has been taught', count: rules.length },
      ]} />

      {tab === 'overview' && (
      <Panel>
        <PanelHeader
          icon={Brain}
          title="How the classifier is learning"
          subtitle="Agreement between your decisions and what the machine would have said, month by month."
        />
        <div>
          <TrendChart
            height={180}
            labels={periodsSorted.map((p) => String(p.period))}
            series={[{ label: 'Agreement %', values: periodsSorted.map((p) => (p.agreement_pct == null ? null : Number(p.agreement_pct))) }]}
            yLabel="Agreement %"
            yMax={100}
            summary={latest ? `Latest agreement ${latest.agreement_pct}% over ${periodsSorted.length} months.` : 'No decisions recorded yet.'}
            emptyText="No decisions recorded yet, so there is no agreement trend."
          />
        </div>

        {d?.failed > 0 && (
          <div className="mt-3">
            <Note icon={AlertTriangle} tone="warning">
              {d.failed} of the four sections could not be loaded, so part of this page is missing rather than empty.
            </Note>
          </div>
        )}
      </Panel>
      )}

      {/* ── what it should learn next ─────────────────────────────────────── */}
      {tab === 'suggestions' && (
      <Panel>
        <PanelHeader
          icon={Sparkles}
          title="Suggestions from what you have reviewed"
          subtitle="A word is only suggested when items carrying it are far more likely to be one category than items in general. Anything you reject is never suggested again."
          actions={<ExportButtons rows={proposalSorted} columns={PROPOSAL_EXPORT} title="TyrePulse Classifier Suggestions" />}
        />
        {proposals.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="Nothing new to suggest"
            reason={
              d?.proposalsOk === false
                ? 'This database does not have the learning functions yet.'
                : 'Every strong pattern in your reviewed items has already been decided. Review more items in Material Master and new suggestions will appear here.'
            }
          />
        ) : (
          <>
          <Table>
            <THead>
              <Th sortKey="token" sort={proposalSort.sort} onSort={proposalSort.onSort}>Word</Th>
              <Th sortKey="category" sort={proposalSort.sort} onSort={proposalSort.onSort}>Should mean</Th>
              <Th sortKey="lift" sort={proposalSort.sort} onSort={proposalSort.onSort}>Evidence</Th>
              <Th sortKey="lines" sort={proposalSort.sort} onSort={proposalSort.onSort} align="right">Would change</Th>
              <Th sortKey="value" sort={proposalSort.sort} onSort={proposalSort.onSort} align="right">Value</Th>
              <Th align="right">Decide</Th>
            </THead>
            <tbody>
              {proposalPaged.pageRows.map((p) => {
                const band = liftBand(p.lift)
                const imp = impactOf(p)
                return (
                  <Tr key={`${p.token}:${p.category}`}>
                    <Td><span className="font-medium text-gray-100">{p.token}</span></Td>
                    <Td>{categoryLabel(p.category)}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <Badge tone={band.tone} title={`Lift ${p.lift}`}>{band.label}</Badge>
                      </div>
                      <div className="text-xs text-gray-400 mt-1">{explainProposal(p)}</div>
                    </Td>
                    <Td align="right">{imp ? `${nf.format(imp.lines)} lines` : 'nothing'}</Td>
                    <Td align="right">{imp ? money(imp.value) : 'N/A'}</Td>
                    <Td align="right">
                      <Toolbar className="justify-end">
                        <Btn icon={Eye} onClick={() => openPreview(p)} title={`Look at the items "${p.token}" would change`}>Look</Btn>
                        <Btn
                          icon={X}
                          onClick={() => decide(p, 'reject')}
                          busy={busy === `${p.token}:${p.category}:reject`}
                          title={`Reject "${p.token}" as ${categoryLabel(p.category)}. It will not be suggested again.`}
                        >
                          No
                        </Btn>
                      </Toolbar>
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
          <Pager {...proposalPaged} label="suggestions" />
          </>
        )}
      </Panel>
      )}

      {/* ── which part of the brain is wrong ──────────────────────────────── */}
      {tab === 'weak' && (
      <Panel>
        <PanelHeader
          icon={AlertTriangle}
          title="Where it gets things wrong"
          subtitle="One accuracy figure says how often the machine is wrong. This says which part of it to fix."
        />
        {spots.length === 0 ? (
          <EmptyState
            icon={Check}
            title="Nothing has been overruled"
            reason="Either the classifier has agreed with every decision you made, or no decisions have been recorded yet."
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BarsChart bars={spotBars} valueFormat={(v) => `${v}%`}
              summary={spotBars.length ? `${spotBars[0].label} is overruled on ${spotBars[0].value}% of its decisions.` : ''}
              emptyText="Nothing has been overruled." />
          <div className="space-y-2">
            {spots.map((w, i) => (
              <div key={i} className="rounded border border-gray-800 bg-gray-900/50 p-3">
                <div className="text-sm text-gray-200">{describeWeakSpot(w)}</div>
                {w.sample && (
                  <div className="text-xs text-gray-400 mt-1">For example: {w.sample}</div>
                )}
              </div>
            ))}
          </div>
          </div>
        )}
        <p className="text-[11px] text-gray-500 mt-3">
          Correct the items behind a weak layer in{' '}
          <a href="/console/material-master" className="text-orange-300 hover:text-orange-200 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">Material Master</a>;
          each correction becomes evidence here.
        </p>
      </Panel>
      )}

      {/* ── what it has been taught, and what was ruled out ───────────────── */}
      {tab === 'rules' && (
      <Panel>
        <PanelHeader
          icon={Check}
          title="What it has been taught"
          subtitle="Accepted words and the ones you ruled out. A rejected word is never suggested again."
          actions={<>
            <Segmented role="group" ariaLabel="Show rules" value={ruleView} onChange={setRuleView} options={[
              { key: 'all', label: 'All', count: rules.length },
              { key: 'active', label: 'Learned', count: rules.filter((r) => r.status === 'active').length },
              { key: 'ruled_out', label: 'Ruled out', count: rules.filter((r) => r.status !== 'active').length },
            ]} />
            <ExportButtons rows={ruleSorted} columns={RULE_EXPORT} title="TyrePulse Classifier Rules" />
          </>}
        />
        {rules.length === 0 ? (
          <EmptyState
            icon={Brain}
            title="Nothing decided yet"
            reason="Accept or reject a suggestion above and it will be recorded here."
          />
        ) : visibleRules.length === 0 ? (
          <EmptyState icon={Brain} title="No rules in this view" reason="Switch to All to see every decision." />
        ) : (
          <>
          <Table>
            <THead>
              <Th sortKey="token" sort={ruleSort.sort} onSort={ruleSort.onSort}>Word</Th>
              <Th sortKey="category" sort={ruleSort.sort} onSort={ruleSort.onSort}>Means</Th>
              <Th sortKey="status" sort={ruleSort.sort} onSort={ruleSort.onSort}>Decision</Th>
              <Th>Why</Th>
              <Th align="right"><span className="sr-only">Action</span></Th>
            </THead>
            <tbody>
              {rulePaged.pageRows.map((r) => (
                <Tr key={r.id}>
                  <Td><span className="font-medium text-gray-100">{r.token}</span></Td>
                  <Td>{categoryLabel(r.category)}</Td>
                  <Td>
                    <Badge tone={r.status === 'active' ? 'good' : 'quiet'}>
                      {r.status === 'active' ? 'Learned' : 'Ruled out'}
                    </Badge>
                  </Td>
                  <Td>{r.note || 'No reason given'}</Td>
                  <Td align="right">
                    {/* Accepting and applying are two calls. If the second fails
                        the rule is learned but not applied, and it never returns
                        to the suggestions - so re-applying has to be reachable
                        from here or it is stranded. Re-applying is safe: it skips
                        anything already reviewed. */}
                    {r.status === 'active' && (
                      <Btn
                        onClick={() => reapply(r)}
                        busy={busy === `${r.token}:${r.category}:reapply`}
                      >
                        Apply again
                      </Btn>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pager {...rulePaged} label="rules" />
          </>
        )}
      </Panel>
      )}

      {/* ── the preview, which is the point of the page ───────────────────── */}
      <Modal
        open={!!preview}
        title={preview ? `"${preview.proposal.token}" as ${categoryLabel(preview.proposal.category)}` : ''}
        subtitle="These are the exact items this would change. Check them before you decide."
        onClose={() => setPreview(null)}
        width="max-w-3xl"
        footer={preview && (
          <Toolbar className="justify-end">
            <Btn
              icon={X}
              onClick={() => decide(preview.proposal, 'reject')}
              busy={busy.endsWith(':reject')}
              disabled={!!busy}
            >
              No, that is wrong
            </Btn>
            <Btn
              variant="primary"
              icon={Check}
              onClick={() => decide(preview.proposal, 'accept')}
              busy={busy.endsWith(':accept')}
              disabled={!!busy || preview.loading || !preview.rows.length}
            >
              Yes, learn this
            </Btn>
          </Toolbar>
        )}
      >
        {/* A failed decision keeps this dialog open; its reason lands in the page flash behind it. */}
        {flash?.tone === 'bad' && <div className="mb-3"><Note icon={AlertTriangle} tone="danger">{flash.text}</Note></div>}
        {preview?.loading && <LoadingState label="Finding the rows" rows={3} />}
        {preview?.error && <ErrorState message={preview.error} />}
        {preview && !preview.loading && !preview.error && (
          preview.rows.length === 0 ? (
            <EmptyState
              icon={Eye}
              title="Nothing would change"
              reason="No unidentified item carries this word, so accepting it would have no effect today."
            />
          ) : (
            <>
              <Note icon={AlertTriangle} tone="warning">
                Accepting marks these item codes in the Material Master. Money already
                loaded moves only when you run &quot;Apply reviewed decisions&quot;, which has its
                own preview. Anything you have already reviewed by hand is left alone.
              </Note>
              <Table className="mt-3">
                <THead>
                  <Th>Item</Th>
                  <Th>Code</Th>
                  <Th>Country</Th>
                  <Th align="right">Lines</Th>
                  <Th align="right">Value</Th>
                </THead>
                <tbody>
                  {previewPaged.pageRows.map((r, i) => (
                    <Tr key={`${r.item_code}:${r.country}:${i}`}>
                      <Td>{r.item_description || 'No description'}</Td>
                      <Td nowrap><span className="text-gray-400">{r.item_code}</span></Td>
                      <Td>{r.country || 'Not set'}</Td>
                      <Td align="right">{nf.format(r.lines)}</Td>
                      <Td align="right">{money(r.value)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <Pager {...previewPaged} label="items" />
            </>
          )
        )}
      </Modal>
    </div>
  )
}
