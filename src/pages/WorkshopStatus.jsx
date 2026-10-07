/**
 * WorkshopStatus (route /daily-ops/workshop) - Daily Ops -> Workshop Status,
 * on the Command Center kit (src/components/commandCenter/kit.jsx).
 *
 * Guarded by ModuleRoute moduleKey="daily_ops:workshop". The tab is read from
 * `?tab=` so a view can be linked. The caller's workshop permissions are read
 * once here (workshop_status_my_permissions, fails closed) and passed to every
 * tab; the server re-checks every action regardless.
 *
 * Active vehicles (Loop 7) is the default working tab; Daily upload (Loop 5)
 * follows. Later loops add their tab to TABS; no empty placeholder tab is
 * rendered (the spec forbids placeholder screens).
 *
 * Released (Loop 11) lists vehicles that left the report, with disposition,
 * restore, archive and delete actions.
 *
 * `onUpdate` opens the Vehicle Update Drawer (Loop 8) for a record; the
 * drawer saves through workshop_status_update_record, and bumping
 * reloadKey refreshes the list.
 *
 * Notifications (Loop 12): the caller's own Workshop Status notices show in a
 * strip under the tab bar (WorkshopNotificationsPanel). Their deep links land
 * here as ?record=<id> (exact vehicle), ?vehicle=<asset> (search) or
 * ?focus=<preset> (filtered list); the Active vehicles tab applies them.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Wrench } from 'lucide-react'
import { PageHero, Tabs } from '../components/commandCenter/kit'
import DailyUploadPanel from '../components/workshopStatus/DailyUploadPanel'
import ActiveVehiclesPanel from '../components/workshopStatus/ActiveVehiclesPanel'
import VehicleUpdateDrawer from '../components/workshopStatus/VehicleUpdateDrawer'
import VehicleHistoryDrawer from '../components/workshopStatus/VehicleHistoryDrawer'
import ActivityLogPanel from '../components/workshopStatus/ActivityLogPanel'
import TeamWorkloadPanel from '../components/workshopStatus/TeamWorkloadPanel'
import RemovedRecordsPanel from '../components/workshopStatus/RemovedRecordsPanel'
import WorkshopNotificationsPanel from '../components/workshopStatus/WorkshopNotificationsPanel'
import { getCurrentUserId } from '../lib/api/workshopStatusNotifications'
import { focusFilters, WORKSHOP_FOCUS } from '../lib/workshopStatus/notificationLinks'
import { useLanguage } from '../contexts/LanguageContext'
import { loadMyWorkshopPermissions } from '../lib/api/workshopStatusPermissions'
import { NO_WORKSHOP_PERMISSIONS } from '../lib/workshopStatus/permissions'
import '../components/workshopStatus/workshopStatus.css'

/**
 * Tabs in display order. `key` is the ?tab= value; `labelKey` resolves under
 * workshopStatus.page.tabs, or under `ns` when a tab carries its own
 * namespace. `requires` (any of) gates the tab on the caller's workshop
 * permissions; the server still enforces every read. Add new tabs here (and
 * their panel below).
 */
export const TABS = [
  { key: 'active', labelKey: 'active' },
  { key: 'activity', labelKey: 'activity', ns: 'workshopStatusActivity.tabs', requires: ['view_activity'] },
  { key: 'workload', labelKey: 'workload', ns: 'workshopStatusActivity.tabs', requires: ['view_activity', 'view_reports'] },
  { key: 'removed', labelKey: 'removed', ns: 'workshopStatusRemoved.tabs', requires: ['view_removed'] },
  { key: 'upload', labelKey: 'upload' },
]
const DEFAULT_TAB = 'active'

/** Tabs the caller may see: a gated tab needs at least one of its `requires`. */
export function visibleTabs(permissions) {
  return TABS.filter((x) => !x.requires || x.requires.some((k) => permissions?.[k] === true))
}

