-- ============================================================================
-- Workshop intake: ERP-first job cards wait for the supervisor too
-- ============================================================================
-- STATUS: AUTHORED, NOT APPLIED. Depends on 20261128090000_workshop_intake.sql.
--         Kept separate because it patches the LIVE hot path
--         process_stg_job_cards (every ERP job card import runs it).
--
-- WHAT (owner answer 6 + reviewer decision 4):
--   * When the ERP file brings an OPEN job card opened in the last 30 days for
--     a vehicle that is not in the workshop list, a pending_confirm record
--     (intake_source 'erp') is created and routed to the on-shift supervisor.
--   * When the vehicle is already listed (sheet / phone / Excel) and the
--     record has no job card yet, it is linked only if exactly that one record
--     exists and it was entered within +/-3 days of the ERP production-out
--     time; otherwise a link suggestion is stored for the supervisor.
--   * Work order numbers are never renamed.
--   * After a person confirmed the vehicle, an ERP re-import never overwrites
--     the work order status unless the ERP status is final (Completed,
--     Closed, Cancelled).
--   * The hook can never fail an ERP import: any error is swallowed and
--     written to the events log instead.
--   * Kill switch: system_config key workshop_intake_erp = 'false'.
--
-- HOW: the live function text is read with pg_get_functiondef and patched by
-- two anchored replacements; the migration aborts unless each anchor matches
-- exactly once (nothing is retyped by hand).
--
-- ROLLBACK: reverse the two replacements on the live definition
--   (search 'workshop_intake_keeps_web_status' and 'workshop_intake_from_erp'),
--   then drop functions workshop_intake_from_erp / workshop_intake_keeps_web_status.
-- ============================================================================

create or replace function public.workshop_intake_keeps_web_status(p_work_order_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workshop_status_records r
                  where r.work_order_id = p_work_order_id and r.current_active
                    and r.deleted_at is null and r.confirm_status = 'confirmed'
                    and r.intake_source <> 'excel_upload')
$$;

create or replace function public.workshop_intake_from_erp(p_org uuid, p_country text, p_job_card text)
returns void language plpgsql security definer set search_path = public as $$
declare
  w record;
  r public.workshop_status_records%rowtype;
  v_asset text; v_at timestamptz; v_route uuid[]; v_id uuid; v_listed boolean;
