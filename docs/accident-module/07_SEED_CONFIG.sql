-- 07_SEED_CONFIG.sql
-- =============================================================================
-- ACCIDENT MODULE - SEED CONFIGURATION (business-rule engine as DATA)
--
-- STATUS: NOT APPLIED. This file is a REVIEW ARTIFACT only. Do NOT run it until it
-- has been reviewed AND its dependencies (below) are satisfied. Companion design
-- doc: docs/accident-module/07_SEED_CONFIG.md.
--
-- WHAT IT DOES
--   Seeds the six accident config tables for Company A so the module's routes,
--   accident types, evidence checklist, SLA timers, country regulatory controls and
--   the new email triggers are DATA, not hardcoded logic (brief sections 4, 9, 10,
--   15, 16, 27). Scope: Company A only (00000000-0000-0000-0000-000000000001), the
--   single live tenant. A second GCC country/tenant = more rows, never code.
--
-- HARD DEPENDENCIES (run this ONLY after all are true)
--   1. V417 (docs/accident-module/02_DATA_MODEL.sql) IS APPLIED. It creates
--      accident_country_rule_profiles, accident_route_profiles, accident_type_profiles,
--      accident_evidence_requirements, accident_sla_definitions (and adds
--      accidents.case_no). accident_email_templates already exists (V302).
--   2. TOKEN RESOLVER: the 7 new email templates use five tokens the current
--      accident_apply_tokens(text, accidents, text) resolver does NOT yet emit -
--      {{case_no}}, {{liability}}, {{owner}}, {{missing_docs}}, {{latest_decision}}.
--      Extend the resolver (one function) to emit them BEFORE any trigger is wired to
--      these template keys, or an unresolved {{case_no}} renders literally in a
--      subject. The templates are inserted active=true (to match their 15 siblings)
--      but NO trigger references their keys today, so they cannot send until wired.
--   3. ACCIDENT-TYPE VOCABULARY: accident_type_profiles.accident_type has no CHECK
--      (all 31 rows insert cleanly), but for a CASE to resolve its profile,
--      accidents.accident_type must carry one of these tokens. The live
--      accidents.accident_type CHECK (V222) is narrower - widening it (or mapping the
--      app's display types onto these tokens) is a SEPARATE phase-later migration.
--
-- RELATIONSHIP TO 02_DATA_MODEL.sql PART F (base vs extension)
--   02 PART F (V417) already seeds the CANONICAL BASE for Company A in three of the
--   tables below: accident_sla_definitions (11 rows), accident_route_profiles
--   (minor_no_insurance, external_repair_insurance, total_loss, injury) and
--   accident_country_rule_profiles (KSA, UAE, Egypt), all in the canonical 10-key
--   workstream vocabulary. This file is EXTENSION-ONLY: it never re-inserts a row 02
--   already provides (a silent ON CONFLICT DO NOTHING would just never land and hide
--   this file's richer columns). Instead it INSERTs only the rows 02 omits (the 6
--   extra route profiles, all 31 type profiles, the evidence requirements and the 7
--   email templates) and, where 02's base row must carry extra config this file adds
--   (route required_evidence / required_documents / closure_requirements, country
--   required_documents / notes, SLA responsible_role), it uses an explicit UPDATE
--   scoped to the 02-seeded key, with a comment - never a silent no-op insert. The
--   result is order-independent: 02 must run first (hard dependency 1) and this file
--   only adds to it.
--
-- DESIGN NOTES
--   * required_workstreams[] uses the 10 canonical accident_case_workstreams.
--     workstream_key CHECK keys (incident_evidence, fleet_validation, liability,
--     insurance, assessment, repair, workshop_qc, handover, finance, corrective) so
--     route-instantiated workstream rows pass that CHECK and accident_required_
--     workstreams (which silently DROPS any non-canonical token) counts every
--     required workstream. `corrective` IS a real workstream key. closure_
--     requirements[] is a SEPARATE closure-milestone vocabulary (repair_route,
--     insurance_settlement, corrective_actions, closure_review, total_loss_approval,
--     ...) - not a workstream_key, not validated by the CHECK, so those tokens stay
--     as descriptive milestones.
--   * Regulatory windows are GROUNDED in the brief: only KSA carries 9/5/45 working
--     days (brief 5C). UAE/Egypt regulatory day counts are NULL (brief states none -
--     not invented). Najm is KSA-only and is NOT placed on UAE/Egypt.
--   * working_days/holidays are configurable DEFAULTS (brief 15) flagged in notes;
--     holidays is [] (no dates invented). Currencies (SAR/AED/EGP) are config data.
--
-- IDEMPOTENCY
--   Tables with a natural unique key use ON CONFLICT DO NOTHING. accident_evidence_
--   requirements has NO unique constraint in V417, so its rows use
--   INSERT ... SELECT ... WHERE NOT EXISTS keyed on
--   (org, requirement_key, route_key, accident_type). Re-running inserts nothing new.
--
-- NON-DESTRUCTIVE
--   Adds rows for Company A only. The only UPDATEs are the additive enrichments of
--   02 PART F's own base rows described above (setting columns 02 leaves at their
--   default: route required_evidence / required_documents / closure_requirements,
--   country required_documents / notes, SLA responsible_role). It never touches the
--   pre-module config (the 15 email templates, 7 routing rules and 12 departments).
--
-- ROLLBACK
--   See the commented ROLLBACK block at the very bottom.
-- =============================================================================