export default function WorkshopStatus() {
  const { t } = useLanguage()
  const p = useCallback((k, v) => t(`workshopStatus.page.${k}`, v), [t])
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')

  const [permissions, setPermissions] = useState(NO_WORKSHOP_PERMISSIONS)
  const [permState, setPermState] = useState('loading') // loading | ready | error
  const shownTabs = visibleTabs(permissions)
  // While permissions load, a linked gated tab stays selected (its panel shows
  // the loading state); once they are known, a tab the caller may not see
  // falls back to the default.
  const tab = shownTabs.some((x) => x.key === requested)
    || (permState === 'loading' && TABS.some((x) => x.key === requested))
    ? requested
    : DEFAULT_TAB
  const [editing, setEditing] = useState(null)
  const [historyOf, setHistoryOf] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const refreshList = useCallback(() => setReloadKey((k) => k + 1), [])

  const loadPerms = useCallback(async () => {
    setPermState('loading')
    const { permissions: perms, error } = await loadMyWorkshopPermissions()
    setPermissions(perms || NO_WORKSHOP_PERMISSIONS)
    setPermState(error ? 'error' : 'ready')
  }, [])

  useEffect(() => { loadPerms() }, [loadPerms])

  // Deep link from a notification. `mine` needs the signed-in user's id.
  const navigate = useNavigate()
  const linkRecord = params.get('record') || ''
  const linkVehicle = (params.get('vehicle') || '').trim()
  const linkFocus = WORKSHOP_FOCUS.includes(params.get('focus')) ? params.get('focus') : ''
  const [myId, setMyId] = useState(null)
  useEffect(() => {
    if (linkFocus !== 'mine' || myId) return
    let live = true
    getCurrentUserId().then((uid) => { if (live) setMyId(uid) })
    return () => { live = false }
  }, [linkFocus, myId])
  const focus = useMemo(() => {
    if (linkRecord) return { key: `record:${linkRecord}`, recordId: linkRecord }
    if (linkVehicle) return { key: `vehicle:${linkVehicle}`, vehicle: linkVehicle }
    if (linkFocus) {
      const filters = focusFilters(linkFocus, myId)
      return filters ? { key: `focus:${linkFocus}`, name: linkFocus, filters } : null
    }
    return null
  }, [linkRecord, linkVehicle, linkFocus, myId])
  const clearFocus = () => {
    const next = new URLSearchParams(params)
    for (const k of ['record', 'vehicle', 'focus']) next.delete(k)
    setParams(next, { replace: true })
  }

  const onTab = (key) => {
    const next = new URLSearchParams(params)
    if (key === DEFAULT_TAB) next.delete('tab'); else next.set('tab', key)
    setParams(next, { replace: true })
  }

  return (
    <div className="cc wks-page">
      <PageHero icon={Wrench} hello={p('eyebrow')} title={p('title')} lead={p('lead')} />

      <div className="cc-card wks-bar">
        <Tabs
          label={p('tabsLabel')}
          value={tab}
          onChange={onTab}
          tabs={shownTabs.map((x) => ({ key: x.key, label: t(`${x.ns || 'workshopStatus.page.tabs'}.${x.labelKey}`) }))}
        />
      </div>

      {permState === 'error' && (
        <div className="cc-card wks-banner warn" role="status">
          <p>{p('permLoadError')}</p>
        </div>
      )}

      {permState === 'ready' && permissions.view && (
        <WorkshopNotificationsPanel onOpen={(to) => navigate(to)} reloadKey={reloadKey} />
      )}

      {tab === 'active' && (
        <ActiveVehiclesPanel
          permissions={permissions}
          permState={permState}
          onRetryPermissions={loadPerms}
          onUpdate={setEditing}
          onHistory={setHistoryOf}
          reloadKey={reloadKey}
          focus={focus}
          onClearFocus={clearFocus}
        />
      )}

      <VehicleUpdateDrawer
        record={editing}
        open={!!editing}
        permissions={permissions}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); refreshList() }}
        onReload={() => { setEditing(null); refreshList() }}
      />

      <VehicleHistoryDrawer record={historyOf} open={!!historyOf} onClose={() => setHistoryOf(null)} />

      {tab === 'activity' && (
        <ActivityLogPanel permissions={permissions} permState={permState} onRetryPermissions={loadPerms} />
      )}

      {tab === 'workload' && (
        <TeamWorkloadPanel permissions={permissions} permState={permState} onRetryPermissions={loadPerms} />
      )}

      {tab === 'removed' && (
        <RemovedRecordsPanel
          permissions={permissions}
          permState={permState}
          onRetryPermissions={loadPerms}
          onHistory={setHistoryOf}
          onChanged={refreshList}
        />
      )}

      {tab === 'upload' && (
        <DailyUploadPanel permissions={permissions} permState={permState} onRetryPermissions={loadPerms} />
      )}
    </div>
  )
}
