/**
 * Loads everything the Users screen needs in parallel and keeps each part's
 * own error, so one failing read never blanks the page.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  listPlatformProfiles, getUserDirectory, listAccountsWithoutProfile, listOrgsFull, getMobileMinVersion,
} from '../../../../lib/api/consolePlatform'
import { listDeletionRequests } from '../../../../lib/api/accountDeletion'
import { mergePeople } from '../../../../lib/consolePlatform'
import { supabase } from '../../../../lib/supabase'
import { toUserMessage } from '../../../../lib/safeError'

async function settle(p) {
  try { return { ok: true, data: await p } } catch (err) { return { ok: false, error: toUserMessage(err, 'Could not load this part.') } }
}

async function countSupportSessions() {
  const { count, error } = await supabase.from('support_sessions').select('id', { count: 'exact', head: true })
  if (error) throw error
  return count ?? 0
}

export default function usePeople() {
  const [state, setState] = useState({ loading: true })
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const [profiles, directory, orphans, orgs, mobile, deletions, support] = await Promise.all([
      settle(listPlatformProfiles()),
      settle(getUserDirectory()),
      settle(listAccountsWithoutProfile()),
      settle(listOrgsFull()),
      settle(getMobileMinVersion()),
      settle(listDeletionRequests({ max: 500 })),
      settle(countSupportSessions()),
    ])
    const people = profiles.ok ? mergePeople(profiles.data || [], directory.ok ? directory.data : []) : []
    setState({
      loading: false,
      loadedAt: Date.now(),
      people,
      profilesError: profiles.ok ? null : profiles.error,
      directoryOk: directory.ok,
      directoryError: directory.ok ? null : directory.error,
      orphans: orphans.ok ? orphans.data : null,
      orgs: orgs.ok ? orgs.data || [] : [],
      minVersion: mobile.ok ? mobile.data?.min : null,
      deletions: deletions.ok ? (deletions.data?.rows ?? deletions.data ?? []) : null,
      supportCount: support.ok ? support.data : null,
    })
  }, [])
  useEffect(() => { load() }, [load])
  return { ...state, reload: load }
}