begin;

-- Company A (single live tenant). Every statement below scopes to this org.
-- org = '00000000-0000-0000-0000-000000000001'

-- =============================================================================
-- PART 1 - accident_country_rule_profiles (KSA / UAE / Egypt) - ENRICH 02's base
--   02 PART F already seeds KSA/UAE/Egypt with currency, authority_types, the KSA
--   9/5/45 regulatory windows and working_days (canonical base). This file only
--   ADDS the columns 02 leaves at their default: required_documents and notes. It
--   deliberately does NOT overwrite 02's authority_types / working_days / regulatory
--   windows (those are the canonical base). holidays already default to '[]' (no
--   dates invented). UPDATE is idempotent and lands whatever the run order, because
--   02 is a hard dependency and always seeds the base rows first.
-- =============================================================================
update public.accident_country_rule_profiles t
   set required_documents = v.required_documents,
       notes              = v.notes
from (values
  ('KSA'::text,
   array['authority_report','najm_report','driving_license','vehicle_registration','insurance_policy','driver_statement'],
   'KSA regulator: Insurance Authority (since Nov 2023). Windows 9/5/45 are the unified compulsory motor policy maxima for a juristic person (brief 5C) and are configurable controls - comprehensive/contractual policies may differ. Najm = official accident reporting; Absher = electronic minor-accident reporting. working_days/holidays are configurable defaults - confirm locally; holidays load per country.'),
  ('UAE',
   array['authority_report','police_report','driving_license','vehicle_registration','insurance_policy','driver_statement'],
   'UAE regulatory windows not specified in the brief - left NULL, configure locally. Authority list uses the brief generic categories (Najm excluded - KSA-specific). working_days/holidays are configurable defaults - confirm locally.'),
  ('Egypt',
   array['authority_report','police_report','driving_license','vehicle_registration','insurance_policy','driver_statement'],
   'Egypt regulatory windows not specified in the brief - left NULL, configure locally. Authority list uses the brief generic categories (Najm excluded - KSA-specific). working_days/holidays are configurable defaults - confirm locally.')
) as v(country, required_documents, notes)
where t.organisation_id = '00000000-0000-0000-0000-000000000001'
  and t.country = v.country;

-- =============================================================================
-- PART 2 - accident_route_profiles - EXTEND 02's base with the 6 EXTRA routes
--   02 PART F already seeds the 4 base routes (minor_no_insurance,
--   external_repair_insurance, total_loss, injury) with canonical required_
--   workstreams. This INSERT adds ONLY the 6 routes 02 does NOT seed. Every
--   required_workstreams[] uses the 10 canonical keys (incident_evidence,
--   fleet_validation, liability, insurance, assessment, repair, workshop_qc,
--   handover, finance, corrective) so accident_required_workstreams counts them all
--   instead of silently dropping non-canonical tokens. closure_requirements[] keeps
--   its milestone tokens (repair_route, insurance_settlement, corrective_actions,
--   closure_review, third_party_recovery) but its workstream-key-shaped tokens are
--   canonicalised too, so no non-canonical workstream token survives anywhere.
--   ON CONFLICT DO NOTHING is safe here because these 6 keys are NOT in 02.
-- =============================================================================
insert into public.accident_route_profiles (
  organisation_id, route_key, name, description,
  match_types, required_workstreams, required_evidence, required_documents,
  closure_requirements, is_default, active
) values
  ('00000000-0000-0000-0000-000000000001', 'internal_repair_insurance',
   'Internal repair with insurance',
   'Insured case repaired in the internal workshop (brief 4/9).',
   array['site_collision','equipment_to_vehicle','equipment_to_equipment','loading_unloading','falling_object'],
   array['incident_evidence','fleet_validation','liability','insurance','assessment','repair','workshop_qc','handover','finance'],
   array['photo_full_front','photo_full_rear','photo_left_side','photo_right_side','photo_damage_closeup','photo_scene','photo_plate','photo_odometer','photo_dashboard_lights'],
   array['insurance_policy','insurer_ack','driver_statement'],
   array['incident_evidence','fleet_validation','liability','insurance','assessment','repair_route','workshop_qc','handover','finance','insurance_settlement','corrective_actions','closure_review'],
   false, true),

  ('00000000-0000-0000-0000-000000000001', 'third_party',
   'Third-party damage',
   'Third-party involvement with recovery tracking (brief 14).',
   array['vehicle_to_vehicle','third_party_property','customer_property','subcontractor_vehicle'],
   array['incident_evidence','fleet_validation','liability','insurance','assessment','repair','workshop_qc','handover','finance'],
   array['photo_full_front','photo_full_rear','photo_left_side','photo_right_side','photo_damage_closeup','photo_scene','photo_plate','photo_other_party_vehicle','photo_other_party_plate'],
   array['authority_report','insurance_policy','driver_statement'],
   array['incident_evidence','fleet_validation','liability','insurance','assessment','repair_route','workshop_qc','handover','finance','third_party_recovery','insurance_settlement','closure_review'],
   false, true),

  ('00000000-0000-0000-0000-000000000001', 'hit_and_run',
   'Hit and run',
   'Unknown third party - authority report required, no third-party recovery (brief 14).',
   array['hit_and_run'],
   array['incident_evidence','fleet_validation','liability','insurance','assessment','repair','workshop_qc','handover','finance'],
   array['photo_full_front','photo_full_rear','photo_left_side','photo_right_side','photo_damage_closeup','photo_scene','photo_plate','photo_odometer'],
   array['authority_report','police_report','driver_statement'],
   array['incident_evidence','fleet_validation','liability','insurance','assessment','repair_route','workshop_qc','handover','finance','insurance_settlement','closure_review'],
   false, true),

  ('00000000-0000-0000-0000-000000000001', 'glass_only',
   'Glass-only damage',
   'Windscreen/glass only - lite liability, optional insurance (brief 14).',
   array['glass_only'],
   array['incident_evidence','liability','repair','finance'],
   array['photo_damage_closeup','photo_plate','photo_odometer'],
   array[]::text[],
   array['incident_evidence','liability','repair_route','finance','closure_review'],
   false, true),

  ('00000000-0000-0000-0000-000000000001', 'no_damage',
   'No-damage / near miss',
   'No-damage incident or near miss - evidence + liability + corrective, no repair/finance (brief 14).',
   array['no_damage','near_miss'],
   array['incident_evidence','liability'],
   array['photo_scene','photo_plate'],
   array[]::text[],
   array['incident_evidence','liability','corrective_actions','closure_review'],
   false, true),

  ('00000000-0000-0000-0000-000000000001', 'theft_fire_weather',
   'Theft / fire / weather',
   'Theft, fire or weather damage - authority report, may become total loss (brief 14).',
   array['theft','fire','weather'],
   array['incident_evidence','fleet_validation','liability','insurance','assessment','repair','finance'],
   array['photo_full_front','photo_full_rear','photo_left_side','photo_right_side','photo_damage_closeup','photo_scene','photo_plate'],
   array['authority_report','police_report','insurance_policy'],
   array['incident_evidence','fleet_validation','liability','insurance','assessment','repair_route','finance','insurance_settlement','closure_review'],
   false, true)