begin
  if coalesce(public.workshop_status_notify_config('workshop_intake_erp', 'true'), 'true') = 'false' then return; end if;
  select id, asset_no, site, status, opened_at, production_out_at, plate_no, description, work_type
    into w from public.work_orders
   where organisation_id = p_org and work_order_no = p_job_card;
  if not found or w.status in ('Completed', 'Closed', 'Cancelled') then return; end if;
  if coalesce(w.opened_at, now()) < now() - interval '30 days' then return; end if;
  v_asset := public.workshop_status_asset_key(w.asset_no);
  if v_asset is null or v_asset = '' then return; end if;
  v_at := coalesce(w.production_out_at, w.opened_at, now());

  if exists (select 1 from public.workshop_status_records
              where work_order_id = w.id and deleted_at is null) then
    return;  -- already linked
  end if;

  select * into r from public.workshop_status_records
   where organisation_id = p_org and country = p_country and current_active and deleted_at is null
     and public.workshop_status_asset_key(asset_no) = v_asset
   limit 1;
  v_listed := found;  -- read FOUND before PERFORM resets it
  perform set_config('workshop.source', 'system', true);
  if v_listed then
    if nullif(btrim(coalesce(r.job_card_ref, '')), '') is not null and btrim(r.job_card_ref) <> p_job_card then
      update public.workshop_status_records set link_suggestion = jsonb_build_object(
          'work_order_id', w.id, 'job_card', p_job_card, 'reason', 'different_job_card', 'at', now())
       where id = r.id;
    elsif abs(extract(epoch from (r.first_seen_at - v_at))) <= 3 * 86400 then
      update public.workshop_status_records
         set job_card_ref = p_job_card, work_order_id = w.id, link_suggestion = null
       where id = r.id;
      insert into public.workshop_status_events
        (organisation_id, country, site, record_id, asset_no, event_type, source, details)
      values (p_org, p_country, r.site, r.id, r.asset_no, 'intake_linked', 'system',
              jsonb_build_object('work_order_id', w.id, 'job_card', p_job_card, 'rule', 'same_vehicle_3_days'));
    else
      update public.workshop_status_records set link_suggestion = jsonb_build_object(
          'work_order_id', w.id, 'job_card', p_job_card, 'reason', 'outside_3_days', 'at', now())
       where id = r.id;
    end if;
    perform set_config('workshop.source', '', true);
    return;
  end if;

  v_route := public.workshop_intake_route(p_org, p_country, upper(btrim(w.site)), now(), auth.uid());
  insert into public.workshop_status_records
    (organisation_id, country, asset_no, vehicle_id, reg_no, site, job_card_ref, complaint,
     ooc_since, current_active, daily_report_status, intake_source, confirm_status,
     submitted_by, submitted_by_name, source_key, routed_to, routed_at, work_type, production_out_at,
     work_order_id)
  select p_org, p_country, v_asset, f.id, coalesce(w.plate_no, f.registration_no), upper(btrim(w.site)),
         p_job_card, w.description, (v_at at time zone public.workshop_intake_tz(p_country))::date,
         true, 'active', 'erp', 'pending_confirm', auth.uid(), public.workshop_status_actor_name(),
         p_job_card, v_route, now(), w.work_type, w.production_out_at, w.id
    from (select 1) one
    left join lateral (select id, registration_no from public.vehicle_fleet
                        where organisation_id = p_org and lower(country) = lower(p_country)
                          and upper(regexp_replace(asset_no, '\s', '', 'g')) = v_asset limit 1) f on true
  returning id into v_id;
  insert into public.workshop_status_events
    (organisation_id, country, site, record_id, asset_no, event_type, source, details)
  values (p_org, p_country, upper(btrim(w.site)), v_id, v_asset, 'intake_submitted', 'system',
          jsonb_build_object('intake_source', 'erp', 'job_card', p_job_card, 'routed_to', to_jsonb(v_route)));
  perform public.workshop_intake_notify(p_org, v_route);
  perform set_config('workshop.source', '', true);
end $$;

revoke all on function public.workshop_intake_from_erp(uuid,text,text) from public, anon, authenticated;
revoke all on function public.workshop_intake_keeps_web_status(uuid) from public, anon, authenticated;

-- Anchored patch of the live pipe.
do $$
declare
  v_def text;
  v_a1 text := 'status = excluded.status, work_type = excluded.work_type,';
  v_n1 text := 'status = case when excluded.status not in (''Completed'', ''Closed'', ''Cancelled'')'
            || ' and public.workshop_intake_keeps_web_status(work_orders.id)'
            || ' then work_orders.status else excluded.status end, work_type = excluded.work_type,';
  v_a2 text := E'      using errcode = ''PT409'';\n  end if;\n\n  return null;\nend';
  v_n2 text := E'      using errcode = ''PT409'';\n  end if;\n\n'
            || E'  -- Workshop intake (20261128091000): an ERP-first job card waits for the supervisor.\n'
            || E'  begin\n    perform public.workshop_intake_from_erp(v_org, v_country, v_jc);\n'
            || E'  exception when others then\n'
            || E'    insert into public.workshop_status_events (organisation_id, country, event_type, source, details)\n'
            || E'    values (v_org, v_country, ''upload_failed'', ''system'',\n'
            || E'            jsonb_build_object(''intake_erp_error'', sqlerrm, ''job_card'', v_jc));\n'
            || E'  end;\n\n  return null;\nend';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'process_stg_job_cards' and pg_get_function_identity_arguments(p.oid) = '';
  if v_def is null then raise exception 'process_stg_job_cards not found'; end if;
  if strpos(v_def, 'workshop_intake_from_erp') > 0 then return; end if;  -- already patched
  if (length(v_def) - length(replace(v_def, v_a1, ''))) / length(v_a1) <> 1 then
    raise exception 'status anchor in process_stg_job_cards did not match exactly once; not patched';
  end if;
  if (length(v_def) - length(replace(v_def, v_a2, ''))) / length(v_a2) <> 1 then
    raise exception 'tail anchor in process_stg_job_cards did not match exactly once; not patched';
  end if;
  execute replace(replace(v_def, v_a1, v_n1), v_a2, v_n2);
end $$;
