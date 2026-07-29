-- =============================================================================
-- ACCIDENT CASE MODEL - EVIDENCE + DOCUMENTS WORKFLOW RPCs (Phase 6/7)
-- =============================================================================
-- STATUS: AUTHORED, NOT YET APPLIED. This file is a REVIEW ARTIFACT only. It has
-- NOT been run against any database and carries no `supabase_migrations` row.
--
-- RUN ORDER: this script RUNS AFTER V417 (02_DATA_MODEL.sql - the case model
-- tables accident_evidence / accident_claim_documents /
-- accident_evidence_requirements, their columns, RLS and the C2 per-table
-- owning-capability write policies) AND AFTER 10_WORKSTREAM_RPCS.sql, whose
-- internal helper public._accident_rpc_context(uuid) this file REUSES to resolve
-- and authorise the case org/country/site context. It does NOT re-declare that
-- helper (single source, like file 10 depends on the V417 tables).
-- RE-CONFIRM THE NEXT-FREE MIGRATION NUMBER AT APPLY TIME: V417/V418 are the
-- accident model / engine-mirror artifacts and file 10 the workstream RPCs; this
-- file takes the next free number after whatever has actually landed (the standing
-- V419-V422 batch or the accident batch may reorder). Nothing here depends on its
-- own number.
--
-- WHY IT EXISTS
--   The Incident Evidence workstream (brief 7) and the Insurance claim-document
--   checklist (brief 10) each need an ATOMIC, SERVER-VALIDATED action a raw
--   PostgREST table write cannot express:
--     * an evidence kind typo ('phota') must be refused, not silently stored,
--     * a document add must decide received vs still-outstanding consistently,
--     * the required-evidence checklist must report received vs MISSING HONESTLY -
--       a requirement with no matching evidence row is missing, never "received",
--     * verify / mark-received are review transitions that stamp WHO / WHEN.
--   These RPCs are that server boundary. They record only STORAGE REFERENCES (the
--   path in object storage), never the binary. The checklist MATHS (which
--   requirements apply to a route) are grounded in accident_evidence_requirements
--   config, not re-invented here.
--
-- SECURITY (house pattern - V416 / V398 / V229, identical to file 10)
--   Every RPC is SECURITY DEFINER with search_path pinned to 'public'. Because a
--   DEFINER function bypasses RLS, each one RE-CHECKS, in its own body, via
--   public._accident_rpc_context(p_accident_id):
--     1. org: the accident's organisation_id = app_current_org() OR super,
--     2. country + site: app_can_see_country() AND app_can_see_site() on the
--        accident's own country/site (the scope the V417 RLS enforces).
--   Then the capability gate matches the V417 PART E cap_map owning capability for
--   the target table:
--     * accident_evidence          -> 'submit'        (Incident Evidence workstream)
--     * accident_claim_documents   -> 'edit_insurance' (Insurance workstream)
--   so a non-elevated Insurance Claims Officer granted 'edit_insurance' can manage
--   claim documents but not evidence, and vice-versa; app_is_elevated()
--   (Admin/Manager/Director) always passes. The read-only checklist requires only
--   that the context passes (RLS SELECT is app_is_active()).
--   anon EXECUTE is revoked on every function; authenticated is granted; the
--   in-body self-gate is the real boundary.
--
-- ROLLBACK (paste and run to reverse this file)
--   drop function if exists
--     public.accident_evidence_add(uuid,text,text,text,text,text),
--     public.accident_document_add(uuid,text,text,text),
--     public.accident_evidence_checklist(uuid),
--     public.accident_evidence_verify(uuid,uuid,text,text),
--     public.accident_document_mark_received(uuid,uuid,text);
-- =============================================================================

begin;