on conflict (organisation_id, route_key) do nothing;

-- ENRICH the 4 routes 02 PART F already seeds (it sets required_workstreams,
-- match_types, name, description, is_default but leaves required_evidence,
-- required_documents and closure_requirements at their '{}' default). This UPDATE
-- fills those three arrays only; it never touches required_workstreams (02's
-- canonical values are authoritative). closure_requirements tokens are canonicalised
-- (liability_safety->liability, technical_assessment->assessment, fleet_handover->
-- handover, finance_settlement->finance) while milestone tokens (repair_route,
-- insurance_settlement, corrective_actions, closure_review, total_loss_approval,
-- asset_register_update, hse_investigation, injury_details, management_review,
-- legal_review) stay. Idempotent (a re-run writes the same arrays).
update public.accident_route_profiles t
   set required_evidence    = v.required_evidence,
       required_documents   = v.required_documents,
       closure_requirements = v.closure_requirements
from (values
  ('minor_no_insurance'::text,
   array['photo_full_front','photo_full_rear','photo_left_side','photo_right_side','photo_damage_closeup','photo_scene','photo_plate','photo_odometer'],
   array['driver_statement'],
   array['incident_evidence','fleet_validation','liability','assessment','repair_route','handover','finance','corrective_actions','closure_review']),
  ('external_repair_insurance',
   array['photo_full_front','photo_full_rear','photo_left_side','photo_right_side','photo_front_left_corner','photo_front_right_corner','photo_rear_left_corner','photo_rear_right_corner','photo_damage_closeup','photo_scene','photo_plate','photo_odometer','photo_dashboard_lights'],
   array['insurance_policy','insurer_ack','quotation','purchase_order','invoice','driver_statement'],
   array['incident_evidence','fleet_validation','liability','insurance','assessment','repair_route','workshop_qc','handover','finance','insurance_settlement','corrective_actions','closure_review']),
  ('total_loss',
   array['photo_full_front','photo_full_rear','photo_left_side','photo_right_side','photo_damage_closeup','photo_scene','photo_plate','photo_chassis_vin'],
   array['insurance_policy','survey_report','insurer_ack'],
   array['incident_evidence','fleet_validation','liability','insurance','assessment','total_loss_approval','asset_register_update','insurance_settlement','finance','closure_review']),
  ('injury',
   array['photo_full_front','photo_full_rear','photo_left_side','photo_right_side','photo_damage_closeup','photo_scene','photo_plate','photo_road_condition','photo_dashboard_lights'],
   array['authority_report','medical_report','driver_statement'],
   array['incident_evidence','fleet_validation','liability','hse_investigation','injury_details','insurance','assessment','repair_route','handover','finance','management_review','corrective_actions','legal_review','closure_review'])
) as v(route_key, required_evidence, required_documents, closure_requirements)
where t.organisation_id = '00000000-0000-0000-0000-000000000001'
  and t.route_key = v.route_key;

