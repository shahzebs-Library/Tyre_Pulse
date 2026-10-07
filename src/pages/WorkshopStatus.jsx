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
 * `onUpdate` opens the Vehicle Update Drawer (Loop 8) for a record; the
 * drawer saves through workshop_status_update_record, and bumping
 * reloadKey refreshes the list.
 */
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Wrench } from 'lucide-react'
import { PageHero, Tabs } from '../components/commandCenter/kit'
import DailyUploadPanel from '../components/workshopStatus/DailyUploadPanel'
import ActiveVehiclesPanel from '../components/workshopStatus/ActiveVehiclesPanel'
import VehicleUpdateDrawer from '../components/workshopStatus/VehicleUpdateDrawer'
import ActivityLogPanel from '../components/workshopStatus/ActivityLogPanel'
import TeamWorkloadPanel from '../components/workshopStatus/TeamWorkloadPanel'
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
  const [reloadKey, setReloadKey] = useState(0)
  const refreshList = useCallback(() => setReloadKey((k) => k + 1), [])

  const loadPerms = useCallback(async () => {
    setPermState('loading')
    const { permissions: perms, error } = await loadMyWorkshopPermissions()
    setPermissions(perms || NO_WORKSHOP_PERMISSIONS)
    setPermState(error ? 'error' : 'ready')
  }, [])

  useEffect(() => { loadPerms() }, [loadPerms])

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

      {tab === 'active' && (
        <ActiveVehiclesPanel
          permissions={permissions}
          permState={permState}
          onRetryPermissions={loadPerms}
          onUpdate={setEditing}
          reloadKey={reloadKey}
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

      {tab === 'activity' && (
        <ActivityLogPanel permissions={permissions} permState={permState} onRetryPermissions={loadPerms} />
      )}

      {tab === 'workload' && (
        <TeamWorkloadPanel permissions={permissions} permState={permState} onRetryPermissions={loadPerms} />
      )}

      {tab === 'upload' && (
        <DailyUploadPanel permissions={permissions} permState={permState} onRetryPermissions={loadPerms} />
      )}
    </div>
  )
}
