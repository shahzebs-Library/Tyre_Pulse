/**
 * Read-only live progress for AI tyre jobs of one inspection.
 * Realtime (debounced) + a 5s poll that runs ONLY while jobs are pending.
 */
import { supabase } from './_client'

export async function readJobStatuses(inspectionId) {
  if (typeof inspectionId !== 'string' || !/^[a-f0-9-]{36}$/i.test(inspectionId)) return []
  const { data, error } = await supabase.from('ai_tyre_inspection_jobs')
    .select('id,status').eq('inspection_id', inspectionId).limit(200)
  if (error) throw error
  return data || []
}

export function subscribeAiTyreJobs(inspectionId, onChange) {
  const channel = supabase
    .channel(`ai-tyre-progress-${inspectionId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'ai_tyre_inspection_jobs', filter: `inspection_id=eq.${inspectionId}` },
      onChange)
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}