-- =============================================================================
-- PART 3 - accident_type_profiles (31 types, brief section 4)
--   default_route_key resolves to a Part-2 route (NULL for administrative modifiers).
--   required_teams / responsible teams reference the 12 existing departments BY NAME.
--   email_recipient_roles reference brief section-16 role names.
-- =============================================================================
insert into public.accident_type_profiles (
  organisation_id, accident_type, default_route_key,
  required_teams, email_recipient_roles, sla_overrides, reporting_category, active
) values
  ('00000000-0000-0000-0000-000000000001','minor_road','minor_no_insurance',
    array['Fleet / PMV','Workshop'], array['Fleet Supervisor'], '{}'::jsonb, 'road_traffic', true),
  ('00000000-0000-0000-0000-000000000001','major_road','external_repair_insurance',
    array['Fleet / PMV','Workshop','Insurance'], array['Fleet Supervisor','HSE Officer','Insurance Claims Officer'], '{}'::jsonb, 'road_traffic', true),
  ('00000000-0000-0000-0000-000000000001','site_collision','internal_repair_insurance',
    array['Fleet / PMV','Workshop','Site Management'], array['Fleet Supervisor','Site Management'], '{}'::jsonb, 'site_incident', true),
  ('00000000-0000-0000-0000-000000000001','vehicle_to_vehicle','third_party',
    array['Fleet / PMV','Workshop','Insurance'], array['Fleet Supervisor','Insurance Claims Officer'], '{}'::jsonb, 'third_party', true),
  ('00000000-0000-0000-0000-000000000001','equipment_to_vehicle','internal_repair_insurance',
    array['Fleet / PMV','Workshop','Operations'], array['Fleet Supervisor','HSE Officer'], '{}'::jsonb, 'site_incident', true),
  ('00000000-0000-0000-0000-000000000001','equipment_to_equipment','internal_repair_insurance',
    array['Fleet / PMV','Workshop','Operations'], array['Fleet Supervisor','HSE Officer'], '{}'::jsonb, 'site_incident', true),
  ('00000000-0000-0000-0000-000000000001','third_party_property','third_party',
    array['Fleet / PMV','Insurance','Legal'], array['Fleet Supervisor','Insurance Claims Officer'], '{}'::jsonb, 'third_party', true),
  ('00000000-0000-0000-0000-000000000001','customer_property','third_party',
    array['Fleet / PMV','Insurance','Legal'], array['Fleet Manager','Insurance Claims Officer'], '{}'::jsonb, 'third_party', true),
  ('00000000-0000-0000-0000-000000000001','own_damage','minor_no_insurance',
    array['Fleet / PMV','Workshop'], array['Fleet Supervisor'], '{}'::jsonb, 'own_damage', true),
  ('00000000-0000-0000-0000-000000000001','injury','injury',
    array['HSE / Safety','Fleet / PMV','Insurance','Senior Management'], array['HSE Manager','Fleet Manager','Insurance Manager'], '{}'::jsonb, 'injury_fatality', true),
  ('00000000-0000-0000-0000-000000000001','fatal','injury',
    array['HSE / Safety','Fleet / PMV','Insurance','Legal','Senior Management'], array['HSE Manager','Fleet Manager','Insurance Manager'], '{}'::jsonb, 'injury_fatality', true),
  ('00000000-0000-0000-0000-000000000001','hit_and_run','hit_and_run',
    array['Fleet / PMV','Insurance','HSE / Safety'], array['Fleet Supervisor','Insurance Claims Officer'], '{}'::jsonb, 'road_traffic', true),
  ('00000000-0000-0000-0000-000000000001','theft','theft_fire_weather',
    array['Fleet / PMV','Insurance','Security'], array['Fleet Manager','Insurance Claims Officer'], '{}'::jsonb, 'theft_fire', true),
  ('00000000-0000-0000-0000-000000000001','fire','theft_fire_weather',
    array['Fleet / PMV','Workshop','HSE / Safety','Insurance'], array['Fleet Manager','HSE Manager','Insurance Claims Officer'], '{}'::jsonb, 'theft_fire', true),
  ('00000000-0000-0000-0000-000000000001','weather','theft_fire_weather',
    array['Fleet / PMV','Workshop','Insurance'], array['Fleet Supervisor','Insurance Claims Officer'], '{}'::jsonb, 'weather', true),
  ('00000000-0000-0000-0000-000000000001','glass_only','glass_only',
    array['Fleet / PMV','Workshop'], array['Fleet Supervisor'], '{}'::jsonb, 'own_damage', true),
  ('00000000-0000-0000-0000-000000000001','tyre_wheel','minor_no_insurance',
    array['Fleet / PMV','Workshop'], array['Fleet Supervisor'], '{}'::jsonb, 'own_damage', true),
  ('00000000-0000-0000-0000-000000000001','rollover','external_repair_insurance',
    array['Fleet / PMV','Workshop','HSE / Safety','Insurance'], array['Fleet Manager','HSE Officer','Insurance Claims Officer'], '{}'::jsonb, 'road_traffic', true),
  ('00000000-0000-0000-0000-000000000001','loading_unloading','internal_repair_insurance',
    array['Fleet / PMV','Workshop','Operations'], array['Fleet Supervisor','HSE Officer'], '{}'::jsonb, 'site_incident', true),
  ('00000000-0000-0000-0000-000000000001','falling_object','internal_repair_insurance',
    array['Fleet / PMV','Workshop','HSE / Safety'], array['Fleet Supervisor','HSE Officer'], '{}'::jsonb, 'site_incident', true),
  ('00000000-0000-0000-0000-000000000001','uninsured','minor_no_insurance',
    array['Fleet / PMV','Workshop','Finance'], array['Fleet Manager','Finance Officer'], '{}'::jsonb, 'own_damage', true),
  ('00000000-0000-0000-0000-000000000001','expired_policy','minor_no_insurance',
    array['Fleet / PMV','Insurance','Finance'], array['Fleet Manager','Insurance Manager'], '{}'::jsonb, 'own_damage', true),
  ('00000000-0000-0000-0000-000000000001','rental_vehicle','external_repair_insurance',
    array['Fleet / PMV','Insurance','Procurement'], array['Fleet Supervisor','Insurance Claims Officer'], '{}'::jsonb, 'road_traffic', true),
  ('00000000-0000-0000-0000-000000000001','leased_vehicle','external_repair_insurance',
    array['Fleet / PMV','Insurance','Finance'], array['Fleet Supervisor','Insurance Claims Officer'], '{}'::jsonb, 'road_traffic', true),
  ('00000000-0000-0000-0000-000000000001','subcontractor_vehicle','third_party',
    array['Fleet / PMV','Insurance','Legal'], array['Fleet Supervisor','Insurance Claims Officer'], '{}'::jsonb, 'third_party', true),
  ('00000000-0000-0000-0000-000000000001','no_damage','no_damage',
    array['Fleet / PMV','HSE / Safety'], array['Fleet Supervisor'], '{}'::jsonb, 'near_miss', true),
  ('00000000-0000-0000-0000-000000000001','near_miss','no_damage',
    array['HSE / Safety','Fleet / PMV'], array['HSE Officer','Fleet Supervisor'], '{}'::jsonb, 'near_miss', true),
  ('00000000-0000-0000-0000-000000000001','total_loss','total_loss',
    array['Fleet / PMV','Insurance','Finance','Senior Management'], array['Fleet Manager','Insurance Manager'], '{}'::jsonb, 'total_loss', true),
  ('00000000-0000-0000-0000-000000000001','duplicate', null,
    array['Fleet / PMV'], array['Fleet Supervisor'], '{}'::jsonb, 'administrative', true),
  ('00000000-0000-0000-0000-000000000001','reopened', null,
    array['Fleet / PMV'], array['Fleet Manager'], '{}'::jsonb, 'administrative', true),
  ('00000000-0000-0000-0000-000000000001','legal_dispute', null,
    array['Legal','Insurance','Fleet / PMV'], array['Fleet Manager','Insurance Manager'], '{}'::jsonb, 'legal', true)
