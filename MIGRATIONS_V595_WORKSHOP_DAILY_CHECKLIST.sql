-- V595 - THE TWO WORKSHOP CHECKLISTS REBUILT TO THE OWNER'S SPEC
-- STATUS: APPLIED live on jhssdmeruxtrlqnwfksc 2026-08-18 and behaviourally
-- verified by impersonation (see the footer).
-- Requires V594 (require_area_manager / doc_prefix / min_interval_days).
--
-- WHAT THE OWNER ASKED FOR, and what each part of this does:
--   "inspection stage not required"            -> f_ws_stage DELETED
--   "make sure asset code comes in one place
--    only remove job card no"                  -> f_ws_jc DELETED
--   "once they see the assets as required the
--    date comes lock"                          -> Date gains locked:true
--   "company cors all should be picked up auto
--    ... registration number will be fleet no
--    auto filled ... read only so no change
--    shows"                                    -> autoFrom + readOnly on Location
--                                                 and Registration / fleet No
--   "km needs to add and hours meter also"     -> both kept, grouped so at least
--                                                 one reading must be given
--   "add repair adjust lubricant ... make it
--    iconic type"                              -> legend 6 -> 8 marks, each with
--                                                 an icon, a tone and a MEANING
--   "marking for them and we must have meaning
--    for it"                                   -> option_sets.legend.meta
--   "no one is allowed to close until all done
--    and corrected"                            -> legend.blocking, ENFORCED in
--                                                 the approval trigger below
--   "title reference should be document number" -> doc_prefix WDC / FTM (V594)
--   "every 10 days a vehicle has to come"       -> min_interval_days 10
--   "its name is workshop daily checklist"      -> renamed
--
-- NOTHING IS RETYPED. Every field object is read from the LIVE template and
-- patched by id, so the 51 labels and their ar/hi/ur translations are carried
-- across untouched. The migration ABORTS unless it finds exactly the shape it
-- measured, because a partial rewrite of a published checklist is worse than
-- none: half a sheet reads as a whole one.
--
-- READ-ONLY IS CONDITIONAL, AND THAT IS DELIBERATE. Measured live before
-- writing this: fleet_number is populated on 398 of 1,030 KSA assets and on
-- ZERO of the 452 UAE and 135 Egypt assets; chassis_no likewise 389 / 0 / 0.
-- A field that is unconditionally read-only would therefore be permanently
-- BLANK and unfillable for most of the fleet. So readOnly means "read-only once
-- the register actually supplied a value"; where the register has nothing, the
-- man on the floor can still type what is on the machine. site IS populated on
-- 1,602 of 1,617 assets, so that one is read-only in practice almost always.
--
-- KM IS NOT PREFILLED FROM THE REGISTER, ON PURPOSE. vehicle_fleet.current_km
-- is a stale figure (it is only 248 of 1,030 KSA assets), and prefilling it
-- would let somebody submit last month's reading without noticing. The field
-- starts empty and carries compareTo so the phone can warn when the new reading
-- is LOWER than the last one - a warning, never a block, because a meter really
-- can be replaced.

do $$
declare
  v_ws  uuid := 'a3bae584-44c4-4427-9759-becb5e411103';
  v_tm  uuid := 'c1711e88-ad3d-4e42-a4e5-adac16395c03';
  v_legend jsonb;
  v_fields jsonb;
  v_out    jsonb;
  v_f      jsonb;
  n int;
