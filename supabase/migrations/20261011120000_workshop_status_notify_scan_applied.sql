-- Workshop Status notification scan + hourly cron, AS APPLIED LIVE 2026-10-11
-- (Supabase migration name: workshop_status_notify_scan_and_cron).
--
-- Supersedes section 4 + 6 of 20261007140000_workshop_status_notifications.sql.
-- Two deliberate differences from that file:
--   1. An undelivered notice no longer DELETEs its dedupe row. The row's period is
--      re-keyed (period || ':undelivered:' || timestamp), which frees the unique slot
--      so the next hourly run retries, and keeps the attempt on record.
--   2. The 90-day purge of workshop_status_notices is NOT here. Any DELETE makes the
--      Supabase MCP wait for approval and roll back. Add it later as its own
--      housekeeping job (SQL editor or approved MCP call).
-- Verified live: function present, cron '20 * * * *' active, anon + authenticated
-- cannot execute; a rolled-back probe run returned {"sent": 60}.

create or replace function public.workshop_status_notify_scan(p_now timestamptz default now())
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_tz text := public.workshop_status_notify_config('workshop_status_timezone', 'Asia/Riyadh');
  v_wait int; v_eta int; v_deadline int;
  v_local timestamp; v_today date; v_hour int;
  v_org uuid;
  v_cands jsonb;
  v_new jsonb;
  g record;
  v_title text; v_body text; v_link text; v_entity_type text; v_entity uuid;
  v_sent int := 0;