on conflict (organisation_id, accident_type) do nothing;

-- =============================================================================
-- PART 4 - accident_sla_definitions - ENRICH 02's 11 base timers
--   02 PART F already seeds these 11 sla_keys with canonical workstream_key, name,
--   activity, target_minutes, business_hours and responsible_team. This file only
--   ADDS the responsible_role each row should own (02 leaves it NULL); warning_pct
--   and escalation_pct already default to 80/100. It deliberately does NOT re-set
--   workstream_key - 02's canonical keys (insurance/assessment/repair/handover/
--   finance) are authoritative, so no non-canonical SLA workstream_key is written.
--   sla_key values below are 02's row identifiers (the join key), not workstream
--   tokens. Idempotent.
-- =============================================================================
update public.accident_sla_definitions t
   set responsible_role = v.responsible_role
from (values
  ('initial_registration'::text, 'Fleet Incident Officer'),
  ('fleet_validation',           'Fleet Supervisor'),
  ('insurance_review',           'Insurance Claims Officer'),
  ('claim_submission',           'Insurance Claims Officer'),
  ('workshop_inspection',        'Workshop Planner'),
  ('repair_estimate',            'Workshop Planner'),
  ('repair_decision',            'Fleet Manager'),
  ('po_after_approval',          'Procurement Officer'),
  ('fleet_inspection',           'Fleet Inspector'),
  ('rectification_plan',         'Workshop Supervisor'),
  ('closure_review',             'Fleet Manager')
) as v(sla_key, responsible_role)
where t.organisation_id = '00000000-0000-0000-0000-000000000001'
  and t.sla_key = v.sla_key;

-- =============================================================================
-- PART 5 - accident_evidence_requirements (photo/document checklist, brief 7/10)
--   No unique constraint on this table in V417 -> INSERT ... SELECT ... WHERE NOT
--   EXISTS keyed on (org, requirement_key, route_key, accident_type) for idempotency.
--   13 global mandatory photos + 8 scoped + 3 document/video rows.
-- =============================================================================
insert into public.accident_evidence_requirements (
  organisation_id, route_key, accident_type, requirement_key, label, category, kind, mandatory, sort_order, active)
