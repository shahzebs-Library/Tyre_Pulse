/**
 * ConsoleSettings - the approved System Settings screen (/console/config).
 *
 * Tabs keep every capability of the pages it replaces:
 *   All settings (new)   every setting, impact before save, reason, per-setting
 *                        history and restore, connected services (write-only)
 *   Classic editor       the full System Configuration page (groups, FX rates,
 *                        stored keys)
 *   Navigation           was /console/navigation
 *   Report colours       was /console/appearance
 *   Vehicle designer     was /console/vehicle-designer
 *   Change history       every recorded change
 * Old routes redirect here with ?tab=.
 */
import { Suspense, lazy } from 'react'
import { Settings } from 'lucide-react'
import { LoadingState } from '../components/ui'
import { PageHeader, useUrlTab } from './shared/pageKit'
import { PageTabs } from './platform/PlatformKit'
import SettingsAll from './platform/settings/SettingsAll'

const ConsoleSystemConfig = lazy(() => import('./ConsoleSystemConfig'))
const ConsoleNavigation = lazy(() => import('./ConsoleNavigation'))
const ConsoleReportAppearance = lazy(() => import('./ConsoleReportAppearance'))
const ConsoleVehicleDesigner = lazy(() => import('./ConsoleVehicleDesigner'))
const SettingsHistory = lazy(() => import('./platform/settings/SettingsHistory'))

const TABS = ['all', 'classic', 'navigation', 'colours', 'vehicle', 'history']

export default function ConsoleSettings() {
  const [tab, setTab] = useUrlTab(TABS, 'all')
  return (
    <div className="space-y-4">
      <PageHeader icon={Settings} title="System Settings"
        purpose="Every platform-wide setting in one place, with its current value, when it last changed, and what a change will do before you save it. Secrets are never shown." />
      <PageTabs value={tab} onChange={setTab} label="Settings sections" tabs={[
        { key: 'all', label: 'All settings' },
        { key: 'classic', label: 'Classic editor' },
        { key: 'navigation', label: 'Navigation' },
        { key: 'colours', label: 'Report colours' },
        { key: 'vehicle', label: 'Vehicle designer' },
        { key: 'history', label: 'Change history' },
      ]} />
      {tab === 'all' && <SettingsAll onTab={setTab} />}
      <Suspense fallback={<LoadingState label="Loading" rows={6} />}>
        {tab === 'classic' && <ConsoleSystemConfig tabParam="ctab" />}
        {tab === 'navigation' && <ConsoleNavigation tabParam="ntab" />}
        {tab === 'colours' && <ConsoleReportAppearance sectionParam="asec" />}
        {tab === 'vehicle' && <ConsoleVehicleDesigner tabParam="vtab" />}
        {tab === 'history' && <SettingsHistory />}
      </Suspense>
    </div>
  )
}