-- =============================================================================
-- 1. accident_evidence_add - record ONE evidence / photo reference (never the
--   binary, only the storage path). Validates the kind is one of the three
--   accident_evidence.kind CHECK tokens so a typo never lands an unreadable row.
--   Optionally links the row to a workstream and/or a requirement_key so the
--   checklist below can count it as received. Gate: elevated OR
--   app_user_can('accidents','submit') (the C2 owning cap for accident_evidence).
-- =============================================================================
create or replace function public.accident_evidence_add(
  p_accident_id    uuid,
  p_kind           text,
  p_storage_ref    text,
  p_caption        text default null,
  p_workstream_key text default null,
  p_requirement_key text default null   -- OPTIONAL, trailing: link to a checklist item
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org     uuid;
  v_country text;
  v_site    text;
  v_kind    text := lower(btrim(coalesce(p_kind, '')));
  v_ref     text := nullif(btrim(coalesce(p_storage_ref, '')), '');
  v_caption text := nullif(btrim(coalesce(p_caption, '')), '');
  v_ws      text := nullif(btrim(coalesce(p_workstream_key, '')), '');
  v_req     text := nullif(btrim(coalesce(p_requirement_key, '')), '');
  v_row     public.accident_evidence%rowtype;
begin
  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(p_accident_id);

  if v_kind <> any (array['photo','video','document']) then
    raise exception 'Invalid evidence kind "%".', p_kind using errcode = '22023';
  end if;

  if v_ref is null then
    raise exception 'A storage reference is required to record evidence.'
      using errcode = '22023';
  end if;

  if not (public.app_is_elevated() or public.app_user_can('accidents', 'submit')) then
    raise exception 'Not permitted to add evidence to this case.' using errcode = '42501';
  end if;

  insert into public.accident_evidence
    (organisation_id, accident_id, country, site, workstream_key, requirement_key,
     kind, storage_ref, caption, uploaded_by, uploaded_at,
     created_by, created_at, updated_at)
  values
    (v_org, p_accident_id, v_country, v_site, v_ws, v_req,
     v_kind, v_ref, v_caption, auth.uid(), now(),
     auth.uid(), now(), now())
  returning * into v_row;

  return jsonb_build_object('ok', true, 'evidence', to_jsonb(v_row));
end
$$;

-- =============================================================================
-- 2. accident_document_add - record ONE claim / authority document reference on
--   the accident_claim_documents required-vs-received checklist. A document added
--   WITH a storage reference is marked received (received_at = now()); a document
--   added without one is a required-but-outstanding placeholder. doc_type is
--   mandatory (NOT NULL column). Gate: elevated OR
--   app_user_can('accidents','edit_insurance') (the C2 owning cap).
--   NOTE: accident_claim_documents has NO reference_no column (see report). The
--   caller's p_reference_no is preserved verbatim in the notes column, prefixed so
--   it is unambiguous, rather than dropped.
-- =============================================================================
create or replace function public.accident_document_add(
  p_accident_id uuid,
  p_doc_type    text,
  p_storage_ref text,
  p_reference_no text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org      uuid;
  v_country  text;
  v_site     text;
  v_doc_type text := nullif(btrim(coalesce(p_doc_type, '')), '');
  v_ref      text := nullif(btrim(coalesce(p_storage_ref, '')), '');
  v_refno    text := nullif(btrim(coalesce(p_reference_no, '')), '');
  v_received boolean;
  v_notes    text;
  v_row      public.accident_claim_documents%rowtype;
begin
  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(p_accident_id);

  if v_doc_type is null then
    raise exception 'A document type is required.' using errcode = '22023';
  end if;

  if not (public.app_is_elevated() or public.app_user_can('accidents', 'edit_insurance')) then
    raise exception 'Not permitted to add claim documents to this case.' using errcode = '42501';
  end if;

  v_received := v_ref is not null;                       -- a stored file means received
  v_notes    := case when v_refno is not null
                     then 'Reference: ' || v_refno
                     else null end;

  insert into public.accident_claim_documents
    (organisation_id, accident_id, country, site, doc_type, storage_ref,
     required, received, received_at, notes, created_by, created_at, updated_at)
  values
    (v_org, p_accident_id, v_country, v_site, v_doc_type, v_ref,
     true, v_received, case when v_received then now() end, v_notes,
     auth.uid(), now(), now())
  returning * into v_row;

  return jsonb_build_object('ok', true, 'document', to_jsonb(v_row));
end
$$;

-- =============================================================================
-- 3. accident_evidence_checklist - the required-evidence checklist for the case's
--   route. Matches accident_evidence_requirements on the case route_key AND
--   accident_type (a requirement with a NULL route_key/accident_type is global; a
--   scoped one applies only when it equals the case's value), scoped to the case
--   country when the requirement carries one. For each matched requirement it
--   reports received vs missing HONESTLY: received is true ONLY when at least one
--   accident_evidence row for this case carries that requirement_key. A missing
--   item is never reported as received. Read-only; requires the context to pass.
-- =============================================================================
create or replace function public.accident_evidence_checklist(
  p_accident_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org     uuid;
  v_country text;
  v_site    text;
  v_route   text;
  v_type    text;
  v_items   jsonb;
  v_total   integer;
  v_received integer;
  v_mand_total integer;
  v_mand_missing integer;
begin
  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(p_accident_id);

  select a.route_key, a.accident_type
    into v_route, v_type
    from public.accidents a
   where a.id = p_accident_id;

  with reqs as (
    -- one row per requirement_key that applies to this case, most-specific /
    -- mandatory row wins if the same key is defined at more than one scope.
    select distinct on (r.requirement_key)
           r.requirement_key,
           r.label,
           r.category,
           r.kind,
           r.mandatory,
           r.sort_order
      from public.accident_evidence_requirements r
     where r.organisation_id = v_org
       and r.active
       and (r.route_key is null     or r.route_key = v_route)
       and (r.accident_type is null or r.accident_type = v_type)
       and (r.country is null       or r.country = v_country)
     order by r.requirement_key,
              r.mandatory desc,
              r.route_key nulls last,
              r.accident_type nulls last,
              r.sort_order
  ),
  recv as (
    select e.requirement_key,
           count(*)                                          as evidence_count,
           bool_or(e.verification_status = 'verified')       as any_verified,
           max(e.uploaded_at)                                as last_uploaded_at
      from public.accident_evidence e
     where e.accident_id = p_accident_id
       and e.requirement_key is not null
     group by e.requirement_key
  ),
  merged as (
    select req.requirement_key,
           req.label,
           req.category,
           req.kind,
           req.mandatory,
           req.sort_order,
           coalesce(recv.evidence_count, 0)          as evidence_count,
           (coalesce(recv.evidence_count, 0) > 0)    as received,
           coalesce(recv.any_verified, false)        as verified,
           recv.last_uploaded_at
      from reqs req
      left join recv on recv.requirement_key = req.requirement_key
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'requirement_key', m.requirement_key,
        'label',           m.label,
        'category',        m.category,
        'kind',            m.kind,
        'mandatory',       m.mandatory,
        'sort_order',      m.sort_order,
        'received',        m.received,
        'verified',        m.verified,
        'evidence_count',  m.evidence_count,
        'last_uploaded_at', m.last_uploaded_at
      ) order by m.sort_order, m.requirement_key
    ), '[]'::jsonb),
    count(*),
    count(*) filter (where m.received),
    count(*) filter (where m.mandatory),
    count(*) filter (where m.mandatory and not m.received)
    into v_items, v_total, v_received, v_mand_total, v_mand_missing
  from merged m;

  return jsonb_build_object(
    'ok',           true,
    'accident_id',  p_accident_id,
    'route_key',    v_route,
    'accident_type', v_type,
    'items',        v_items,
    'summary', jsonb_build_object(
      'total',            v_total,
      'received',         v_received,
      'missing',          v_total - v_received,
      'mandatory_total',  v_mand_total,
      'mandatory_missing', v_mand_missing,
      'complete',         (v_mand_missing = 0)
    )
  );
end
$$;

-- =============================================================================
-- 4. accident_evidence_verify - the review transition the accident_evidence
--   schema supports (verification_status / verified_by / verified_at). Sets one
--   evidence row to verified / rejected / unverified and stamps WHO / WHEN. The
--   row must belong to this case (checked in the WHERE). Gate: elevated OR
--   app_user_can('accidents','submit').
--   (The task's "mark_received" verb has no home on accident_evidence - that table
--   carries verification_status, not a received flag - so this is the honest
--   schema-supported action for evidence; the received flag lives on documents,
--   handled by RPC 5.)
-- =============================================================================
create or replace function public.accident_evidence_verify(
  p_accident_id uuid,
  p_evidence_id uuid,
  p_decision    text,
  p_note        text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org      uuid;
  v_country  text;
  v_site     text;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_row      public.accident_evidence%rowtype;
begin
  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(p_accident_id);

  if v_decision <> any (array['verified','rejected','unverified']) then
    raise exception 'Invalid verification decision "%".', p_decision using errcode = '22023';
  end if;

  if not (public.app_is_elevated() or public.app_user_can('accidents', 'submit')) then
    raise exception 'Not permitted to verify evidence on this case.' using errcode = '42501';
  end if;

  update public.accident_evidence e set
     verification_status = v_decision,
     verified_by         = case when v_decision = 'unverified' then null else auth.uid() end,
     verified_at         = case when v_decision = 'unverified' then null else now() end,
     caption             = case when v_note is not null then v_note else e.caption end,
     updated_at          = now()
   where e.id = p_evidence_id
     and e.accident_id = p_accident_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Evidence % not found on this case.', p_evidence_id using errcode = 'P0002';
  end if;

  return jsonb_build_object('ok', true, 'evidence', to_jsonb(v_row));
end
$$;

-- =============================================================================
-- 5. accident_document_mark_received - the received transition the
--   accident_claim_documents schema supports (received / received_at). Marks one
--   claim document received and optionally attaches the storage reference that was
--   produced. The row must belong to this case. Gate: elevated OR
--   app_user_can('accidents','edit_insurance').
-- =============================================================================
create or replace function public.accident_document_mark_received(
  p_accident_id uuid,
  p_document_id uuid,
  p_storage_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org     uuid;
  v_country text;
  v_site    text;
  v_ref     text := nullif(btrim(coalesce(p_storage_ref, '')), '');
  v_row     public.accident_claim_documents%rowtype;
begin
  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(p_accident_id);

  if not (public.app_is_elevated() or public.app_user_can('accidents', 'edit_insurance')) then
    raise exception 'Not permitted to update claim documents on this case.' using errcode = '42501';
  end if;

  update public.accident_claim_documents d set
     received    = true,
     received_at = coalesce(d.received_at, now()),
     storage_ref = coalesce(v_ref, d.storage_ref),
     updated_at  = now()
   where d.id = p_document_id
     and d.accident_id = p_accident_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Document % not found on this case.', p_document_id using errcode = 'P0002';
  end if;

  return jsonb_build_object('ok', true, 'document', to_jsonb(v_row));
end
$$;

-- -----------------------------------------------------------------------------
-- GRANTS - anon revoked, authenticated granted; the in-body self-gate is the real
-- boundary (house pattern, V416).
-- -----------------------------------------------------------------------------
revoke all on function public.accident_evidence_add(uuid,text,text,text,text,text) from anon;
revoke all on function public.accident_document_add(uuid,text,text,text) from anon;
revoke all on function public.accident_evidence_checklist(uuid) from anon;
revoke all on function public.accident_evidence_verify(uuid,uuid,text,text) from anon;
revoke all on function public.accident_document_mark_received(uuid,uuid,text) from anon;

grant execute on function public.accident_evidence_add(uuid,text,text,text,text,text) to authenticated;
grant execute on function public.accident_document_add(uuid,text,text,text) to authenticated;
grant execute on function public.accident_evidence_checklist(uuid) to authenticated;
grant execute on function public.accident_evidence_verify(uuid,uuid,text,text) to authenticated;
grant execute on function public.accident_document_mark_received(uuid,uuid,text) to authenticated;

commit;
-- =============================================================================