select o.org, v.route_key, v.accident_type, v.requirement_key, v.label, v.category, v.kind, v.mandatory, v.sort_order, true
from (values
  -- global mandatory photos (route_key NULL, accident_type NULL) = every case
  (null::text, null::text, 'photo_full_front',        'Full front view',          'exterior', 'photo',    true,  10),
  (null,       null,       'photo_full_rear',         'Full rear view',           'exterior', 'photo',    true,  20),
  (null,       null,       'photo_left_side',         'Left side',                'exterior', 'photo',    true,  30),
  (null,       null,       'photo_right_side',        'Right side',               'exterior', 'photo',    true,  40),
  (null,       null,       'photo_front_left_corner', 'Front-left corner',        'corner',   'photo',    true,  50),
  (null,       null,       'photo_front_right_corner','Front-right corner',       'corner',   'photo',    true,  60),
  (null,       null,       'photo_rear_left_corner',  'Rear-left corner',         'corner',   'photo',    true,  70),
  (null,       null,       'photo_rear_right_corner', 'Rear-right corner',        'corner',   'photo',    true,  80),
  (null,       null,       'photo_damage_closeup',    'Close-up damage',          'damage',   'photo',    true,  90),
  (null,       null,       'photo_scene',             'Accident scene',           'scene',    'photo',    true, 100),
  (null,       null,       'photo_plate',             'Vehicle plate',            'identity', 'photo',    true, 110),
  (null,       null,       'photo_odometer',          'Odometer / hour meter',    'identity', 'photo',    true, 120),
  (null,       null,       'photo_dashboard_lights',  'Dashboard warning lights', 'condition','photo',    true, 130),
  -- scoped mandatory (route- or type-specific)
  ('third_party', null,    'photo_other_party_vehicle','Other-party vehicle',     'third_party','photo',  true, 140),
  ('third_party', null,    'photo_other_party_plate', 'Other-party plate',        'third_party','photo',  true, 150),
  ('injury',      null,    'photo_road_condition',    'Road / site condition',    'scene',    'photo',    true, 160),
  (null, 'tyre_wheel',     'photo_tyres_wheels',      'Tyres and wheels',         'damage',   'photo',    true, 170),
  (null, 'total_loss',     'photo_chassis_vin',       'Chassis / VIN',            'identity', 'photo',    true, 180),
  (null, 'third_party_property','photo_property_damage','Property damage',        'third_party','photo',  true, 190),
  (null, 'equipment_to_vehicle','photo_equipment_attachment','Equipment attachment','condition','photo',  true, 200),
  (null, 'theft',          'photo_chassis_vin_theft', 'Chassis / VIN',            'identity', 'photo',    true, 210),
  -- global documents / video (mandatory-ness is country/route conditional -> false here)
  (null,       null,       'doc_authority_report',    'Authority / police report','authority','document', false, 300),
  (null,       null,       'doc_driver_statement',    'Driver statement',         'statement','document', false, 310),
  (null,       null,       'video_walkaround',        'Vehicle walk-around video','condition','video',    false, 320)
) as v(route_key, accident_type, requirement_key, label, category, kind, mandatory, sort_order)
cross join (select '00000000-0000-0000-0000-000000000001'::uuid as org) o
where not exists (
  select 1 from public.accident_evidence_requirements e
  where e.organisation_id = o.org
    and e.requirement_key = v.requirement_key
    and coalesce(e.route_key,'')     = coalesce(v.route_key,'')
    and coalesce(e.accident_type,'') = coalesce(v.accident_type,'')
);