begin
  ------------------------------------------------------------------ guards
  select count(*) into n from public.checklist_templates
   where id in (v_ws, v_tm)
     and status = 'published'
     and jsonb_array_length(option_sets #> '{legend,options}') = 6;
  if n <> 2 then
    raise exception 'V595 aborted: expected 2 published templates carrying the 6-mark legend, found %', n;
  end if;

  select count(*) into n from public.checklist_templates t, lateral jsonb_array_elements(t.fields) f
   where t.id = v_ws and f->>'id' in ('f_ws_stage','f_ws_jc');
  if n <> 2 then
    raise exception 'V595 aborted: expected f_ws_stage and f_ws_jc on the workshop template, found %', n;
  end if;

  ------------------------------------------------- the eight marks, with meaning
  -- Nothing is removed or renamed: the six existing marks keep their exact
  -- spelling and their exact position, so every answer already recorded against
  -- them still reads correctly. Adjusted and Lubricated are APPENDED.
  v_legend := jsonb_build_object(
    'options', jsonb_build_array(
      'OK','Not OK','Not applicable','Changed','Repaired','Added / Top-Up','Adjusted','Lubricated'),
    'i18n', jsonb_build_object(
      'ar', jsonb_build_array('سليم','غير سليم','لا ينطبق','تم التغيير','تم الإصلاح','تمت الإضافة','تم الضبط','تم التشحيم'),
      'hi', jsonb_build_array('ठीक','ठीक नहीं','लागू नहीं','बदला गया','मरम्मत की गई','भरा गया','समायोजित','ग्रीस किया'),
      'ur', jsonb_build_array('ٹھيک','ٹھيک نہيں','لاگو نہيں','تبديل کيا','مرمت کی','شامل کيا','ايڈجسٹ کيا','گريس کيا')
    ),
    -- icon = a token the app maps to its own glyph. tone drives the colour.
    -- meaning is shown to the man filling the sheet, because a mark nobody can
    -- explain is a mark that gets picked at random.
    'meta', jsonb_build_array(
      jsonb_build_object('value','OK',            'icon','ok',        'tone','good',  'meaning','Checked and correct. Nothing needed.'),
      jsonb_build_object('value','Not OK',        'icon','fault',     'tone','bad',   'meaning','A fault is present and has NOT been put right. Say what is wrong.'),
      jsonb_build_object('value','Not applicable','icon','na',        'tone','muted', 'meaning','This machine does not have this item.'),
      jsonb_build_object('value','Changed',       'icon','swap',      'tone','fixed', 'meaning','The part was replaced.'),
      jsonb_build_object('value','Repaired',      'icon','repair',    'tone','fixed', 'meaning','The fault was found and repaired.'),
      jsonb_build_object('value','Added / Top-Up','icon','topup',     'tone','fixed', 'meaning','Fluid or consumable was topped up.'),
      jsonb_build_object('value','Adjusted',      'icon','adjust',    'tone','fixed', 'meaning','Set back within limits without replacing anything.'),
      jsonb_build_object('value','Lubricated',    'icon','lubricant', 'tone','fixed', 'meaning','Greased or oiled as part of the check.')
    ),
    -- A sheet still carrying one of these cannot be APPROVED. It can still be
    -- submitted - a fault found late in the day must be recordable - it simply
    -- cannot be signed off as complete until it is corrected or re-marked.
    'blocking', jsonb_build_array('Not OK'),
    -- ...and it must say what is wrong, or "Not OK" carries no information.
    'require_note', jsonb_build_array('Not OK')
  );

  ------------------------------------------------------- WORKSHOP DAILY CHECKLIST
  select fields into v_fields from public.checklist_templates where id = v_ws;
  v_out := '[]'::jsonb;
  for v_f in select f from jsonb_array_elements(v_fields) f loop
    continue when v_f->>'id' in ('f_ws_stage','f_ws_jc');

    if v_f->>'id' = 'f_ws_date' then
      v_f := v_f || '{"locked": true, "autoValue": "today"}'::jsonb;

    elsif v_f->>'id' = 'f_ws_site' then
      v_f := v_f || '{"autoFrom": "asset.site", "readOnly": true}'::jsonb;

    elsif v_f->>'id' = 'f_ws_reg' then
      v_f := v_f
        || '{"label": "Registration / fleet No", "autoFrom": "asset.fleet_no", "readOnly": true, "required": true}'::jsonb
        || jsonb_build_object('labels', jsonb_build_object(
             'ar','رقم اللوحة / رقم الأسطول','hi','रजिस्ट्रेशन / फ्लीट नंबर','ur','رجسٹريشن / فليٹ نمبر'));

    elsif v_f->>'id' = 'f_ws_chassis' then
      -- Prefilled as a convenience but left EDITABLE: the register holds a
      -- chassis for 389 assets and nothing at all outside KSA.
      v_f := v_f || '{"autoFrom": "asset.chassis_no"}'::jsonb;

    elsif v_f->>'id' = 'f_ws_km' then
      v_f := v_f || '{"group_require_one": "meter", "compareTo": "asset.current_km", "unit": "km"}'::jsonb;

    elsif v_f->>'id' = 'f_ws_hr' then
      v_f := v_f || '{"group_require_one": "meter", "unit": "hours"}'::jsonb;

    elsif v_f->>'options_ref' = 'legend' then
      v_f := v_f || '{"allow_note": true, "allow_photo": true, "allow_gallery": true, "require_note_when": ["Not OK"]}'::jsonb;
      -- Keep the inline copy in step with the shared set. The builder treats the
      -- field's own options as a fallback for when the shared list is removed,
      -- so leaving it at six would silently offer six marks if that ever happens.
      v_f := jsonb_set(v_f, '{options}', v_legend->'options');
    end if;

    v_out := v_out || jsonb_build_array(v_f);
  end loop;

  update public.checklist_templates set
    fields               = v_out,
    option_sets          = jsonb_set(coalesce(option_sets,'{}'::jsonb), '{legend}', v_legend),
    name                 = 'Workshop Daily Checklist',
    name_i18n            = jsonb_build_object(
                             'ar','قائمة الفحص اليومي للورشة',
                             'hi','वर्कशॉप दैनिक चेकलिस्ट',
                             'ur','ورکشاپ روزانہ چيک لسٹ'),
    icon                 = 'wrench',
    version              = version + 1,
    require_area_manager = true,
    doc_prefix           = 'WDC',
    min_interval_days    = 10,
    assignee_roles       = array['Mechanic','Electrician','Maintenance Supervisor'],
    updated_at           = now()
  where id = v_ws;

  --------------------------------------------------- FLEET TRANSIT MIXER CHECKLIST
  select fields into v_fields from public.checklist_templates where id = v_tm;
  v_out := '[]'::jsonb;
  for v_f in select f from jsonb_array_elements(v_fields) f loop

    if v_f->>'id' = 'f_tm_date' then
      v_f := v_f || '{"locked": true, "autoValue": "today"}'::jsonb;

    elsif v_f->>'options_ref' = 'legend' then
      v_f := v_f || '{"allow_note": true, "allow_photo": true, "allow_gallery": true, "require_note_when": ["Not OK"]}'::jsonb;
      v_f := jsonb_set(v_f, '{options}', v_legend->'options');
    end if;

    v_out := v_out || jsonb_build_array(v_f);

    -- The mixer sheet had no location, no registration and no meter reading at
    -- all, so the same corrections are applied here: they go in directly after
    -- the asset, which is what fills them.
    if v_f->>'id' = 'f_tm_asset' then
      v_out := v_out || jsonb_build_array(
        jsonb_build_object(
          'id','f_tm_site','type','site','label','Location','required',true,
          'autoFrom','asset.site','readOnly',true,
          'labels', jsonb_build_object('ar','الموقع','hi','स्थान','ur','مقام')),
        jsonb_build_object(
          'id','f_tm_reg','type','text','label','Registration / fleet No','required',true,
          'autoFrom','asset.fleet_no','readOnly',true,
          'labels', jsonb_build_object('ar','رقم اللوحة / رقم الأسطول','hi','रजिस्ट्रेशन / फ्लीट नंबर','ur','رجسٹريشن / فليٹ نمبر')),
        jsonb_build_object(
          'id','f_tm_km','type','number','label','Km reading','required',false,
          'group_require_one','meter','compareTo','asset.current_km','unit','km',
          'labels', jsonb_build_object('ar','قراءة العداد (كم)','hi','किलोमीटर रीडिंग','ur','کلوميٹر ريڈنگ')),
        jsonb_build_object(
          'id','f_tm_hr','type','number','label','Hour meter reading','required',false,
          'group_require_one','meter','unit','hours',
          'labels', jsonb_build_object('ar','قراءة عداد الساعات','hi','ऑवर मीटर रीडिंग','ur','آور ميٹر ريڈنگ'))
      );
    end if;
  end loop;

  update public.checklist_templates set
    fields            = v_out,
    option_sets       = jsonb_set(coalesce(option_sets,'{}'::jsonb), '{legend}', v_legend),
    icon              = 'truck',
    version           = version + 1,
    doc_prefix        = 'FTM',
    assignee_roles    = array['Driver'],
    updated_at        = now()
  where id = v_tm;

  ------------------------------------------------------------------- re-assert
  select count(*) into n from public.checklist_templates t, lateral jsonb_array_elements(t.fields) f
   where t.id = v_ws and f->>'id' in ('f_ws_stage','f_ws_jc');
  if n <> 0 then raise exception 'V595 aborted: removed fields are still present'; end if;

  select count(*) into n from public.checklist_templates
   where id in (v_ws, v_tm) and jsonb_array_length(option_sets #> '{legend,options}') = 8;
  if n <> 2 then raise exception 'V595 aborted: the 8-mark legend did not land on both templates'; end if;
end $$;

-- THE "CANNOT CLOSE UNTIL CORRECTED" RULE, ENFORCED SERVER-SIDE.
-- V594's guard made the two stages honest. This makes the CONTENT honest: an
-- area manager cannot approve a sheet that still carries a blocking mark, so
-- "all done and corrected" is a property of the record, not of somebody
-- remembering. It reads the template's OWN legend, so a template that declares
-- no blocking marks is unaffected - this ships inert for the other four.
create or replace function public.guard_checklist_approval_stages()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_two_stage boolean;
  v_blocking  jsonb;
  v_bad       text;
begin
  if new.approval_status is not distinct from old.approval_status then return new; end if;

  select coalesce(t.require_area_manager, false), t.option_sets #> '{legend,blocking}'
    into v_two_stage, v_blocking
    from public.checklist_templates t where t.id = new.template_id;
  v_two_stage := coalesce(v_two_stage, false);

  if new.approval_status = 'rejected' then
    if not public.checklist_is_supervisor() then
      raise exception 'You do not have permission to reject this checklist' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.approval_status = 'pending_area_manager' then
    if not v_two_stage then
      raise exception 'This checklist does not use an area-manager stage' using errcode = '22023';
    end if;
    if not public.checklist_is_supervisor() then
      raise exception 'Only a supervisor can sign off this checklist' using errcode = '42501';
    end if;
    if coalesce(btrim(new.supervisor_name), '') = ''
       or coalesce(btrim(new.supervisor_signature), '') = '' then
      raise exception 'A supervisor name and signature are required' using errcode = '22023';
    end if;
    new.supervisor_by := coalesce(new.supervisor_by, auth.uid());
    new.supervisor_at := coalesce(new.supervisor_at, now());
    return new;
  end if;

  if new.approval_status = 'approved' then
    -- Nothing outstanding may remain. Checked at APPROVAL, never at submit: a
    -- fault found on the last item of the day must still be recordable.
    if v_blocking is not null and jsonb_typeof(v_blocking) = 'array' then
      select string_agg(distinct a.value, ', ') into v_bad
        from jsonb_each_text(coalesce(new.answers, '{}'::jsonb)) a
       where jsonb_exists(v_blocking, a.value);
      if v_bad is not null then
        raise exception 'This checklist still has items marked "%". It cannot be closed until they are corrected or re-marked.', v_bad
          using errcode = '22023';
      end if;
    end if;

    if v_two_stage then
      if coalesce(btrim(coalesce(new.supervisor_signature, old.supervisor_signature)), '') = '' then
        raise exception 'A supervisor must sign off before the area manager can approve' using errcode = '22023';
      end if;
      if not public.checklist_is_area_manager() then
        raise exception 'Only an area manager can give final approval' using errcode = '42501';
      end if;
    elsif not public.checklist_is_supervisor() then
      raise exception 'You do not have permission to approve this checklist' using errcode = '42501';
    end if;

    if coalesce(btrim(new.approver_name), '') = ''
       or coalesce(btrim(new.approver_signature), '') = '' then
      raise exception 'An approver name and signature are required' using errcode = '22023';
    end if;
    new.approved_by := coalesce(new.approved_by, auth.uid());
    new.approved_at := coalesce(new.approved_at, now());
    return new;
  end if;

  return new;
end;
$fn$;

-- VERIFIED AFTER APPLY, live:
--   Workshop Daily Checklist  fields 51 -> 49 (f_ws_stage + f_ws_jc gone),
--     version 2, doc_prefix WDC, require_area_manager true, min_interval_days 10,
--     assignee_roles {Mechanic,Electrician,Maintenance Supervisor}, icon wrench,
--     31 check fields now offering all 8 marks, 3 fields carrying autoFrom
--     (site, registration/fleet, chassis), km + hours in one meter group.
--   Fleet Transit Mixer       fields 16 -> 20 (location, registration/fleet, km,
--     hour meter added straight after the asset), version 2, doc_prefix FTM,
--     assignee_roles {Driver}, icon truck, 6 check fields on 8 marks.
--   Both legends 8 marks, blocking ["Not OK"].
--
--   THE CLOSE RULE, proven end to end as the real KSA Manager then the real
--   Workshop Maintenance Area Manager, on a sheet answered
--   {gen_1: Not OK, gen_2: OK, gen_3: Lubricated}:
--     document minted                                   WDC-TM514-2026-0001
--     supervisor signs off while a Not OK is present    ACCEPTED  (a fault must
--                                                       still be recordable)
--     area manager tries to close it                    REFUSED 22023 'This
--       checklist still has items marked "Not OK". It cannot be closed until
--       they are corrected or re-marked.'
--     the item is re-marked Repaired, area manager      ACCEPTED, approved
--   The probe rows were deleted afterwards and re-counted: submissions back to
--   the 3 pre-existing rows, checklist_doc_counters 0.
--
-- ROLLBACK: restore fields/option_sets/name/version/icon from a pre-V595 dump,
-- set require_area_manager=false and doc_prefix=null on both, and re-apply the
-- V594 body of guard_checklist_approval_stages (this migration only ADDED the
-- blocking-mark check to it; the two-stage logic is unchanged).
