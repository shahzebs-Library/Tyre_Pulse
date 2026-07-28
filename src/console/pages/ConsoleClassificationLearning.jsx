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
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Brain, TrendingUp, TrendingDown, AlertTriangle, Check, X, Eye, RefreshCw, Sparkles,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Table, THead, Th, Tr, Td,
  LoadingState, EmptyState, ErrorState, Modal, Toolbar,
} from '../components/ui'
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

export default function ConsoleClassificationLearning() {
  const [state, setState] = useState({ loading: true, error: null, data: null })
  const [preview, setPreview] = useState(null)   // {proposal, rows, loading, error}
  const [busy, setBusy] = useState('')
  const [flash, setFlash] = useState(null)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await loadLearningOverview()
      setState({ loading: false, error: null, data })
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e), data: null })
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
          : `Nothing left to mark for "${r.token}" - it has already been applied.`,
      })
      await load()
    } catch (e) {
      setFlash({ tone: 'bad', text: toUserMessage(e) })
    } finally {
      setBusy('')
    }
  }

  if (state.loading) return <LoadingState label="Reading what the classifier has learned" rows={5} />
  if (state.error) return <ErrorState message={state.error} onRetry={load} />

  const d = state.data

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          icon={Brain}
          title="How the classifier is learning"
          subtitle="Every category you correct is measured against what the machine would have said. What it gets wrong becomes the next thing it learns."
          actions={<Btn icon={RefreshCw} onClick={load}>Refresh</Btn>}
        />

        {flash && (
          <div className="px-4 pb-3">
            <Note icon={flash.tone === 'ok' ? Check : AlertTriangle} tone={flash.tone === 'ok' ? 'accent' : 'danger'}>
              {flash.text}
            </Note>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 pt-0">
          <StatTile
            label="Agreement with you"
            value={latest ? `${latest.agreement_pct}%` : 'N/A'}
            sub={latest ? `${nf.format(latest.agreed)} of ${nf.format(latest.corrections)} decisions` : 'No decisions recorded yet'}
            tone={latest && Number(latest.agreement_pct) >= 90 ? 'good' : 'default'}
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
          />
          <StatTile
            label="Weakest part"
            value={spots[0]?.machine_source || 'None'}
            sub={spots[0] ? `overruled on ${spots[0].share_of_source_pct}% of its decisions` : 'nothing overruled yet'}
            tone={spots[0] ? 'danger' : 'good'}
          />
        </div>

        {d?.failed > 0 && (
          <div className="px-4 pb-4">
            <Note icon={AlertTriangle} tone="warning">
              {d.failed} of the four sections could not be loaded, so part of this page is missing rather than empty.
            </Note>
          </div>
        )}
      </Panel>

      {/* ── what it should learn next ─────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={Sparkles}
          title="Suggestions from what you have reviewed"
          subtitle="A word is only suggested when items carrying it are far more likely to be one category than items in general. Anything you reject is never suggested again."
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
          <Table>
            <THead>
              <Th>Word</Th>
              <Th>Should mean</Th>
              <Th>Evidence</Th>
              <Th align="right">Would change</Th>
              <Th align="right">Value</Th>
              <Th align="right">Decide</Th>
            </THead>
            <tbody>
              {proposals.map((p) => {
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
                        <Btn icon={Eye} onClick={() => openPreview(p)}>Look</Btn>
                        <Btn
                          icon={X}
                          onClick={() => decide(p, 'reject')}
                          busy={busy === `${p.token}:${p.category}:reject`}
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
        )}
      </Panel>

      {/* ── which part of the brain is wrong ──────────────────────────────── */}
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
          <div className="p-4 pt-0 space-y-2">
            {spots.map((w, i) => (
              <div key={i} className="rounded border border-gray-800 bg-gray-900/50 p-3">
                <div className="text-sm text-gray-200">{describeWeakSpot(w)}</div>
                {w.sample && (
                  <div className="text-xs text-gray-500 mt-1">For example: {w.sample}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* ── what it has been taught, and what was ruled out ───────────────── */}
      <Panel>
        <PanelHeader
          icon={Check}
          title="What it has been taught"
          subtitle="Accepted words and the ones you ruled out. A rejected word is never suggested again."
        />
        {rules.length === 0 ? (
          <EmptyState
            icon={Brain}
            title="Nothing decided yet"
            reason="Accept or reject a suggestion above and it will be recorded here."
          />
        ) : (
          <Table>
            <THead>
              <Th>Word</Th>
              <Th>Means</Th>
              <Th>Decision</Th>
              <Th>Why</Th>
              <Th align="right"></Th>
            </THead>
            <tbody>
              {rules.map((r) => (
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
        )}
      </Panel>

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
            >
              No, that is wrong
            </Btn>
            <Btn
              variant="primary"
              icon={Check}
              onClick={() => decide(preview.proposal, 'accept')}
              busy={busy.endsWith(':accept')}
              disabled={preview.loading || !preview.rows.length}
            >
              Yes, learn this
            </Btn>
          </Toolbar>
        )}
      >
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
                  {preview.rows.map((r, i) => (
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
            </>
          )
        )}
      </Modal>
    </div>
  )
}