-- =============================================================================
-- PART 6 - accident_email_templates (7 NEW [TP-ACC-...] trigger templates, brief 9/13)
--   Extends the 15 existing templates (untouched). active/approved=true to match
--   siblings, but INERT until a trigger references the key AND the resolver emits the
--   new tokens ({{case_no}} {{liability}} {{owner}} {{missing_docs}} {{latest_decision}}).
-- =============================================================================
insert into public.accident_email_templates (organisation_id, key, name, subject, body_html, active, approved) values
  ('00000000-0000-0000-0000-000000000001','workstream_assigned','Workstream assigned',
   '[{{case_no}}] [Assigned] {{pending_action}} | Asset {{asset_no}}',
   '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">'
   '<p>A workstream on accident case <strong>{{case_no}}</strong> has been assigned to you.</p>'
   '<table cellpadding="4" style="border-collapse:collapse">'
   '<tr><td><strong>Case</strong></td><td>{{case_no}} (ref {{reference_no}})</td></tr>'
   '<tr><td><strong>Asset / Plate</strong></td><td>{{asset_no}} / {{plate_number}}</td></tr>'
   '<tr><td><strong>Project / Site</strong></td><td>{{site}}</td></tr>'
   '<tr><td><strong>Accident date</strong></td><td>{{incident_date}}</td></tr>'
   '<tr><td><strong>Current stage</strong></td><td>{{stage_label}}</td></tr>'
   '<tr><td><strong>Liability</strong></td><td>{{liability}}</td></tr>'
   '<tr><td><strong>Vehicle condition</strong></td><td>{{vor_label}}</td></tr>'
   '<tr><td><strong>Required action</strong></td><td>{{pending_action}}</td></tr>'
   '<tr><td><strong>Responsible person</strong></td><td>{{owner}}</td></tr>'
   '<tr><td><strong>Due date</strong></td><td>{{due_date}}</td></tr>'
   '<tr><td><strong>Missing documents</strong></td><td>{{missing_docs}}</td></tr>'
   '<tr><td><strong>Latest decision</strong></td><td>{{latest_decision}}</td></tr>'
   '</table><p><a href="{{link}}">Open the case in {{company}}</a></p>'
   '<p style="color:#666;font-size:12px">This notification is a pointer. The official record stays inside {{company}}.</p></div>',
   true, true),

  ('00000000-0000-0000-0000-000000000001','approval_required','Approval required',
   '[{{case_no}}] [Approval Required] {{pending_action}} | Asset {{asset_no}}',
   '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">'
   '<p>Your approval is required on accident case <strong>{{case_no}}</strong>.</p>'
   '<table cellpadding="4" style="border-collapse:collapse">'
   '<tr><td><strong>Case</strong></td><td>{{case_no}} (ref {{reference_no}})</td></tr>'
   '<tr><td><strong>Asset / Plate</strong></td><td>{{asset_no}} / {{plate_number}}</td></tr>'
   '<tr><td><strong>Project / Site</strong></td><td>{{site}}</td></tr>'
   '<tr><td><strong>Accident date</strong></td><td>{{incident_date}}</td></tr>'
   '<tr><td><strong>Current stage</strong></td><td>{{stage_label}}</td></tr>'
   '<tr><td><strong>Liability</strong></td><td>{{liability}}</td></tr>'
   '<tr><td><strong>Approval needed for</strong></td><td>{{pending_action}}</td></tr>'
   '<tr><td><strong>Estimated cost</strong></td><td>{{estimated_cost}}</td></tr>'
   '<tr><td><strong>Due date</strong></td><td>{{due_date}}</td></tr>'
   '<tr><td><strong>Latest decision</strong></td><td>{{latest_decision}}</td></tr>'
   '</table><p><a href="{{link}}">Review and approve in {{company}}</a></p>'
   '<p style="color:#666;font-size:12px">Approve or reject inside {{company}} - do not reply to approve.</p></div>',
   true, true),

  ('00000000-0000-0000-0000-000000000001','claim_registered','Insurance claim registered',
   '[{{case_no}}] [Claim Registered] Insurance claim {{claim_status}} | Asset {{asset_no}}',
   '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">'
   '<p>An insurance claim has been registered for accident case <strong>{{case_no}}</strong>.</p>'
   '<table cellpadding="4" style="border-collapse:collapse">'
   '<tr><td><strong>Case</strong></td><td>{{case_no}} (ref {{reference_no}})</td></tr>'
   '<tr><td><strong>Asset / Plate</strong></td><td>{{asset_no}} / {{plate_number}}</td></tr>'
   '<tr><td><strong>Project / Site</strong></td><td>{{site}}</td></tr>'
   '<tr><td><strong>Accident date</strong></td><td>{{incident_date}}</td></tr>'
   '<tr><td><strong>Claim status</strong></td><td>{{claim_status}}</td></tr>'
   '<tr><td><strong>Liability</strong></td><td>{{liability}}</td></tr>'
   '<tr><td><strong>Current stage</strong></td><td>{{stage_label}}</td></tr>'
   '<tr><td><strong>Missing documents</strong></td><td>{{missing_docs}}</td></tr>'
   '<tr><td><strong>Latest decision</strong></td><td>{{latest_decision}}</td></tr>'
   '</table><p><a href="{{link}}">Open the case in {{company}}</a></p></div>',
   true, true),

  ('00000000-0000-0000-0000-000000000001','vehicle_ready','Vehicle ready for Fleet inspection',
   '[{{case_no}}] [Vehicle Ready] Fleet inspection required | Asset {{asset_no}}',
   '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">'
   '<p>Repair is complete and workshop QC has passed. The vehicle on case <strong>{{case_no}}</strong> is ready for Fleet inspection.</p>'
   '<table cellpadding="4" style="border-collapse:collapse">'
   '<tr><td><strong>Case</strong></td><td>{{case_no}} (ref {{reference_no}})</td></tr>'
   '<tr><td><strong>Asset / Plate</strong></td><td>{{asset_no}} / {{plate_number}}</td></tr>'
   '<tr><td><strong>Project / Site</strong></td><td>{{site}}</td></tr>'
   '<tr><td><strong>Current stage</strong></td><td>{{stage_label}}</td></tr>'
   '<tr><td><strong>Required action</strong></td><td>{{pending_action}}</td></tr>'
   '<tr><td><strong>Responsible person</strong></td><td>{{owner}}</td></tr>'
   '<tr><td><strong>Due date</strong></td><td>{{due_date}}</td></tr>'
   '</table><p><a href="{{link}}">Inspect and accept/reject in {{company}}</a></p>'
   '<p style="color:#666;font-size:12px">Workshop completion is not case closure - Fleet acceptance is required.</p></div>',
   true, true),

  ('00000000-0000-0000-0000-000000000001','handover_rejected','Repair rejected by Fleet',
   '[{{case_no}}] [Repair Rejected] Rectification required | Asset {{asset_no}}',
   '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">'
   '<p>Fleet has rejected the repair on case <strong>{{case_no}}</strong>. Rectification is required.</p>'
   '<table cellpadding="4" style="border-collapse:collapse">'
   '<tr><td><strong>Case</strong></td><td>{{case_no}} (ref {{reference_no}})</td></tr>'
   '<tr><td><strong>Asset / Plate</strong></td><td>{{asset_no}} / {{plate_number}}</td></tr>'
   '<tr><td><strong>Project / Site</strong></td><td>{{site}}</td></tr>'
   '<tr><td><strong>Current stage</strong></td><td>{{stage_label}}</td></tr>'
   '<tr><td><strong>Required action</strong></td><td>{{pending_action}}</td></tr>'
   '<tr><td><strong>Responsible person</strong></td><td>{{owner}}</td></tr>'
   '<tr><td><strong>Due date</strong></td><td>{{due_date}}</td></tr>'
   '<tr><td><strong>Rejection remarks</strong></td><td>{{latest_decision}}</td></tr>'
   '</table><p><a href="{{link}}">Open the rectification task in {{company}}</a></p></div>',
   true, true),

  ('00000000-0000-0000-0000-000000000001','settlement_overdue','Settlement overdue',
   '[{{case_no}}] [Settlement Overdue] Insurance settlement pending | Asset {{asset_no}}',
   '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">'
   '<p>The insurance settlement on case <strong>{{case_no}}</strong> is overdue.</p>'
   '<table cellpadding="4" style="border-collapse:collapse">'
   '<tr><td><strong>Case</strong></td><td>{{case_no}} (ref {{reference_no}})</td></tr>'
   '<tr><td><strong>Asset / Plate</strong></td><td>{{asset_no}} / {{plate_number}}</td></tr>'
   '<tr><td><strong>Project / Site</strong></td><td>{{site}}</td></tr>'
   '<tr><td><strong>Claim status</strong></td><td>{{claim_status}}</td></tr>'
   '<tr><td><strong>Approved amount</strong></td><td>{{approved_cost}}</td></tr>'
   '<tr><td><strong>Due date</strong></td><td>{{due_date}}</td></tr>'
   '<tr><td><strong>Responsible person</strong></td><td>{{owner}}</td></tr>'
   '<tr><td><strong>Latest decision</strong></td><td>{{latest_decision}}</td></tr>'
   '</table><p><a href="{{link}}">Chase the settlement in {{company}}</a></p></div>',
   true, true),

  ('00000000-0000-0000-0000-000000000001','ready_for_closure','Case ready for closure',
   '[{{case_no}}] [Ready for Closure] Final approval required | Asset {{asset_no}}',
   '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">'
   '<p>All required workstreams on case <strong>{{case_no}}</strong> are complete. Final closure approval is required.</p>'
   '<table cellpadding="4" style="border-collapse:collapse">'
   '<tr><td><strong>Case</strong></td><td>{{case_no}} (ref {{reference_no}})</td></tr>'
   '<tr><td><strong>Asset / Plate</strong></td><td>{{asset_no}} / {{plate_number}}</td></tr>'
   '<tr><td><strong>Project / Site</strong></td><td>{{site}}</td></tr>'
   '<tr><td><strong>Accident date</strong></td><td>{{incident_date}}</td></tr>'
   '<tr><td><strong>Liability</strong></td><td>{{liability}}</td></tr>'
   '<tr><td><strong>Current stage</strong></td><td>{{stage_label}}</td></tr>'
   '<tr><td><strong>Required action</strong></td><td>{{pending_action}}</td></tr>'
   '<tr><td><strong>Missing documents</strong></td><td>{{missing_docs}}</td></tr>'
   '<tr><td><strong>Latest decision</strong></td><td>{{latest_decision}}</td></tr>'
   '</table><p><a href="{{link}}">Review and close in {{company}}</a></p></div>',
   true, true)
