-- Workforce management analytics (Phase 8): server-side team analytics over the COMPLETE visible dataset.
-- STATUS: AUTHORED, NOT APPLIED. Review with database-migration-safety before applying.
--
-- Additive only: two read functions. No table, column, policy or data change.
-- Both are SECURITY INVOKER, so RLS decides what each caller can see:
--   * a manager (workforce_is_manager) sees the organisation's assignments and events;
--   * an employee sees only work currently assigned to them (and its events);
--   * another organisation's rows are invisible (RESTRICTIVE org policies).
-- Nothing is computed from a client page: every figure is an aggregate over every visible row in the window.
--
-- HONEST SEMANTICS (these are WORKFLOW FACTS, not productivity scores):
--   window          = assignments CREATED in [p_from, p_to] inclusive (NULL bound = open). Site filter is
--                     case-insensitive on workforce_assignments.site. The verification queue is the one
--                     exception: it is the CURRENT queue (all creation dates) for the site filter, labelled so.
--   per employee    = grouped by the CURRENT assignee (assigned_to). A reassigned task counts for whoever
--                     holds it now; reassignments are counted separately.
--   assigned        = every assignment in the window held by that employee (workload, any status).
--   awaiting_start  = status assigned or acknowledged.  active = in_progress.
--   overdue_open    = due_at in the past and not verified / cancelled.
--   rework_returns  = number of 'return' events (manager sent submitted work back).
--   rework_rate     = returns / (verified + returns); NULL when that denominator is 0.
--   active minutes  = time spent in_progress (workforce_assignment_durations view: blocked time and time
--                     waiting for review are excluded). Only VERIFIED assignments with a transition history
--                     are timed; verified work completed through the legacy direct status update has no
--                     trustworthy timestamps and is reported in coverage.verified_untimed, never guessed.
--   estimate vs actual = over verified rows that have BOTH estimated_minutes and active minutes; the
--                     sample size is returned beside the sums. Ratio = actual / estimated (NULL when n=0).
--   blocked minutes = per block episode: from the 'block' event to the next event that leaves the blocked
--                     state (resume / complete / cancel). Reassign or record-link events during a block do
--                     NOT end it. Reason = the block event's reason_code; NULL is reported as 'not_recorded'.
--                     An episode still open on a currently blocked assignment is counted up to now() in
--                     open_minutes, SEPARATELY from closed_minutes. An episode with no end on an assignment
--                     that is no longer blocked (legacy data) is counted in unmeasured_episodes only.
--   Every average / rate / ratio is NULL when nothing could be measured, never 0.
--
-- ROLLBACK:
--   DROP FUNCTION public.workforce_employee_timeline(uuid,date,date);
--   DROP FUNCTION public.workforce_team_analytics(date,date,text);

