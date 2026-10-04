/**
 * ConsoleUsersHome - the approved Users screen (/console/users).
 *
 * Tabs keep every capability of the four pages this screen replaces:
 *   People (new)            headline figures, Needs attention, facets, bulk actions
 *   Edit and grants         the full user editor (profile, role, country, sites,
 *                           web access, passwords, bulk grants, insights)
 *   Sessions and devices    was /console/sessions
 *   Account deletions       was /console/account-deletions
 *   Support sessions        was /console/support-sessions
 * Old routes redirect here with ?tab=. The person page is /console/users/:id.
 */
import { Suspense, lazy } from 'react'
import { Users } from 'lucide-react'
import { LoadingState } from '../components/ui'
import { PageHeader, useUrlTab } from './shared/pageKit'
import { PageTabs } from './platform/PlatformKit'
import usePeople from './platform/users/usePeople'
import PeopleTab from './platform/users/PeopleTab'

const ConsoleUsers = lazy(() => import('./ConsoleUsers'))
const ConsoleSessions = lazy(() => import('./ConsoleSessions'))
const ConsoleAccountDeletions = lazy(() => import('./ConsoleAccountDeletions'))
const ConsoleSupportSessions = lazy(() => import('./ConsoleSupportSessions'))

const TABS = ['people', 'manage', 'sessions', 'deletions', 'support']

export default function ConsoleUsersHome() {
  const [tab, setTab] = useUrlTab(TABS, 'people')
  const data = usePeople()

  const openManage = (_id, target = 'manage') => setTab(target)

  return (
    <div className="space-y-4">
      <PageHeader icon={Users} title="Users"
        purpose="Everyone who can sign in to Tyre Pulse. Approve, change roles, lock and sign people out, and see who is really using the app. Every bulk action shows who it affects first."
        refreshedAt={data.loadedAt} onRefresh={data.reload} refreshing={data.loading} />
      <PageTabs value={tab} onChange={setTab} label="Users sections" tabs={[
        { key: 'people', label: 'People', count: data.people?.length ?? null },
        { key: 'manage', label: 'Edit and grants' },
        { key: 'sessions', label: 'Sessions and devices' },
        { key: 'deletions', label: 'Account deletions', count: Array.isArray(data.deletions) ? data.deletions.length : null },
        { key: 'support', label: 'Support sessions', count: data.supportCount ?? null },
      ]} />
      {tab === 'people' && <PeopleTab data={data} onOpenManage={openManage} />}
      <Suspense fallback={<LoadingState label="Loading" rows={6} />}>
        {tab === 'manage' && <ConsoleUsers tabParam="mtab" />}
        {tab === 'sessions' && <ConsoleSessions tabParam="stab" />}
        {tab === 'deletions' && <ConsoleAccountDeletions tabParam="dtab" />}
        {tab === 'support' && <ConsoleSupportSessions tabParam="sptab" />}
      </Suspense>
    </div>
  )
}
