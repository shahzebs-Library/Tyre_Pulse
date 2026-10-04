/**
 * ConsoleAnnouncements.jsx - the banners shown to app users.
 *
 * One list with a status filter (?tab=live | inactive | expired | all) instead
 * of stacked card sections, a sortable paged table, and the full message plus
 * a preview of the banner in a drawer. Create, edit, duplicate, show/hide and
 * delete (with a confirmation) are all kept.
 *
 * "Live" means what users actually see: switched on AND not past its expiry.
 * An announcement that is switched on but expired is shown to nobody, which is
 * why it has its own tab and an attention callout. One with a future start
 * (show_from) is "Scheduled" and has its own tab too.
 *
 * Added controls: start date and time (show_from), country targeting
 * (target_countries), priority, the full role list, a live count of matching
 * accounts (announcement_audience), "switch off every expired banner" in one
 * go, and an audited show/hide. Delete is red, needs a reason and DELETE typed.
 *
 * HONEST LIMIT shown on screen: no app reads this table today (neither the web
 * app nor the Flutter app shows these banners). To reach people now, use Send
 * a message on Notifications, which writes to the in-app bell and phone push.
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  Megaphone, Plus, Edit2, Trash2, Save, Eye, EyeOff, AlertTriangle, Copy, CalendarClock, Users, Info, Clock,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toUserMessage } from '../../lib/safeError'
import {
  Panel, PanelHeader, Btn, Badge, ErrorState, LoadingState, EmptyState, Modal, StatTile, SearchInput, Toolbar,
  Segmented, Note, Table, THead, Th, Tr, Td, ConfirmImpactDialog, ImpactBox,
} from '../components/ui'
import { getAnnouncementAudience } from '../../lib/api/monitorCenter'
import { searchRows, sortRows, useTableSort } from '../../lib/consoleTable'
import { useConsoleAuth } from '../ConsoleAuthContext'
import ExportButtons from './shared/ExportButtons'
import { PageHeader, useUrlTab, usePaged, Pager, AttentionList, TabPanel, whenText, ageText, ConsoleLink } from './shared/pageKit'

const ROLES = ['Admin', 'Manager', 'Director', 'Inspector', 'Tyre Man', 'Tyre Data Collector', 'Fleet Supervisor',
  'Maintenance Supervisor', 'Workshop Supervisor', 'Reporter', 'Driver']
const COUNTRIES = ['KSA', 'UAE', 'Egypt']
const PRIORITIES = [{ value: '0', label: 'Normal' }, { value: '10', label: 'High (shown first)' }]
const TYPES = ['info', 'warning', 'success', 'critical']
const TYPE_TONE = { info: 'info', warning: 'warning', success: 'good', critical: 'danger' }
const TYPE_LABEL = { info: 'Info', warning: 'Warning', success: 'Success', critical: 'Critical' }
// The banner preview mirrors the colours users see in the app.
const BANNER_STYLE = {
  info: 'text-blue-300 bg-blue-900/20 border-blue-700/40',
  warning: 'text-amber-300 bg-amber-900/20 border-amber-700/40',
  success: 'text-emerald-300 bg-emerald-900/20 border-emerald-700/40',
  critical: 'text-red-300 bg-red-900/20 border-red-700/40',
}
const LONG_RUNNING_DAYS = 14
const PAGE_SIZE = 20
const TABS = ['live', 'scheduled', 'inactive', 'expired', 'all']

const EMPTY = {
  title: '', message: '', type: 'info', target_roles: [], target_countries: [],
  target_org_id: null, active: true, show_until: '', show_from: '', priority: '0',
}

const isExpired = (a, now = Date.now()) => !!a.show_until && new Date(a.show_until).getTime() < now
const isScheduled = (a, now = Date.now()) => !!a.show_from && new Date(a.show_from).getTime() > now
const isLive = (a, now = Date.now()) => !!a.active && !isExpired(a, now) && !isScheduled(a, now)
/** datetime-local value (local time) for an ISO string. */
const toLocalInput = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export default function ConsoleAnnouncements({ tabParam = 'tab' } = {}) {
  const { logAction, activeOrg } = useConsoleAuth()
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [readAt, setReadAt] = useState(null)
  const [actionError, setActionError] = useState('')
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [orgs, setOrgs] = useState([])
  const [orgsError, setOrgsError] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [query, setQuery] = useState('')
  const [targetedOnly, setTargetedOnly] = useState(false)
  const [tab, setTab] = useUrlTab(TABS, 'live', tabParam)
  const [audience, setAudience] = useState({ loading: false, value: null, error: false })
  const [tidyOpen, setTidyOpen] = useState(false)
  const [tidyBusy, setTidyBusy] = useState(false)
  const [tidyError, setTidyError] = useState('')
  const [flash, setFlash] = useState('')

  // Company names are only labels here, but a failed read must not look like
  // "every announcement goes to all companies".
  useEffect(() => {
    supabase.from('organisations').select('id, name').order('name')
      .then(({ data, error: err }) => {
        if (err) { setOrgsError(true); setOrgs([]); return }
        setOrgsError(false); setOrgs(data ?? [])
      }, () => setOrgsError(true))
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      const { data, error: err } = await supabase
        .from('announcements')
        .select('*')
        .order('created_at', { ascending: false })
      // An unread error used to render as an empty list, so "we could not look"
      // and "there are none" looked identical.
      if (err) throw err
      setList(data ?? [])
      setReadAt(Date.now())
    } catch (e) {
      setLoadError(toUserMessage(e, 'Could not load announcements.'))
      setList([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const orgName = useCallback((id) => {
    if (!id) return 'All companies'
    const o = orgs.find((x) => x.id === id)
    return o ? o.name : (orgsError ? 'One company (name unavailable)' : 'One company')
  }, [orgs, orgsError])

  function openCreate() {
    setForm({ ...EMPTY, target_org_id: activeOrg?.id ?? null })
    setError(null); setModal('create')
  }
  function formFrom(ann) {
    return {
      title: ann.title ?? '', message: ann.body ?? '', type: ann.type ?? 'info',
      target_roles: ann.target_roles ?? [], target_countries: ann.target_countries ?? [], target_org_id: ann.target_org_id ?? null,
      active: ann.active ?? true, show_until: ann.show_until ? ann.show_until.slice(0, 10) : '',
      show_from: ann.show_from && new Date(ann.show_from).getTime() > Date.now() ? toLocalInput(ann.show_from) : '',
      priority: String(Number(ann.priority) > 0 ? 10 : 0),
    }
  }
  function openEdit(ann) {
    setForm(formFrom(ann))
    setError(null); setDetail(null); setModal({ type: 'edit', id: ann.id })
  }
  /** A copy starts switched off so it is never published by accident. */
  function openDuplicate(ann) {
    setForm({ ...formFrom(ann), title: `${ann.title ?? ''} (copy)`.trim(), active: false })
    setError(null); setDetail(null); setModal('create')
  }

  async function handleSave() {
    if (!form.title.trim()) { setError('Title is required.'); return }
    if (!form.message.trim()) { setError('Message is required.'); return }
    if (form.show_from && form.show_until && new Date(form.show_from).getTime() > new Date(form.show_until + 'T23:59:59Z').getTime()) {
      setError('The start is after the expiry date, so this would never show. Move one of the dates.')
      return
    }
    if (form.active && form.show_until && new Date(form.show_until + 'T23:59:59Z').getTime() < Date.now()) {
      setError('The expiry date is already in the past, so users would never see this. Pick a later date, clear it, or save it switched off.')
      return
    }
    setSaving(true); setError(null)
    try {
      const payload = {
        title: form.title.trim(), body: form.message.trim(), type: form.type,
        target_roles: form.target_roles.length ? form.target_roles : null,
        target_countries: form.target_countries.length ? form.target_countries : null,
        target_org_id: form.target_org_id || null,
        active: form.active,
        show_until: form.show_until ? new Date(form.show_until + 'T23:59:59Z').toISOString() : null,
        priority: Number(form.priority) || 0,
      }
      // show_from is NOT NULL (default now()): only send it when a future start is chosen.
      if (form.show_from) payload.show_from = new Date(form.show_from).toISOString()
      else if (modal === 'create') payload.show_from = new Date().toISOString()
      if (modal === 'create') {
        const { data, error: err } = await supabase.from('announcements').insert(payload).select().single()
        if (err) { setError(toUserMessage(err, 'Could not save the announcement.')); setSaving(false); return }
        await logAction('create_announcement', data.id, 'announcement', { title: data.title })
      } else {
        const { error: err } = await supabase.from('announcements').update(payload).eq('id', modal.id)
        if (err) { setError(toUserMessage(err, 'Could not save the announcement.')); setSaving(false); return }
        await logAction('update_announcement', modal.id, 'announcement', { title: payload.title })
      }
      setSaving(false); setModal(null); load()
    } catch (e) {
      setError(toUserMessage(e, 'Could not save the announcement.')); setSaving(false)
    }
  }

  async function toggleActive(ann) {
    setBusyId(ann.id); setActionError('')
    try {
      const { error: err } = await supabase.from('announcements').update({ active: !ann.active }).eq('id', ann.id)
      if (err) throw err
      await logAction?.(ann.active ? 'announcement_hide' : 'announcement_show', ann.id, 'announcement', { title: ann.title })
      setDetail((d) => (d && d.id === ann.id ? { ...d, active: !ann.active } : d))
      await load()
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not change the announcement.'))
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(ann, reason) {
    setDeleting(true); setDeleteError(null)
    try {
      const { error: err } = await supabase.from('announcements').delete().eq('id', ann.id)
      if (err) throw err
      await logAction?.('delete_announcement', ann.id, 'announcement', { title: ann.title, reason })
      setConfirmDel(null); setDetail(null); load()
    } catch (e) {
      setDeleteError(toUserMessage(e, 'Could not delete the announcement.'))
    } finally {
      setDeleting(false)
    }
  }

  async function tidyExpired({ reason }) {
    const ids = list.filter((a) => a.active && isExpired(a)).map((a) => a.id)
    setTidyBusy(true); setTidyError('')
    try {
      const { error: err } = await supabase.from('announcements').update({ active: false }).in('id', ids)
      if (err) throw err
      await logAction?.('announcement_tidy_expired', null, 'announcement', { count: ids.length, reason })
      setFlash(`${ids.length} expired announcement${ids.length === 1 ? '' : 's'} switched off.`)
      setTidyOpen(false); await load()
    } catch (e) {
      setTidyError(toUserMessage(e, 'The announcements could not be switched off. Nothing was changed.'))
    } finally { setTidyBusy(false) }
  }

  // Live count of accounts a banner with these roles and countries would match.
  useEffect(() => {
    if (!modal) return undefined
    let alive = true
    setAudience((a) => ({ ...a, loading: true, error: false }))
    const t = setTimeout(() => {
      getAnnouncementAudience(form.target_roles, form.target_countries)
        .then((v) => { if (alive) setAudience({ loading: false, value: v, error: false }) })
        .catch(() => { if (alive) setAudience({ loading: false, value: null, error: true }) })
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [modal, form.target_roles, form.target_countries])

  const toggleCountry = (c) =>
    setForm((f) => ({ ...f, target_countries: f.target_countries.includes(c) ? f.target_countries.filter((x) => x !== c) : [...f.target_countries, c] }))

  const toggleRole = (r) =>
    setForm((f) => ({ ...f, target_roles: f.target_roles.includes(r) ? f.target_roles.filter((x) => x !== r) : [...f.target_roles, r] }))

  const counts = useMemo(() => {
    const now = Date.now()
    return {
      live: list.filter((a) => isLive(a, now)).length,
      scheduled: list.filter((a) => a.active && isScheduled(a, now) && !isExpired(a, now)).length,
      inactive: list.filter((a) => !a.active).length,
      expired: list.filter((a) => isExpired(a, now)).length,
      expiredButOn: list.filter((a) => a.active && isExpired(a, now)).length,
      targeted: list.filter((a) => (a.target_roles && a.target_roles.length) || (a.target_countries && a.target_countries.length) || a.target_org_id).length,
      liveCritical: list.filter((a) => isLive(a, now) && a.type === 'critical').length,
      longRunning: list.filter((a) => isLive(a, now) && a.created_at
        && now - new Date(a.created_at).getTime() > LONG_RUNNING_DAYS * 86400000 && !a.show_until).length,
      expiringSoon: list.filter((a) => isLive(a, now) && a.show_until
        && new Date(a.show_until).getTime() - now < 3 * 86400000).length,
    }
  }, [list])

  const { sort, onSort } = useTableSort({ key: 'created_at', dir: 'desc' })
  const shown = useMemo(() => {
    const now = Date.now()
    const byTab = list.filter((a) => (
      tab === 'live' ? isLive(a, now)
        : tab === 'scheduled' ? (a.active && isScheduled(a, now) && !isExpired(a, now))
        : tab === 'inactive' ? !a.active
          : tab === 'expired' ? isExpired(a, now) : true))
    const byTarget = targetedOnly ? byTab.filter((a) => (a.target_roles && a.target_roles.length) || (a.target_countries && a.target_countries.length) || a.target_org_id) : byTab
    return sortRows(searchRows(byTarget, query, ['title', 'body', 'type']), sort, {
      audience: (a) => `${orgName(a.target_org_id)} ${(a.target_roles || []).join(',')}`,
      type: (a) => TYPES.indexOf(a.type),
    })
  }, [list, tab, targetedOnly, query, sort, orgName])
  const paged = usePaged(shown, PAGE_SIZE, `${tab}|${targetedOnly}|${query}|${sort?.key}|${sort?.dir}`)

  const exportColumns = useMemo(() => [
    { key: 'title', header: 'Title' },
    { key: 'type', header: 'Type' },
    { key: 'body', header: 'Message' },
    { key: 'status', header: 'Status', value: (a) => (isLive(a) ? 'Live' : !a.active ? 'Off' : isExpired(a) ? 'On but expired' : 'Scheduled') },
    { key: 'company', header: 'Company', value: (a) => orgName(a.target_org_id) },
    { key: 'roles', header: 'Roles', value: (a) => (a.target_roles && a.target_roles.length ? a.target_roles.join(', ') : 'All roles') },
    { key: 'countries', header: 'Countries', value: (a) => (a.target_countries && a.target_countries.length ? a.target_countries.join(', ') : 'All countries') },
    { key: 'show_from', header: 'Starts' },
    { key: 'priority', header: 'Priority', value: (a) => (Number(a.priority) > 0 ? 'High' : 'Normal') },
    { key: 'show_until', header: 'Expires' },
    { key: 'created_at', header: 'Created' },
  ], [orgName])

  const pick = (t) => { setTab(t); setTargetedOnly(false) }
  const attention = []
  if (!loadError && !loading) {
    if (counts.expiredButOn) {
      attention.push({ key: 'exp', tone: 'warning', text: `${counts.expiredButOn} ${counts.expiredButOn === 1 ? 'announcement is' : 'announcements are'} switched on but past the expiry date, so no user sees ${counts.expiredButOn === 1 ? 'it' : 'them'}.`, actionLabel: 'Switch them off', onAction: () => { setTidyError(''); setTidyOpen(true) } })
    }
    if (counts.liveCritical) {
      attention.push({ key: 'crit', tone: 'danger', text: `${counts.liveCritical} critical ${counts.liveCritical === 1 ? 'banner is' : 'banners are'} live right now. Check ${counts.liveCritical === 1 ? 'it is' : 'they are'} still true.`, actionLabel: 'Show live', onAction: () => pick('live') })
    }
    if (counts.longRunning) {
      attention.push({ key: 'long', tone: 'info', text: `${counts.longRunning} live ${counts.longRunning === 1 ? 'banner has' : 'banners have'} run for over ${LONG_RUNNING_DAYS} days with no expiry date. Old banners teach users to ignore banners.`, actionLabel: 'Show live', onAction: () => pick('live') })
    }
    if (counts.expiringSoon) {
      attention.push({ key: 'soon', tone: 'info', text: `${counts.expiringSoon} live ${counts.expiringSoon === 1 ? 'banner expires' : 'banners expire'} within 3 days.`, actionLabel: 'Show live', onAction: () => pick('live') })
    }
  }

  const tile = (n) => (loadError ? 'N/A' : loading && !readAt ? '...' : n)
  const TAB_LABEL = { live: 'Live', scheduled: 'Scheduled', inactive: 'Switched off', expired: 'Expired', all: 'All' }

  return (
    <div className="space-y-4 max-w-6xl">
      <PageHeader
        icon={Megaphone}
        title="Announcements"
        purpose="Banners for every user, or only chosen roles, countries or one company, with a start and an end date."
        refreshedAt={readAt}
        onRefresh={load}
        refreshing={loading}
        actions={<Btn variant="primary" icon={Plus} onClick={openCreate}>New Announcement</Btn>}
      />

      <Note icon={Info} tone="warning">
        No app shows these banners yet: neither the web app nor the Flutter app reads this list. Saving here records the banner but
        nobody sees it. To reach people now, use <ConsoleLink plain to="/console/notifications?compose=1">Send a message</ConsoleLink> (in-app bell and phone push).
      </Note>
      {flash && <Note icon={Info} tone="accent">{flash}</Note>}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatTile icon={Megaphone} label="Live now" value={tile(counts.live)} tone="accent" sub="Switched on and not expired"
          onClick={() => pick('live')} active={tab === 'live' && !targetedOnly} />
        <StatTile icon={Clock} label="Scheduled" value={tile(counts.scheduled)} sub="Start date still ahead"
          onClick={() => pick('scheduled')} active={tab === 'scheduled' && !targetedOnly} />
        <StatTile icon={EyeOff} label="Switched off" value={tile(counts.inactive)} sub="Hidden from users"
          onClick={() => pick('inactive')} active={tab === 'inactive' && !targetedOnly} />
        <StatTile icon={CalendarClock} label="Expired" value={tile(counts.expired)} tone={!loadError && counts.expired ? 'warning' : 'default'}
          sub="Past their show-until date" onClick={() => pick('expired')} active={tab === 'expired' && !targetedOnly} />
        <StatTile icon={Users} label="Targeted" value={tile(counts.targeted)} sub="Limited by role, country or company"
          onClick={() => { setTab('all'); setTargetedOnly(true) }} active={targetedOnly} />
      </div>

      {loadError ? <ErrorState message={loadError} onRetry={load} /> : (
        <AttentionList items={attention} clear={loading ? 'Checking...' : 'Every live banner has a sensible expiry and nothing is stuck.'} />
      )}
      {actionError && <ErrorState message={actionError} />}
      {orgsError && <Note icon={AlertTriangle} tone="warning">Company names could not be read, so a banner limited to one company shows without its name.</Note>}

      <Panel>
        <PanelHeader
          icon={Megaphone}
          title="Announcements"
          subtitle="Click a row to read the full message and see how the banner looks."
          actions={(
            <Toolbar>
              <SearchInput value={query} onChange={setQuery} placeholder="Search title, message or type" className="w-full sm:w-64" ariaLabel="Search announcements" />
              <ExportButtons rows={shown} columns={exportColumns} title="Announcements" disabled={!!loadError} />
            </Toolbar>
          )}
        />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Segmented ariaLabel="Announcement status" value={tab} onChange={(t) => { setTab(t); setTargetedOnly(false) }} options={[
            { key: 'live', label: TAB_LABEL.live, count: loadError ? null : counts.live },
            { key: 'scheduled', label: TAB_LABEL.scheduled, count: loadError ? null : counts.scheduled },
            { key: 'inactive', label: TAB_LABEL.inactive, count: loadError ? null : counts.inactive },
            { key: 'expired', label: TAB_LABEL.expired, count: loadError ? null : counts.expired },
            { key: 'all', label: TAB_LABEL.all, count: loadError ? null : list.length },
          ]} />
          {targetedOnly && <Btn size="xs" onClick={() => setTargetedOnly(false)}>Showing targeted only: clear</Btn>}
        </div>

        <TabPanel label={TAB_LABEL[tab]}>
          {loadError ? (
            <EmptyState icon={AlertTriangle} title="Announcements could not be read"
              reason="Nothing is listed because the read failed, not because there are none. Retry above." />
          ) : loading && !readAt ? (
            <LoadingState label="Loading announcements" rows={3} />
          ) : list.length === 0 ? (
            <EmptyState icon={Megaphone} title="No announcements yet"
              reason="Nothing has been published to users. Create one to show a banner in the app."
              action={<Btn variant="primary" icon={Plus} onClick={openCreate}>Create the first one</Btn>} />
          ) : shown.length === 0 ? (
            <EmptyState icon={Megaphone} title={query ? 'No announcements match this search' : `No ${TAB_LABEL[tab].toLowerCase()} announcements`}
              reason={query ? 'Clear or change the search to see every announcement.' : 'Pick another status above to see the rest.'}
              action={<Btn onClick={() => { setQuery(''); setTab('all'); setTargetedOnly(false) }}>Show all</Btn>} />
          ) : (
            <>
              <Table>
                <THead>
                  <Th sortKey="title" sort={sort} onSort={onSort}>Title</Th>
                  <Th sortKey="type" sort={sort} onSort={onSort}>Type</Th>
                  <Th sortKey="audience" sort={sort} onSort={onSort}>Audience</Th>
                  <Th sortKey="show_until" sort={sort} onSort={onSort}>Expires</Th>
                  <Th sortKey="created_at" sort={sort} onSort={onSort}>Created</Th>
                  <Th align="right">Actions</Th>
                </THead>
                <tbody>
                  {paged.rows.map((ann) => {
                    const expired = isExpired(ann)
                    return (
                      <Tr key={ann.id} onClick={() => setDetail(ann)} ariaLabel={`Announcement ${ann.title}`}
                        className={ann.active ? '' : 'opacity-75'}>
                        <Td className="min-w-[14rem]">
                          <p className="text-gray-100 font-medium break-words">{ann.title}</p>
                          <p className="text-gray-500 line-clamp-1 break-words" title={ann.body || ''}>{ann.body}</p>
                        </Td>
                        <Td>
                          <div className="flex flex-wrap gap-1">
                            <Badge tone={TYPE_TONE[ann.type] || 'default'}>{TYPE_LABEL[ann.type] || ann.type}</Badge>
                            {!ann.active && <Badge tone="quiet">Off</Badge>}
                            {expired && <Badge tone="danger">Expired</Badge>}
                            {!expired && isScheduled(ann) && <Badge tone="info">Starts {new Date(ann.show_from).toLocaleDateString()}</Badge>}
                            {Number(ann.priority) > 0 && <Badge tone="accent">High</Badge>}
                          </div>
                        </Td>
                        <Td>
                          <span className="text-gray-300">{orgName(ann.target_org_id)}</span>
                          <span className="block text-[10px] text-gray-500">
                            {ann.target_roles && ann.target_roles.length ? ann.target_roles.join(', ') : 'All roles'}
                            {ann.target_countries && ann.target_countries.length ? ` | ${ann.target_countries.join(', ')}` : ''}
                          </span>
                        </Td>
                        <Td nowrap>{ann.show_until ? new Date(ann.show_until).toLocaleDateString() : <span className="text-gray-500">No expiry</span>}</Td>
                        <Td nowrap><span className="text-gray-500" title={whenText(ann.created_at)}>{ageText(ann.created_at) || 'N/A'}</span></Td>
                        <Td align="right">
                          <RowActions ann={ann} busy={busyId === ann.id} onToggle={toggleActive} onEdit={openEdit}
                            onDelete={() => { setDeleteError(null); setConfirmDel(ann) }} />
                        </Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </Table>
              <Pager paged={paged} label="announcements" />
            </>
          )}
        </TabPanel>
      </Panel>

      {/* Detail drawer */}
      <Modal open={!!detail} onClose={() => setDetail(null)} width="max-w-lg"
        title={detail?.title || ''}
        subtitle={detail ? `Created ${whenText(detail.created_at)}` : ''}
        footer={detail && (
          <>
            <Btn variant="danger" icon={Trash2} onClick={() => { setDeleteError(null); setConfirmDel(detail) }}>Delete</Btn>
            <Btn icon={Copy} onClick={() => openDuplicate(detail)}>Duplicate</Btn>
            <Btn icon={detail.active ? EyeOff : Eye} onClick={() => toggleActive(detail)} busy={busyId === detail.id}>
              {detail.active ? 'Switch off' : 'Switch on'}
            </Btn>
            <Btn variant="primary" icon={Edit2} onClick={() => openEdit(detail)}>Edit</Btn>
          </>
        )}>
        {detail && (
          <div className="space-y-3 text-xs">
            <BannerPreview type={detail.type} title={detail.title} body={detail.body} />
            <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-gray-400">
              <dt className="text-gray-500">Status</dt>
              <dd className="col-span-2">{isLive(detail) ? 'Live (no app displays banners yet)' : !detail.active ? 'Switched off: nobody sees it' : isExpired(detail) ? 'On, but expired: nobody sees it' : 'Scheduled: starts later'}</dd>
              <dt className="text-gray-500">Starts</dt><dd className="col-span-2">{detail.show_from ? whenText(detail.show_from) : 'Immediately'}</dd>
              <dt className="text-gray-500">Countries</dt><dd className="col-span-2">{detail.target_countries && detail.target_countries.length ? detail.target_countries.join(', ') : 'All countries'}</dd>
              <dt className="text-gray-500">Priority</dt><dd className="col-span-2">{Number(detail.priority) > 0 ? 'High (shown first)' : 'Normal'}</dd>
              <dt className="text-gray-500">Company</dt><dd className="col-span-2">{orgName(detail.target_org_id)}</dd>
              <dt className="text-gray-500">Roles</dt><dd className="col-span-2">{detail.target_roles && detail.target_roles.length ? detail.target_roles.join(', ') : 'All roles'}</dd>
              <dt className="text-gray-500">Expires</dt><dd className="col-span-2">{detail.show_until ? whenText(detail.show_until) : 'No expiry'}</dd>
            </dl>
          </div>
        )}
      </Modal>

      {/* Create / edit */}
      <Modal
        open={!!modal}
        title={modal === 'create' ? 'New Announcement' : 'Edit Announcement'}
        onClose={() => { if (!saving) setModal(null) }}
        width="max-w-xl"
        footer={(
          <>
            <Btn onClick={() => setModal(null)} disabled={saving}>Cancel</Btn>
            <Btn variant="primary" icon={Save} onClick={handleSave} busy={saving}>{saving ? 'Saving...' : 'Save'}</Btn>
          </>
        )}
      >
        <div className="space-y-4">
          {error && (
            <div role="alert" className="flex items-center gap-2 p-3 rounded-lg bg-red-950/50 border border-red-800/50">
              <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
              <p className="text-xs text-red-300 break-words">{error}</p>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label htmlFor="ann-title" className="field-label">Title *</label>
              <input id="ann-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className="input-dark" placeholder="System maintenance on Saturday..." maxLength={140} />
            </div>
            <div>
              <label htmlFor="ann-type" className="field-label">Type</label>
              <select id="ann-type" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                className="input-dark">
                {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ann-org" className="field-label">Organisation</label>
              <select id="ann-org" value={form.target_org_id ?? ''} onChange={(e) => setForm((f) => ({ ...f, target_org_id: e.target.value || null }))}
                className="input-dark">
                <option value="">All Organisations</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ann-starts" className="field-label">Starts (blank = now)</label>
              <input id="ann-starts" type="datetime-local" value={form.show_from} onChange={(e) => setForm((f) => ({ ...f, show_from: e.target.value }))}
                className="input-dark" />
            </div>
            <div>
              <label htmlFor="ann-priority" className="field-label">Priority</label>
              <select id="ann-priority" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} className="input-dark">
                {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ann-expires" className="field-label">Expires</label>
              <input id="ann-expires" type="date" value={form.show_until} onChange={(e) => setForm((f) => ({ ...f, show_until: e.target.value }))}
                className="input-dark" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                  className="w-4 h-4 accent-orange-500" />
                <span className="text-xs text-gray-300">Active (visible to users)</span>
              </label>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="ann-message" className="field-label">Message *</label>
              <textarea id="ann-message" value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                rows={4} placeholder="Write your announcement message here..."
                className="input-dark resize-none" />
            </div>
            <fieldset className="sm:col-span-2">
              <legend className="field-label">Target Roles (leave empty = all roles)</legend>
              <div className="flex flex-wrap gap-2 mt-1">
                {ROLES.map((r) => {
                  const on = form.target_roles.includes(r)
                  return (
                    <button key={r} type="button" onClick={() => toggleRole(r)} aria-pressed={on}
                      className={`text-xs px-2.5 py-1 rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
                        on
                          ? 'bg-orange-900/40 text-orange-300 border-orange-700/40'
                          : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-gray-200'
                      }`}>{r}</button>
                  )
                })}
              </div>
            </fieldset>
            <fieldset className="sm:col-span-2">
              <legend className="field-label">Target countries (leave empty = all countries)</legend>
              <div className="flex flex-wrap gap-2 mt-1">
                {COUNTRIES.map((c) => {
                  const on = form.target_countries.includes(c)
                  return (
                    <button key={c} type="button" onClick={() => toggleCountry(c)} aria-pressed={on}
                      className={`text-xs px-2.5 py-1 rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
                        on ? 'bg-orange-900/40 text-orange-300 border-orange-700/40' : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-gray-200'
                      }`}>{c}</button>
                  )
                })}
              </div>
            </fieldset>
            <div className="sm:col-span-2">
              <ImpactBox what="Who this banner is for" tone="info"
                stats={[
                  { label: 'Matching accounts', value: audience.loading ? '...' : audience.value?.accounts ?? null },
                  { label: 'Signed in, 30 days', value: audience.loading ? '...' : audience.value?.signed_in_30d ?? null },
                  { label: 'Company', value: form.target_org_id ? 'One' : 'All' },
                ]}
                change={form.active ? (form.show_from ? 'The banner is recorded and becomes live at its start time.' : 'The banner is recorded as live now.') : 'The banner is saved switched off.'}
                who={audience.error ? 'The audience could not be counted.' : 'The accounts above, limited to the chosen company if one is set. No app displays banners yet.'}
                undo="Yes. Edit it, switch it off or delete it here." />
            </div>
            <div className="sm:col-span-2">
              <p className="field-label">Preview</p>
              <BannerPreview type={form.type} title={form.title || 'Your title'} body={form.message || 'Your message'} />
            </div>
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      <ConfirmImpactDialog
        open={!!confirmDel}
        title="Delete announcement?"
        danger
        requireReason
        typedWord="DELETE"
        confirmLabel="Delete"
        busy={deleting}
        error={deleteError}
        onCancel={() => { if (!deleting) setConfirmDel(null) }}
        onConfirm={({ reason }) => handleDelete(confirmDel, reason)}
        impact={{
          what: `Delete "${confirmDel?.title || ''}".`, tone: 'danger',
          change: 'The announcement and its wording are removed permanently.',
          who: 'Nobody sees banners yet, so no user notices. The record is gone for admins.',
          undo: 'No. Switch it off instead to keep it.',
        }}
      />

      <ConfirmImpactDialog
        open={tidyOpen}
        title="Switch off expired announcements?"
        requireReason
        confirmLabel="Switch them off"
        busy={tidyBusy}
        error={tidyError}
        readyExtra={counts.expiredButOn > 0}
        onCancel={() => { if (!tidyBusy) setTidyOpen(false) }}
        onConfirm={tidyExpired}
        impact={{
          what: `Switch off ${counts.expiredButOn} announcement${counts.expiredButOn === 1 ? '' : 's'} that are on but past their expiry.`,
          tone: 'info',
          change: 'Each one is marked switched off. Nothing is deleted.',
          who: 'Nobody: they were already past their expiry, so no user could see them.',
          undo: 'Yes. Switch any of them on again (with a new expiry).',
        }}
      />
    </div>
  )
}

function BannerPreview({ type, title, body }) {
  return (
    <div className={`rounded-xl border p-3 ${BANNER_STYLE[type] || BANNER_STYLE.info}`}>
      <p className="text-sm font-semibold break-words">{title}</p>
      <p className="text-xs mt-0.5 break-words whitespace-pre-wrap opacity-90">{body}</p>
    </div>
  )
}

function RowActions({ ann, busy, onToggle, onEdit, onDelete }) {
  const stop = (fn) => (e) => { e.stopPropagation(); fn() }
  const cls = 'p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-50'
  return (
    <div className="inline-flex items-center gap-1">
      <button type="button" onClick={stop(() => onToggle(ann))} disabled={busy}
        aria-label={ann.active ? `Deactivate ${ann.title}` : `Activate ${ann.title}`}
        className={cls} title={ann.active ? 'Deactivate' : 'Activate'}>
        {ann.active ? <Eye size={13} /> : <EyeOff size={13} />}
      </button>
      <button type="button" onClick={stop(() => onEdit(ann))} aria-label={`Edit ${ann.title}`} className={cls} title="Edit">
        <Edit2 size={13} />
      </button>
      <button type="button" onClick={stop(onDelete)} disabled={busy} aria-label={`Delete ${ann.title}`}
        className={`${cls} text-red-400 hover:text-red-300`} title="Delete">
        <Trash2 size={13} />
      </button>
    </div>
  )
}