CREATE OR REPLACE FUNCTION public.workforce_team_analytics(p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_site text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public SET plan_cache_mode=force_custom_plan AS $$
 WITH w AS (
  SELECT a.* FROM public.workforce_assignments a
  WHERE (p_from IS NULL OR a.created_at>=p_from) AND (p_to IS NULL OR a.created_at<p_to+1)
    AND (nullif(btrim(p_site),'') IS NULL OR upper(btrim(a.site))=upper(btrim(p_site)))),
 e AS (SELECT ev.* FROM public.workforce_assignment_events ev JOIN w ON w.id=ev.assignment_id),
 -- One row per block episode.
 blk AS (
  SELECT b.assignment_id, coalesce(b.reason_code,'not_recorded') AS reason, b.effective_at AS start_at,
         nx.effective_at AS end_at, w.status AS cur_status
  FROM e b JOIN w ON w.id=b.assignment_id
  LEFT JOIN LATERAL (
    SELECT x.effective_at FROM e x
    WHERE x.assignment_id=b.assignment_id AND x.to_status<>'blocked'
      AND (x.effective_at,x.occurred_at,x.id)>(b.effective_at,b.occurred_at,b.id)
    ORDER BY x.effective_at,x.occurred_at,x.id LIMIT 1) nx ON true
  WHERE b.action='block'),
 blk2 AS (
  SELECT assignment_id, reason,
         CASE WHEN end_at IS NOT NULL THEN 'closed' WHEN cur_status='blocked' THEN 'open' ELSE 'unmeasured' END AS state,
         CASE WHEN end_at IS NOT NULL THEN extract(epoch FROM (end_at-start_at))/60.0
              WHEN cur_status='blocked' THEN greatest(0,extract(epoch FROM (now()-start_at))/60.0) END AS minutes
  FROM blk),
 -- One row per assignment with every per-assignment fact the groupings need.
 f AS (
  SELECT w.id, w.assigned_to, nullif(upper(btrim(w.site)),'') AS site_key, w.status,
         (w.due_at<now() AND w.status NOT IN ('verified','cancelled')) AS overdue_open,
         (w.status='verified' AND w.operational_record_id IS NOT NULL) AS verified_with_record,
         (w.status='verified' AND w.operational_record_table IS NOT NULL AND w.operational_record_id IS NULL) AS verified_missing_record,
         (w.override_reason IS NOT NULL) AS overridden,
         w.estimated_minutes::float8 AS est,
         CASE WHEN w.status='verified' THEN d.active_minutes::float8 END AS act,
         (SELECT count(*) FROM e WHERE e.assignment_id=w.id AND e.action='return') AS returns,
         (SELECT count(*) FROM e WHERE e.assignment_id=w.id AND e.action='reassign') AS reassigns,
         (SELECT sum(minutes) FROM blk2 WHERE blk2.assignment_id=w.id AND state='closed') AS blocked_closed_minutes
  FROM w LEFT JOIN public.workforce_assignment_durations d ON d.assignment_id=w.id),
 g AS (
  SELECT grp, key_profile, key_site,
   count(*) AS assigned,
   count(*) FILTER (WHERE status IN ('assigned','acknowledged')) AS awaiting_start,
   count(*) FILTER (WHERE status='in_progress') AS active,
   count(*) FILTER (WHERE status='blocked') AS blocked,
   count(*) FILTER (WHERE status='submitted') AS submitted,
   count(*) FILTER (WHERE status='verified') AS verified,
   count(*) FILTER (WHERE status='cancelled') AS cancelled,
   count(*) FILTER (WHERE overdue_open) AS overdue_open,
   sum(returns) AS rework_returns,
   count(*) FILTER (WHERE verified_with_record) AS verified_with_record,
   count(*) FILTER (WHERE verified_missing_record) AS verified_missing_record,
   count(*) FILTER (WHERE overridden) AS override_count,
   sum(reassigns) AS reassignments,
   count(act) AS timed_n,
   count(*) FILTER (WHERE status='verified' AND act IS NULL) AS verified_untimed,
   round(avg(act)::numeric,1) AS avg_active_minutes,
   round((percentile_cont(0.5) WITHIN GROUP (ORDER BY act))::numeric,1) AS median_active_minutes,
   count(*) FILTER (WHERE act IS NOT NULL AND est IS NOT NULL) AS est_n,
   sum(est) FILTER (WHERE act IS NOT NULL AND est IS NOT NULL) AS est_sum,
   sum(act) FILTER (WHERE act IS NOT NULL AND est IS NOT NULL) AS act_sum,
   sum(blocked_closed_minutes) AS blocked_closed_minutes
  FROM (
    SELECT 'employee' AS grp, f.assigned_to AS key_profile, NULL::text AS key_site, f.* FROM f
    UNION ALL SELECT 'site', NULL::uuid, f.site_key, f.* FROM f
    UNION ALL SELECT 'all', NULL::uuid, NULL::text, f.* FROM f) x
  GROUP BY grp, key_profile, key_site),
 gj AS (
  SELECT grp, key_profile, key_site, assigned, jsonb_build_object(
   'assigned',assigned,'awaiting_start',awaiting_start,'active',active,'blocked',blocked,'submitted',submitted,
   'verified',verified,'cancelled',cancelled,'overdue_open',overdue_open,'rework_returns',rework_returns,
   'rework_rate',CASE WHEN verified+rework_returns>0 THEN round(rework_returns::numeric/(verified+rework_returns),4) END,
   'verified_with_record',verified_with_record,'verified_missing_record',verified_missing_record,
   'override_count',override_count,'reassignments',reassignments,
   'timed_verified',timed_n,'verified_untimed',verified_untimed,
   'avg_active_minutes',avg_active_minutes,'median_active_minutes',median_active_minutes,
   'estimate_vs_actual',jsonb_build_object('n',est_n,
      'estimated_minutes',CASE WHEN est_n>0 THEN round(est_sum::numeric,1) END,
      'actual_minutes',CASE WHEN est_n>0 THEN round(act_sum::numeric,1) END,
      'actual_to_estimate',CASE WHEN est_n>0 AND est_sum>0 THEN round((act_sum/est_sum)::numeric,3) END),
   'blocked_minutes_closed',CASE WHEN blocked_closed_minutes IS NOT NULL THEN round(blocked_closed_minutes::numeric,1) END) AS j
  FROM g),
 q AS (
  SELECT a.id, coalesce((SELECT max(x.effective_at) FROM public.workforce_assignment_events x WHERE x.assignment_id=a.id AND x.action='complete'),a.updated_at) AS submitted_at,
         NOT EXISTS(SELECT 1 FROM public.workforce_assignment_events x WHERE x.assignment_id=a.id AND x.action='complete') AS fallback
  FROM public.workforce_assignments a
  WHERE a.status='submitted' AND (nullif(btrim(p_site),'') IS NULL OR upper(btrim(a.site))=upper(btrim(p_site))))
 SELECT jsonb_build_object(
  'window',jsonb_build_object('from',p_from,'to',p_to,'site',nullif(upper(btrim(p_site)),''),'basis','assignment created_at'),
  'totals',coalesce((SELECT j FROM gj WHERE grp='all'),jsonb_build_object('assigned',0)),
  'per_employee',coalesce((SELECT jsonb_agg(j||jsonb_build_object('profile_id',key_profile) ORDER BY assigned DESC,key_profile) FROM gj WHERE grp='employee'),'[]'::jsonb),
  'per_site',coalesce((SELECT jsonb_agg(j||jsonb_build_object('site',key_site) ORDER BY assigned DESC,key_site NULLS LAST) FROM gj WHERE grp='site'),'[]'::jsonb),
  'blocker_minutes_by_reason',coalesce((SELECT jsonb_agg(jsonb_build_object('reason',reason,
      'episodes',n,'closed_episodes',nc,'closed_minutes',CASE WHEN nc>0 THEN round(cm::numeric,1) END,
      'open_episodes',no,'open_minutes',CASE WHEN no>0 THEN round(om::numeric,1) END,
      'unmeasured_episodes',nu) ORDER BY coalesce(cm,0)+coalesce(om,0) DESC, reason)
    FROM (SELECT reason,count(*) n,count(*) FILTER (WHERE state='closed') nc,sum(minutes) FILTER (WHERE state='closed') cm,
                 count(*) FILTER (WHERE state='open') no,sum(minutes) FILTER (WHERE state='open') om,
                 count(*) FILTER (WHERE state='unmeasured') nu
          FROM blk2 GROUP BY reason) r),'[]'::jsonb),
  'rework_rate',(SELECT j->'rework_rate' FROM gj WHERE grp='all'),
  'verification_queue',jsonb_build_object('scope','current_all_dates','count',(SELECT count(*) FROM q),
      'oldest_age_hours',(SELECT round((extract(epoch FROM (now()-min(submitted_at)))/3600.0)::numeric,1) FROM q),
      'aged_from_last_update',(SELECT count(*) FROM q WHERE fallback)),
  'reassignments',(SELECT count(*) FROM e WHERE action='reassign'),
  'override_count',(SELECT count(*) FROM w WHERE override_reason IS NOT NULL),
  'coverage',jsonb_build_object(
      'assignments',(SELECT count(*) FROM w),
      'verified',(SELECT count(*) FROM f WHERE status='verified'),
      'verified_timed',(SELECT count(act) FROM f),
      'verified_untimed',(SELECT count(*) FROM f WHERE status='verified' AND act IS NULL),
      'estimate_pairs',(SELECT count(*) FROM f WHERE act IS NOT NULL AND est IS NOT NULL),
      'events',(SELECT count(*) FROM e)),
  'data_freshness',jsonb_build_object('latest_change',(SELECT max(updated_at) FROM w),
      'latest_event',(SELECT max(occurred_at) FROM e),'generated_at',now()))
$$;
REVOKE ALL ON FUNCTION public.workforce_team_analytics(date,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workforce_team_analytics(date,date,text) TO authenticated;

-- One employee's work in chronological order with every event, for the employee detail page.
-- Includes work currently assigned to the profile AND work reassigned away from them (still visible
-- to a manager), flagged by current_assignee. Capped at 1000 assignments; `total` and `truncated`
-- say so instead of hiding it. An employee asking for someone else sees nothing (RLS).
CREATE OR REPLACE FUNCTION public.workforce_employee_timeline(p_profile uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public SET plan_cache_mode=force_custom_plan AS $$
 WITH w AS (
  SELECT a.* FROM public.workforce_assignments a
  WHERE (a.assigned_to=p_profile OR EXISTS(SELECT 1 FROM public.workforce_assignment_events x
           WHERE x.assignment_id=a.id AND x.action='reassign' AND x.from_assignee=p_profile))
    AND (p_from IS NULL OR a.created_at>=p_from) AND (p_to IS NULL OR a.created_at<p_to+1)),
 lim AS (SELECT * FROM w ORDER BY created_at, id LIMIT 1000)
 SELECT jsonb_build_object(
  'profile_id',p_profile,'from',p_from,'to',p_to,
  'total',(SELECT count(*) FROM w),'truncated',(SELECT count(*) FROM w)>1000,
  'assignments',coalesce((SELECT jsonb_agg(jsonb_build_object(
     'id',l.id,'title',l.title,'site',l.site,'task_type',l.task_type,'priority',l.priority,'status',l.status,
     'created_at',l.created_at,'due_at',l.due_at,'estimated_minutes',l.estimated_minutes,
     'current_assignee',l.assigned_to=p_profile,'assigned_to',l.assigned_to,
     'operational_record_id',l.operational_record_id,
     'active_minutes',(SELECT d.active_minutes FROM public.workforce_assignment_durations d WHERE d.assignment_id=l.id),
     'events',coalesce((SELECT jsonb_agg(jsonb_build_object('action',ev.action,'from_status',ev.from_status,'to_status',ev.to_status,
          'reason_code',ev.reason_code,'note',ev.note,'actor_id',ev.actor_id,'effective_at',ev.effective_at,
          'from_assignee',ev.from_assignee,'to_assignee',ev.to_assignee) ORDER BY ev.effective_at,ev.occurred_at,ev.id)
        FROM public.workforce_assignment_events ev WHERE ev.assignment_id=l.id),'[]'::jsonb))
    ORDER BY l.created_at,l.id) FROM lim l),'[]'::jsonb),
  'generated_at',now())
$$;
REVOKE ALL ON FUNCTION public.workforce_employee_timeline(uuid,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workforce_employee_timeline(uuid,date,date) TO authenticated;