on conflict (organisation_id, key) do nothing;

commit;

-- =============================================================================
-- ROLLBACK (commented - review artifact only). This file is EXTENSION-ONLY, so its
-- rollback deletes ONLY the rows this file inserts (the 6 extra route profiles, the
-- 31 type profiles, the evidence requirements and the 7 email templates). The
-- country / SLA / 4-base-route rows are OWNED by 02 PART F - do NOT delete them
-- here; 02's own ROLLBACK block removes them. This file's enrichment UPDATEs only
-- populated columns 02 leaves at their default (route required_evidence /
-- required_documents / closure_requirements, country required_documents / notes, SLA
-- responsible_role); to undo them, reset those columns to their defaults (or let
-- 02's rollback drop the rows entirely).
-- =============================================================================
-- begin;
--   delete from public.accident_email_templates
--    where organisation_id = '00000000-0000-0000-0000-000000000001'
--      and key in ('workstream_assigned','approval_required','claim_registered','vehicle_ready',
--                  'handover_rejected','settlement_overdue','ready_for_closure');
--
--   delete from public.accident_evidence_requirements
--    where organisation_id = '00000000-0000-0000-0000-000000000001'
--      and requirement_key in (
--        'photo_full_front','photo_full_rear','photo_left_side','photo_right_side',
--        'photo_front_left_corner','photo_front_right_corner','photo_rear_left_corner',
--        'photo_rear_right_corner','photo_damage_closeup','photo_scene','photo_plate',
--        'photo_odometer','photo_dashboard_lights','photo_other_party_vehicle',
--        'photo_other_party_plate','photo_road_condition','photo_tyres_wheels',
--        'photo_chassis_vin','photo_property_damage','photo_equipment_attachment',
--        'photo_chassis_vin_theft','doc_authority_report','doc_driver_statement','video_walkaround');
--
--   delete from public.accident_type_profiles
--    where organisation_id = '00000000-0000-0000-0000-000000000001'
--      and accident_type in (
--        'minor_road','major_road','site_collision','vehicle_to_vehicle','equipment_to_vehicle',
--        'equipment_to_equipment','third_party_property','customer_property','own_damage','injury',
--        'fatal','hit_and_run','theft','fire','weather','glass_only','tyre_wheel','rollover',
--        'loading_unloading','falling_object','uninsured','expired_policy','rental_vehicle',
--        'leased_vehicle','subcontractor_vehicle','no_damage','near_miss','total_loss',
--        'duplicate','reopened','legal_dispute');
--
--   -- Only the 6 EXTRA routes this file inserts (02 owns the other 4).
--   delete from public.accident_route_profiles
--    where organisation_id = '00000000-0000-0000-0000-000000000001'
--      and route_key in ('internal_repair_insurance','third_party','hit_and_run',
--                        'glass_only','no_damage','theft_fire_weather');
--
--   -- accident_sla_definitions and accident_country_rule_profiles rows are owned by
--   -- 02 PART F; this file only enriched their columns, so nothing is deleted here.
-- commit;
-- =============================================================================
