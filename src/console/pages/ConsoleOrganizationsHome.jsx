/**
 * ConsoleOrganizationsHome - the approved Organizations screen (/console/organisations).
 *
 * Tabs keep every capability of the pages it replaces:
 *   Overview (new)     figures, Needs attention, tenant cards, data volume,
 *                      empty-organization clean-up, owner-decision items
 *   Edit and lock      the full Organisations page (create, edit, lock, delete,
 *                      insights, members)
 *   Tenant export      was /console/tenant-export (server exports, retention)
 * Old routes redirect here with ?tab=.
 */
import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import { LoadingState } from '../components/ui'
import { PageHeader, useUrlTab } from './shared/pageKit'
import { PageTabs } from './platform/PlatformKit'
import OrgsOverview from './platform/orgs/OrgsOverview'
import { listOrgsFull, getOrgOverview, listOrgSubscriptions, getConfigValue } from '../../lib/api/consolePlatform'
import { toUserMessage } from '../../lib/safeError'

const ConsoleOrganisations = lazy(() => import('./ConsoleOrganisations'))
const ConsoleTenantExport = lazy(() => import('./ConsoleTenantExport'))

const TABS = ['overview', 'manage', 'exports']

function useOrgData() {
  const [state, setState] = useState({ loading: true })
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const settle = async (p) => { try { return { ok: true, data: await p } } catch (e) { return { ok: false, error: toUserMessage(e, 'Could not load this part.') } } }
    const [orgs, stats, subs, cap] = await Promise.all([
      settle(listOrgsFull()), settle(getOrgOverview()), settle(listOrgSubscriptions()), settle(getConfigValue('max_users_per_org')),
    ])
    setState({
      loading: false, loadedAt: Date.now(),
      orgs: orgs.ok ? orgs.data || [] : [], orgsError: orgs.ok ? null : orgs.error,
      stats: stats.ok ? stats.data : null, statsError: stats.ok ? null : stats.error,
      subs: subs.ok ? subs.data : null,
      platformCap: cap.ok && cap.data != null && cap.data !== '' ? Number(cap.data) : null,
    })
  }, [])
  useEffect(() => { load() }, [load])
  return { ...state, reload: load }
}

export default function ConsoleOrganizationsHome() {
  const [tab, setTab] = useUrlTab(TABS, 'overview')
  const [, setParams] = useSearchParams()
  const data = useOrgData()

  const goTab = (next, orgId) => {
    if (next === 'manage' && orgId) {
      setParams((p) => { const n = new URLSearchParams(p); n.set('tab', 'manage'); n.set('org', orgId); return n })
    } else setTab(next)
  }

  return (
    <div className="space-y-4">
      <PageHeader icon={Building2} title="Organizations"
        purpose="Every customer company on the platform: who is in it, how much data it holds, its plan, full exports, and what waits on an owner decision."
        refreshedAt={data.loadedAt} onRefresh={data.reload} refreshing={data.loading} />
      <PageTabs value={tab} onChange={setTab} label="Organizations sections" tabs={[
        { key: 'overview', label: 'Overview', count: data.orgs?.length ?? null },
        { key: 'manage', label: 'Edit and lock' },
        { key: 'exports', label: 'Tenant export' },
      ]} />
      {tab === 'overview' && <OrgsOverview data={data} onTab={goTab} />}
      <Suspense fallback={<LoadingState label="Loading" rows={6} />}>
        {tab === 'manage' && <ConsoleOrganisations tabParam="otab" />}
        {tab === 'exports' && <ConsoleTenantExport tabParam="etab" />}
      </Suspense>
    </div>
  )
}
