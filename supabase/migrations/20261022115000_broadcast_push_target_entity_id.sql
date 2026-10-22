-- Adds the specific broadcast ID to FCM push payloads, enabling exact-record routing.
CREATE OR REPLACE FUNCTION public.broadcast_send(p_title text, p_body text, p_title_ar text DEFAULT NULL::text, p_body_ar text DEFAULT NULL::text, p_roles text[] DEFAULT '{}'::text[], p_countries text[] DEFAULT '{}'::text[], p_sites text[] DEFAULT '{}'::text[], p_send_push boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org        uuid := public.app_current_org();
  v_id         uuid;
  v_total      int := 0;
  v_push       int := 0;
  v_event_id   bigint;
  v_recipients jsonb;
  v_title      text := btrim(coalesce(p_title, ''));
  v_body       text := btrim(coalesce(p_body, ''));
  v_title_ar   text := nullif(btrim(coalesce(p_title_ar, '')), '');
  v_body_ar    text := nullif(btrim(coalesce(p_body_ar, '')), '');
  -- What someone whose language we do not know yet should read. Both, when
  -- both were written - never a guess, never a silent drop.
  v_title_both text;
  v_body_both  text;
  v_lang       text;
begin
  if not public.app_is_elevated() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if v_org is null then
    return jsonb_build_object('ok', false, 'reason', 'no_org');
  end if;
  if v_title = '' or v_body = '' then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;

  v_title_both := v_title;
  v_body_both  := case when v_body_ar is null then v_body
                       else v_body || E'\n\n' || coalesce(v_title_ar || E'\n', '') || v_body_ar end;

  insert into public.broadcast_messages
    (organisation_id, title, body, title_ar, body_ar,
     target_roles, target_countries, target_sites, send_push, status)
  values
    (v_org, v_title, v_body, v_title_ar, v_body_ar,
     coalesce(p_roles, '{}'), coalesce(p_countries, '{}'), coalesce(p_sites, '{}'),
     coalesce(p_send_push, true), 'draft')
  returning id into v_id;

  -- Resolve the audience ONCE and reuse it for both channels, so the bell and
  -- the push can never disagree about who was told.
  drop table if exists _bc_aud;
  create temp table _bc_aud on commit drop as
  select p.id,
         -- 'ar' only when we know it AND an Arabic version exists; 'en' when we
         -- know they read English; 'both' when we simply do not know yet.
         case
           when v_title_ar is null then 'en'
           when lower(coalesce(p.language, '')) like 'ar%' then 'ar'
           when lower(coalesce(p.language, '')) like 'en%' then 'en'
           else 'both'
         end as lang,
         coalesce(
           (select d.push_token from public.user_devices d
             where d.user_id = p.id and not coalesce(d.revoked, false)
             order by d.last_seen_at desc nulls last limit 1),
           nullif(btrim(p.push_token), '')
         ) as token
    from public.profiles p
   where (p.organisation_id = v_org or p.org_id = v_org)
     and coalesce(p.approved, true) and not coalesce(p.locked, false)
     and (coalesce(array_length(p_roles, 1), 0) = 0 or p.role = any (p_roles))
     and (coalesce(array_length(p_countries, 1), 0) = 0
          or p.country is null or cardinality(p.country) = 0
          or p.country && p_countries)
     and (coalesce(array_length(p_sites, 1), 0) = 0
          or p.sites is null or cardinality(p.sites) = 0
          or p.sites && (p_sites || array['ALL']));

  select count(*) into v_total from _bc_aud;

  insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
  select a.id, 'broadcast',
         case a.lang when 'ar' then v_title_ar else v_title_both end,
         case a.lang when 'ar' then v_body_ar
                     when 'en' then v_body
                     else v_body_both end,
         'broadcast', v_id
    from _bc_aud a;

  if coalesce(p_send_push, true) then
    -- One queue row per language group, not per person: the edge function takes
    -- a recipient list plus one rendered message.
    for v_lang in select distinct lang from _bc_aud where token is not null
    loop
      select jsonb_agg(jsonb_build_object('user_id', a.id, 'push_token', t.tok))
        into v_recipients
        from _bc_aud a cross join lateral public._user_push_tokens(a.id) t(tok) where a.token is not null and a.lang = v_lang;
      continue when v_recipients is null;

      insert into public.domain_events
        (event_type, entity_type, entity_id, organisation_id, payload, status, processed_at)
      values ('broadcast.sent', 'broadcast', v_id::text, v_org,
              jsonb_build_object('broadcast_id', v_id, 'lang', v_lang), 'processed', now())
      returning id into v_event_id;

      insert into public.workflow_notifications
        (event_id, organisation_id, instance_id, event_type, payload, recipient_count, status)
      values (v_event_id, v_org, null, 'broadcast.sent',
              jsonb_build_object(
                'event_type', 'broadcast.sent',
                'entity_type', 'broadcast',
                'entity_label', v_title,
                'entity_id', v_id,
                'push', jsonb_build_object(
                  'title', case v_lang when 'ar' then v_title_ar else v_title end,
                  'body',  case v_lang when 'ar' then v_body_ar
                                       when 'en' then v_body
                                       else v_body_both end),
                'recipients', v_recipients),
              jsonb_array_length(v_recipients), 'pending')
      on conflict (event_id) do nothing;

      v_push := v_push + jsonb_array_length(v_recipients);
    end loop;
  end if;

  update public.broadcast_messages
     set status = 'sent', recipient_count = v_total, push_count = v_push, sent_at = now()
   where id = v_id;

  return jsonb_build_object('ok', true, 'id', v_id,
                            'recipients', v_total, 'pushes_queued', v_push);
end $function$
;
