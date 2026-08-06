/**
 * Which tables Daily Coverage watches - editable, not hardcoded.
 *
 * THE DEFECT THIS CLOSES: coverage used to know about exactly four tables, named
 * inside the database function. Everything else the owner uploads - SCO, SANY,
 * inspections, meter readings, washing, accidents, job card line items - could
 * go stale for weeks and the panel said nothing, because it was not one of the
 * four. The feed list now lives in a table, so adding one is a dropdown.
 *
 * Two things make this safe to expose:
 *   - the database refuses a table or column that does not exist, so a bad pick
 *     is rejected when saving rather than breaking the whole panel later
 *   - the picker only offers tables carrying organisation_id AND country, which
 *     are what let coverage scope to the company and stop one country's silence
 *     hiding behind the countries that did upload
 *
 * Pausing beats deleting: a feed that was genuinely retired keeps its label and
 * the alert's "already told you about this gap" history.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Radar, Pause, Play, Pencil, AlertTriangle } from 'lucide-react'
import {
  listUploadFeeds, listUploadFeedCandidates, saveUploadFeed, setUploadFeedActive,
} from '../../../lib/api/uploadCoverage'
import { toUserMessage } from '../../../lib/safeError'
import {
  Panel, PanelHeader, Note, Badge, Btn, Select, Toolbar, Modal,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState,
} from '../../components/ui'

/** A table name to a plain-English default, so the owner is not typing schema. */
function suggestLabel(table) {
  return String(table || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

/** A stable short key. It is what the daily alert dedupes on, so it must not drift. */
function suggestSrc(table) {
  return String(table || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

const BLANK = {
  id: null, src: '', label: '', table_name: '', date_column: '', site_column: '',
  active: true, sort_order: 100, site_day_policed: false, date_basis: 'business',
}

function FeedForm({ feed, candidates, onChange }) {
  const table = candidates.find((c) => c.table_name === feed.table_name)
  const dateCols = table?.date_columns || []
  const siteCols = table?.site_columns || []

  const pickTable = (name) => {
    const t = candidates.find((c) => c.table_name === name)
    const dates = t?.date_columns || []
    // Prefer a real business date over the insert timestamp: created_at answers
    // "when did the file land", which is a different question.
    const preferred = dates.find((d) => !/^(created_at|updated_at)$/.test(d)) || dates[0] || ''
    onChange({
      ...feed,
      table_name: name,
      date_column: preferred,
      date_basis: /^(created_at|updated_at)$/.test(preferred) ? 'arrival' : 'business',
      site_column: (t?.site_columns || [])[0] || '',
      src: feed.src || suggestSrc(name),
      label: feed.label || suggestLabel(name),
    })
  }

  const pickDate = (col) => onChange({
    ...feed,
    date_column: col,
    date_basis: /^(created_at|updated_at)$/.test(col) ? 'arrival' : 'business',
  })

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] text-gray-400 mb-1">Which table does this upload land in?</p>
        <Select
          value={feed.table_name}
          onChange={pickTable}
          disabled={!!feed.id}
          placeholder="Choose a table"
          options={candidates.map((c) => ({
            value: c.table_name,
            label: `${c.table_name}${c.approx_rows ? ` (about ${Number(c.approx_rows).toLocaleString()} rows)` : ''}${c.already ? ' - already watched' : ''}`,
          }))}
        />
        {feed.id && (
          <p className="text-[10px] text-gray-600 mt-1">
            The table cannot be changed after saving. Add a separate feed instead, so the
            alert history for this one stays meaningful.
          </p>
        )}
      </div>

      {feed.table_name && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] text-gray-400 mb-1">Which date says what day the data covers?</p>
              <Select value={feed.date_column} onChange={pickDate} placeholder="Choose a date"
                options={dateCols.map((c) => ({ value: c, label: c }))} />
            </div>
            <div>
              <p className="text-[11px] text-gray-400 mb-1">Which column is the site or area?</p>
              <Select value={feed.site_column || ''} onChange={(v) => onChange({ ...feed, site_column: v })}
                placeholder="No site on this table"
                options={siteCols.map((c) => ({ value: c, label: c }))} />
            </div>
          </div>

          {feed.date_basis === 'arrival' && (
            <Note icon={AlertTriangle} tone="warning">
              This column is the row&apos;s insert time, so coverage will show the day the file
              LANDED, not the day the work happened. A late upload will not backdate itself. The
              panel labels it, so nobody reads it as a business date.
            </Note>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] text-gray-400 mb-1">Name shown on the panel</p>
              <input value={feed.label} onChange={(e) => onChange({ ...feed, label: e.target.value })}
                className="w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 focus:border-gray-700 focus:outline-none" />
            </div>
            <div>
              <p className="text-[11px] text-gray-400 mb-1">Order on the panel</p>
              <input type="number" value={feed.sort_order}
                onChange={(e) => onChange({ ...feed, sort_order: e.target.value })}
                className="w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 focus:border-gray-700 focus:outline-none" />
            </div>
          </div>

          {feed.site_column && (
            <label className="flex items-start gap-2 text-[11px] text-gray-400">
              <input type="checkbox" checked={feed.site_day_policed}
                onChange={(e) => onChange({ ...feed, site_day_policed: e.target.checked })}
                className="mt-0.5" />
              <span>
                Every working site should send this every day.
                <span className="block text-gray-600">
                  Leave this off for anything event driven, where a site only appears when
                  something actually happened - otherwise every quiet site is reported as a gap.
                </span>
              </span>
            </label>
          )}
        </>
      )}
    </div>
  )
}

export default function UploadFeedManager() {
  const [feeds, setFeeds] = useState([])
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [saveErr, setSaveErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      // The candidate list needs super-admin; a failure there must not hide the
      // feed list itself, which is the part everyone can read.
      const [f, c] = await Promise.all([
        listUploadFeeds(),
        listUploadFeedCandidates().catch(() => []),
      ])
      setFeeds(f); setCandidates(c)
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the watched feed list.'))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const unwatched = useMemo(
    () => candidates.filter((c) => !c.already && Number(c.approx_rows) > 0),
    [candidates],
  )

  const save = async () => {
    setBusy(true); setSaveErr('')
    try {
      await saveUploadFeed(editing)
      setEditing(null)
      await load()
    } catch (e) {
      setSaveErr(toUserMessage(e, 'Could not save this feed.'))
    } finally { setBusy(false) }
  }

  const toggle = async (f) => {
    try { await setUploadFeedActive(f.id, !f.active); await load() } catch (e) {
      setError(toUserMessage(e, 'Could not change this feed.'))
    }
  }

  const valid = editing?.table_name && editing?.date_column
    && String(editing?.src || '').trim() && String(editing?.label || '').trim()

  return (
    <Panel flush>
      <PanelHeader
        icon={Radar}
        title="Tables being watched"
        subtitle="Anything listed here is checked for missed uploads. Add a table and it appears on this page and in the morning alert."
        actions={(
          <Toolbar>
            <Btn icon={RefreshCw} onClick={load}>Refresh</Btn>
            <Btn icon={Plus} variant="primary"
              onClick={() => { setSaveErr(''); setEditing({ ...BLANK }) }}>Watch a table</Btn>
          </Toolbar>
        )}
      />

      {loading ? <LoadingState label="Loading watched feeds" rows={3} />
        : error ? <ErrorState message={error} onRetry={load} />
        : feeds.length === 0 ? (
          <EmptyState
            icon={Radar}
            title="No table is being watched"
            reason="Nothing is registered, so no missed upload can be reported. Add the tables your daily files land in."
          />
        ) : (
          <>
            <Table>
              <THead>
                <Th>Feed</Th>
                <Th>Table</Th>
                <Th>Day counted by</Th>
                <Th>Area</Th>
                <Th align="right">Actions</Th>
              </THead>
              <tbody>
                {feeds.map((f) => (
                  <Tr key={f.id}>
                    <Td>
                      <span className="text-gray-200">{f.label}</span>
                      {!f.active && <Badge tone="quiet">paused</Badge>}
                    </Td>
                    <Td nowrap><span className="text-gray-500">{f.table_name}</span></Td>
                    <Td nowrap>
                      <span className="text-gray-400">{f.date_column}</span>
                      {f.date_basis === 'arrival' && <Badge tone="warning" title="Counts the day the rows landed, not the day the work happened">arrival</Badge>}
                    </Td>
                    <Td nowrap>
                      {f.site_column
                        ? <span className="text-gray-500">{f.site_column}{f.site_day_policed ? ' · daily per site' : ''}</span>
                        : <span className="text-gray-600">none</span>}
                    </Td>
                    <Td align="right">
                      <Toolbar className="justify-end">
                        <Btn icon={Pencil} onClick={() => { setSaveErr(''); setEditing({ ...f, site_column: f.site_column || '' }) }}>Edit</Btn>
                        <Btn icon={f.active ? Pause : Play} onClick={() => toggle(f)}>
                          {f.active ? 'Pause' : 'Resume'}
                        </Btn>
                      </Toolbar>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>

            {unwatched.length > 0 && (
              <div className="px-3 pb-3">
                <Note icon={AlertTriangle}>
                  {unwatched.length} other table{unwatched.length === 1 ? '' : 's'} could be watched and
                  {unwatched.length === 1 ? ' is' : ' are'} not:{' '}
                  <span className="text-gray-300">
                    {unwatched.slice(0, 8).map((c) => c.table_name).join(', ')}
                    {unwatched.length > 8 ? ' and more' : ''}
                  </span>
                  . Add one only if you upload it on a schedule - a table nobody uploads has no
                  missed day to report.
                </Note>
              </div>
            )}
          </>
        )}

      <Modal
        open={!!editing}
        title={editing?.id ? 'Edit watched table' : 'Watch a table'}
        subtitle="Coverage checks this table for days with no data, per country and per area."
        onClose={() => setEditing(null)}
        footer={(
          <>
            <Btn onClick={() => setEditing(null)}>Cancel</Btn>
            <Btn variant="primary" busy={busy} disabled={!valid} onClick={save}>
              {editing?.id ? 'Save' : 'Start watching'}
            </Btn>
          </>
        )}
      >
        {candidates.length === 0 && !editing?.id ? (
          <Note icon={AlertTriangle} tone="warning">
            The list of tables could not be read. Only a super admin can add a feed.
          </Note>
        ) : editing ? (
          <>
            <FeedForm feed={editing} candidates={candidates} onChange={setEditing} />
            {saveErr && <div className="mt-3"><Note icon={AlertTriangle} tone="warning">{saveErr}</Note></div>}
          </>
        ) : null}
      </Modal>
    </Panel>
  )
}
