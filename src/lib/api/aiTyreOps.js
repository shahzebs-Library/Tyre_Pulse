/**
 * Operations visibility reads for AI tyre inspection (RLS scoped, read only).
 * Jobs are paged past the 1000-row cap with an id tiebreak; failures throw so the panel can show Retry.
 */
import { supabase, fetchAllPages, toServiceError } from './_client'

const JOB_COLS = 'id,status,failure_kind,provider,model_version,cost_usd,created_at,updated_at,provider_called_at'
const CEILING = 50000

async function paged(build) {
  const { data, error, truncated } = await fetchAllPages(build, { max: CEILING })
  if (error) throw toServiceError(error, 'Could not load AI operations data.')
  return { rows: data || [], truncated: !!truncated }
}

/** @param {{days?:number}} opts window for queue/latency/failure/mix figures */
export async function loadAiTyreOps({ days = 30 } = {}) {
  const now = new Date()
  const since = new Date(now.getTime() - days * 86400000).toISOString()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const jobsQ = (from) => (a, b) => supabase.from('ai_tyre_inspection_jobs').select(JOB_COLS)
    .gte('created_at', from).order('created_at', { ascending: false }).order('id', { ascending: false }).range(a, b)
  const [jobs, monthJobs, logs, cfg] = await Promise.all([
    paged(jobsQ(since)),
    paged(jobsQ(monthStart)),
    paged((a, b) => supabase.from('ai_token_logs').select('id,feature,cost_usd,created_at')
      .gte('created_at', monthStart).order('created_at', { ascending: false }).order('id', { ascending: false }).range(a, b)),
    supabase.from('system_config').select('key,value').eq('key', 'ai_monthly_budget_usd'),
  ])
  // The budget control may be unreadable for some roles: treat as unknown (N/A), never as zero.
  const budgetRaw = cfg.error ? undefined : (cfg.data?.[0]?.value ?? '')
  return {
    jobs: jobs.rows, monthJobs: monthJobs.rows, monthLogs: logs.rows, budgetRaw,
    budgetReadable: !cfg.error,
    truncated: jobs.truncated || monthJobs.truncated || logs.truncated,
    days,
  }
}

/** Failed jobs (newest first), for the retry list. */
export async function listFailedJobs({ limit = 200 } = {}) {
  const { data, error } = await supabase.from('ai_tyre_inspection_jobs')
    .select('id,inspection_id,tyre_position,failure_kind,error_message,attempts,updated_at')
    .eq('status', 'failed').order('updated_at', { ascending: false }).order('id', { ascending: false }).limit(limit)
  if (error) throw toServiceError(error, 'Could not load failed jobs.')
  return data || []
}