begin
  if public.workshop_status_notify_config('workshop_status_notifications', 'true') = 'false' then
    return jsonb_build_object('sent', 0, 'disabled', true);
  end if;
  begin v_wait := public.workshop_status_notify_config('workshop_status_wait_days', '7')::int;
  exception when others then v_wait := 7; end;
  begin v_eta := public.workshop_status_notify_config('workshop_status_eta_days', '3')::int;
  exception when others then v_eta := 3; end;
  begin v_deadline := public.workshop_status_notify_config('workshop_status_update_deadline_hour', '10')::int;
  exception when others then v_deadline := 10; end;
  begin v_local := p_now at time zone v_tz;
  exception when others then v_tz := 'Asia/Riyadh'; v_local := p_now at time zone v_tz; end;
  v_today := v_local::date;
  v_hour := extract(hour from v_local)::int;

  for v_org in
    select distinct organisation_id from public.workshop_status_records
     where current_active and deleted_at is null
    union
    select distinct organisation_id from public.workshop_status_uploads
     where status = 'previewed' and uploaded_at < p_now - interval '30 minutes'
  loop
    v_cands := public.workshop_status_notice_candidates(v_org);
    if jsonb_array_length(v_cands) = 0 then continue; end if;

    with cand as (
      select (e ->> 'user_id')::uuid as uid, e as scope from jsonb_array_elements(v_cands) e
    ),
    recs as (
      select r.*,
             coalesce(
               case when r.ooc_since is not null and r.ooc_since <= v_today then v_today - r.ooc_since end,
               case when r.excel_down_days >= 0 then r.excel_down_days end,
               v_today - (r.first_seen_at at time zone v_tz)::date) as days_down,
             public.workshop_status_wait_category(r.current_stage, r.delay_reason) as wait_cat
        from public.workshop_status_records r
       where r.organisation_id = v_org and r.current_active and r.deleted_at is null
    ),
    conds as (
      -- (record, kind, period, audience)
      select id, asset_no, country, site, responsible_user_id, 'workshop_status_update_missing' as kind,
             v_today::text as period, 'responsible' as audience
        from recs
       where v_hour >= v_deadline
         and (last_manual_update_at is null or (last_manual_update_at at time zone v_tz)::date < v_today)
      union all
      select id, asset_no, country, site, responsible_user_id, 'workshop_status_waiting_long', 'once', 'responsible'
        from recs where wait_cat is not null and days_down >= v_wait
      union all
      select id, asset_no, country, site, responsible_user_id, 'workshop_status_long_down', 'once', 'responsible'
        from recs where wait_cat is null and days_down >= v_wait
      union all
      select id, asset_no, country, site, responsible_user_id, 'workshop_status_release_today', v_today::text, 'responsible'
        from recs where expected_release_date = v_today
      union all
      select id, asset_no, country, site, responsible_user_id, 'workshop_status_release_overdue',
             expected_release_date::text, 'responsible'
        from recs where expected_release_date < v_today
      union all
      select id, asset_no, country, site, responsible_user_id, 'workshop_status_no_responsible', 'once', 'assigners'
        from recs where responsible_user_id is null
      union all
      select id, asset_no, country, site, responsible_user_id, 'workshop_status_missing_eta', 'once', 'responsible'
        from recs where expected_release_date is null and nullif(btrim(coalesce(excel_expected_release, '')), '') is null
                    and days_down >= v_eta
      union all
      select id, asset_no, country, site, responsible_user_id, 'workshop_status_ready_release', 'once', 'assigners'
        from recs where current_stage = 'Ready for Release'
    ),
    -- Is the responsible person a valid recipient for this record?
    owner_ok as (
      select cd.*, exists (select 1 from cand x where x.uid = cd.responsible_user_id
                            and public.workshop_status_scope_allows(x.scope, cd.country, cd.site)) as owner_sees
        from conds cd
    ),
    targets as (
      select o.id as subject_id, o.asset_no, o.kind, o.period, o.responsible_user_id as uid
        from owner_ok o where o.audience = 'responsible' and o.owner_sees
      union
      select o.id, o.asset_no, o.kind, o.period, x.uid
        from owner_ok o join cand x
          on coalesce((x.scope ->> 'assign')::boolean, false)
         and public.workshop_status_scope_allows(x.scope, o.country, o.site)
       where o.audience = 'assigners' or not o.owner_sees
      union
      -- Uploads previewed but not confirmed: people who may confirm that country.
      select u.id, null, 'workshop_status_upload_review', 'once', x.uid
        from public.workshop_status_uploads u join cand x
          on coalesce((x.scope ->> 'confirm')::boolean, false)
         and public.workshop_status_scope_allows(x.scope, u.country, null)
       where u.organisation_id = v_org and u.status = 'previewed'
         and u.uploaded_at < p_now - interval '30 minutes'
    ),
    ins as (
      insert into public.workshop_status_notices (organisation_id, user_id, kind, subject_id, period)
      select v_org, t.uid, t.kind, t.subject_id, t.period from targets t
      on conflict do nothing
      returning user_id, kind, subject_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'user_id', g2.user_id, 'kind', g2.kind, 'ids', g2.ids, 'assets', g2.assets)), '[]'::jsonb)
      into v_new
      from (
        select ins.user_id, ins.kind,
               to_jsonb(array_agg(ins.subject_id order by t.asset_no nulls last, ins.subject_id)) as ids,
               to_jsonb(array_remove(array_agg(distinct t.asset_no), null)) as assets
          from ins
          join (select distinct subject_id, kind, asset_no from targets) t
            on t.subject_id = ins.subject_id and t.kind = ins.kind
         group by ins.user_id, ins.kind
      ) g2;

    for g in
      select (e ->> 'user_id')::uuid as uid, e ->> 'kind' as kind,
             array(select jsonb_array_elements_text(e -> 'ids'))::uuid[] as ids,
             array(select jsonb_array_elements_text(e -> 'assets') order by 1) as assets
        from jsonb_array_elements(v_new) e
    loop
      v_title := case g.kind
        when 'workshop_status_upload_review' then 'Workshop upload waiting for confirmation'
        when 'workshop_status_update_missing' then cardinality(g.ids) || ' workshop '
             || case when cardinality(g.ids) = 1 then 'vehicle has' else 'vehicles have' end || ' no update today'
        when 'workshop_status_waiting_long' then cardinality(g.ids) || ' '
             || case when cardinality(g.ids) = 1 then 'vehicle' else 'vehicles' end
             || ' waiting for parts, manpower or approval for ' || v_wait || '+ days'
        when 'workshop_status_long_down' then cardinality(g.ids) || ' '
             || case when cardinality(g.ids) = 1 then 'vehicle' else 'vehicles' end
             || ' down for ' || v_wait || '+ days'
        when 'workshop_status_release_today' then cardinality(g.ids) || ' '
             || case when cardinality(g.ids) = 1 then 'vehicle' else 'vehicles' end || ' expected to be released today'
        when 'workshop_status_release_overdue' then cardinality(g.ids) || ' '
             || case when cardinality(g.ids) = 1 then 'vehicle is' else 'vehicles are' end || ' past the expected release date'
        when 'workshop_status_no_responsible' then cardinality(g.ids) || ' '
             || case when cardinality(g.ids) = 1 then 'vehicle has' else 'vehicles have' end || ' no responsible person'
        when 'workshop_status_missing_eta' then cardinality(g.ids) || ' '
             || case when cardinality(g.ids) = 1 then 'vehicle has' else 'vehicles have' end || ' no expected release date'
        when 'workshop_status_ready_release' then cardinality(g.ids) || ' '
             || case when cardinality(g.ids) = 1 then 'vehicle is' else 'vehicles are' end || ' ready for release'
        else 'Workshop Status' end;
      v_body := case g.kind
        when 'workshop_status_upload_review' then
          'A daily workshop upload was previewed but not confirmed. Review it and confirm or cancel.'
        when 'workshop_status_update_missing' then
          'Update today: ' || public.workshop_status_asset_list(g.assets) || '.'
        else public.workshop_status_asset_list(g.assets) || '.' end;

      if g.kind = 'workshop_status_upload_review' then
        v_entity_type := 'workshop_status_upload'; v_entity := g.ids[1];
        v_link := '/daily-ops/workshop?tab=upload';
      elsif cardinality(g.ids) = 1 then
        v_entity_type := 'workshop_status_record'; v_entity := g.ids[1];
        v_link := '/daily-ops/workshop?record=' || g.ids[1]::text;
      else
        v_entity_type := 'workshop_status'; v_entity := null;
        v_link := '/daily-ops/workshop?focus=' || case g.kind
          when 'workshop_status_update_missing' then 'not_today'
          when 'workshop_status_waiting_long' then 'over7'
          when 'workshop_status_long_down' then 'over7'
          when 'workshop_status_release_today' then 'expected_today'
          when 'workshop_status_no_responsible' then 'unassigned'
          when 'workshop_status_ready_release' then 'ready'
          else 'mine' end;
      end if;

      if public.workshop_status_notice_send(v_org, g.uid, g.kind, v_title, v_body, v_entity_type, v_entity, v_link) then
        v_sent := v_sent + 1;
      else
        -- Not delivered: forget it so the next run tries again.
        -- Not delivered: release the claim (re-key the period) so the next run tries again.
        update public.workshop_status_notices
           set period = period || ':undelivered:' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS')
         where organisation_id = v_org and user_id = g.uid and kind = g.kind and subject_id = any (g.ids)
           and created_at = now(); -- rows written by this transaction only
      end if;
    end loop;
  end loop;

  -- Ledger purge (90 days) is a separate housekeeping job, added with owner approval.

  return jsonb_build_object('sent', v_sent);
end $$;

revoke all on function public.workshop_status_notify_scan(timestamptz) from public, anon, authenticated;
do $$
begin
  if to_regclass('cron.job') is not null then
    perform cron.schedule('workshop-status-notify', '20 * * * *',
      $c$select public.workshop_status_notify_scan()$c$);
  end if;
end $$;
