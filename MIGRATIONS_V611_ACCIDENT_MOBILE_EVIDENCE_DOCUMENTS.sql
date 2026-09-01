-- V611 - Align mobile accident evidence and Saudi document vocabulary.
--
-- The former mobile contract treated thirteen fixed vehicle photographs as
-- globally mandatory and required a driver statement / police-style document
-- on several routes. The field workflow now records evidence against the exact
-- damaged component selected by the reporter. Supporting identity and authority
-- documents remain optional at intake and can be requested by their owning
-- workstream later.
--
-- This migration changes configuration only. It does not rewrite historical
-- evidence, remove stored files, or mark an existing case complete.

begin;

-- Retire the fixed 13-photo baseline. Route/type-specific rows that are not in
-- this list remain available. Exact selected-component evidence is enforced by
-- the mobile draft until normalized evidence rows are created after sync.
update public.accident_evidence_requirements
   set active = false,
       updated_at = now()
 where requirement_key = any (array[
   'photo_full_front',
   'photo_full_rear',
   'photo_left_side',
   'photo_right_side',
   'photo_front_left_corner',
   'photo_front_right_corner',
   'photo_rear_left_corner',
   'photo_rear_right_corner',
   'photo_damage_closeup',
   'photo_plate',
   'photo_odometer',
   'photo_dashboard_lights'
 ]::text[])
   and route_key is null
   and accident_type is null;

-- Driver statements and generic police/authority uploads are no longer part of
-- the mobile document set. Najm is the single optional authority report in the
-- Saudi flow; historical evidence rows remain untouched.
update public.accident_evidence_requirements
   set active = false,
       updated_at = now()
 where requirement_key = any (array[
   'doc_driver_statement',
   'doc_authority_report',
   'doc_police_report'
 ]::text[]);

-- Add the optional mobile document slots for every tenant. There is no unique
-- constraint on this configuration table, so the NOT EXISTS predicate is the
-- idempotency guard used by the original seed.
insert into public.accident_evidence_requirements (
  organisation_id,
  route_key,
  accident_type,
  country,
  requirement_key,
  label,
  category,
  kind,
  mandatory,
  sort_order,
  active
)
select
  o.id,
  null,
  null,
  'KSA',
  v.requirement_key,
  v.label,
  'supporting_document',
  'document',
  false,
  v.sort_order,
  true
from public.organisations o
cross join (values
  ('doc_driving_licence'::text, 'Driving licence'::text, 300),
  ('doc_iqama',                'Iqama',                    310),
  ('doc_istimara',             'Istimara',                 320),
  ('doc_najm_report',          'Najm report',              330),
  ('doc_taqdeer_report',       'Taqdeer report',           340)
) as v(requirement_key, label, sort_order)
where not exists (
  select 1
    from public.accident_evidence_requirements e
   where e.organisation_id = o.id
     and e.requirement_key = v.requirement_key
     and coalesce(e.route_key, '') = ''
     and coalesce(e.accident_type, '') = ''
     and coalesce(e.country, '') = 'KSA'
);

-- These documents may still be requested and verified by Fleet, HSE or
-- Insurance, but they do not block the reporter's initial submission or case
-- closure merely because an obsolete mobile slot is empty.
--
-- Route profiles carry a second evidence array used by the closure engine.
-- Keep only the scene overview and narrowly conditional scene/third-party
-- photographs there; the exact damage close-ups are derived from the selected
-- component IDs and travel with the queued report.
update public.accident_route_profiles
   set required_evidence = array(
         select requirement_key
           from unnest(required_evidence) as requirement_key
          where requirement_key = any (array[
            'photo_scene',
            'photo_other_party_vehicle',
            'photo_other_party_plate',
            'photo_road_condition'
          ]::text[])
       ),
       updated_at = now();

update public.accident_route_profiles
   set required_documents = array_remove(
         array_remove(
           array_remove(required_documents, 'driver_statement'),
           'police_report'
         ),
         'authority_report'
       ),
       updated_at = now();

update public.accident_country_rule_profiles
   set required_documents = array_remove(
         array_remove(
           array_remove(
             array_remove(required_documents, 'driver_statement'),
             'police_report'
           ),
           'authority_report'
         ),
         'najm_report'
       ),
       updated_at = now();

commit;
