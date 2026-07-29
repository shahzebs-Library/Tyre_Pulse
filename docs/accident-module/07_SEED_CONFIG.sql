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
-- DESIGN NOTES
--   * required_workstreams[] uses the 12-key accident_case_workstreams.workstream_key
--     CHECK vocabulary so route-instantiated workstream rows pass that CHECK. The
--     workflow doc's short names (liability/insurance/assessment/repair/handover/
--     finance/corrective) are the logical view only. Corrective actions have no
--     workstream key - they are a CLOSURE REQUIREMENT ('corrective_actions').
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
--   Adds rows only, for Company A only. Never updates/deletes existing config (the 15
--   email templates, 7 routing rules and 12 departments are untouched).
--
-- ROLLBACK
--   See the commented ROLLBACK block at the very bottom.
-- =============================================================================

begin;

-- Company A (single live tenant). Every statement below scopes to this org.
-- org = '00000000-0000-0000-0000-000000000001'

-- =============================================================================
-- PART 1 - accident_country_rule_profiles (KSA / UAE / Egypt)
--   Only KSA carries regulatory day-count windows (brief 5C). UAE/Egypt = NULL.
-- =============================================================================
insert into public.accident_country_rule_profiles (
  organisation_id, country, currency, authority_types, required_documents,
  regulatory_missing_docs_days, regulatory_decision_days, regulatory_settlement_days,
  working_days, holidays, notes, active
) values
  ('00000000-0000-0000-0000-000000000001', 'KSA', 'SAR',
   array['Najm','Traffic Police','Police','Absher e-Report','Civil Defence','Site Security','Other'],
   array['authority_report','najm_report','driving_license','vehicle_registration','insurance_policy','driver_statement'],
   9, 5, 45,
   array['Sun','Mon','Tue','Wed','Thu'], '[]'::jsonb,
   'KSA regulator: Insurance Authority (since Nov 2023). Windows 9/5/45 are the unified compulsory motor policy maxima for a juristic person (brief 5C) and are configurable controls - comprehensive/contractual policies may differ. Najm = official accident reporting; Absher = electronic minor-accident reporting. working_days/holidays are configurable defaults - confirm locally; holidays load per country.',
   true),
  ('00000000-0000-0000-0000-000000000001', 'UAE', 'AED',
   array['Traffic Police','Police','Civil Defence','Site Security','Other'],
   array['authority_report','police_report','driving_license','vehicle_registration','insurance_policy','driver_statement'],
   null, null, null,
   array['Mon','Tue','Wed','Thu','Fri'], '[]'::jsonb,
   'UAE regulatory windows not specified in the brief - left NULL, configure locally. Authority list uses the brief generic categories (Najm excluded - KSA-specific). working_days/holidays are configurable defaults - confirm locally.',
   true),
  ('00000000-0000-0000-0000-000000000001', 'Egypt', 'EGP',
   array['Traffic Police','Police','Civil Defence','Site Security','Other'],
   array['authority_report','police_report','driving_license','vehicle_registration','insurance_policy','driver_statement'],
   null, null, null,
   array['Sun','Mon','Tue','Wed','Thu'], '[]'::jsonb,
   'Egypt regulatory windows not specified in the brief - left NULL, configure locally. Authority list uses the brief generic categories (Najm excluded - KSA-specific). working_days/holidays are configurable defaults - confirm locally.',
   true)
on conflict (organisation_id, country) do nothing;

-- =============================================================================
-- PART 2 - accident_route_profiles (10 routes)
--   required_workstreams[] uses the 12-key CHECK vocabulary. is_default = the
--   deterministic fallback route when no rule/type matches (minor_no_insurance).
-- =============================================================================
insert into public.accident_route_profiles (
  organisation_id, route_key, name, description,
  match_types, required_workstreams, required_evidence, required_documents,
  closure_requirements, is_default, active
) values
  ('00000000-0000-0000-0000-000000000001', 'minor_no_insurance',
   'Minor accident without insurance',
   'Minor own-damage repaired internally, no insurance claim (brief 4/9).',
   array['minor_road','own_damage','tyre_wheel'],
   array['incident_evidence','fleet_validation','liability_safety','technical_assessment','repair_decision','repair_planning','repair_execution','fleet_handover','finance_settlement'],
   array['photo_full_front','photo_full_rear','photo_left_side','photo_right_side','photo_damage_closeup','photo_scene','photo_plate','photo_odometer'],
   array['driver_statement'],
   array['incident_evidence','fleet_validation','liability_safety','technical_assessment','repair_route','fleet_handover','finance_settlement','corrective_actions','closure_review'],
   true, true),

  ('00000000-0000-0000-0000-000000000001', 'internal_repair_insurance',
   'Internal repair with insurance',
   'Insured case repaired in the internal workshop (brief 4/9).',
   array['site_collision','equipment_to_vehicle','equipment_to_equipment','loading_unloading','falling_object'],
   array['incident_evidence','fleet_validation','liability_safety','insurance_claim','technical_assessment','repair_decision','repair_planning','repair_execution','workshop_qc','fleet_handover','finance_settlement'],
   array['photo_full_front','photo_full_rear','photo_left_side','photo_right_side','photo_damage_closeup','photo_scene','photo_plate','photo_odometer','photo_dashboard_lights'],
   array['insurance_policy','insurer_ack','driver_statement'],
   array['incident_evidence','fleet_validation','liability_safety','insurance_claim','technical_assessment','repair_route','workshop_qc','fleet_handover','finance_settlement','insurance_settlement','corrective_actions','closure_review'],
   false, true),

  ('00000000-0000-0000-0000-000000000001', 'external_repair_insurance',
   'External repair with insurance',
   'Insured case repaired at an external / insurer-approved workshop with PO (brief 4/9).',
   array['major_road','rollover','rental_vehicle','leased_vehicle'],
   array['incident_evidence','fleet_validation','liability_safety','insurance_claim','technical_assessment','repair_decision','repair_planning','fleet_offroad','repair_execution','workshop_qc','fleet_handover','finance_settlement'],
   array['photo_full_front','photo_full_rear','photo_left_side','photo_right_side','photo_front_left_corner','photo_front_right_corner','photo_rear_left_corner','photo_rear_right_corner','photo_damage_closeup','photo_scene','photo_plate','photo_odometer','photo_dashboard_lights'],
   array['insurance_policy','insurer_ack','quotation','purchase_order','invoice','driver_statement'],
   array['incident_evidence','fleet_validation','liability_safety','insurance_claim','technical_assessment','repair_route','workshop_qc','fleet_handover','finance_settlement','insurance_settlement','corrective_actions','closure_review'],
   false, true),

  ('00000000-0000-0000-0000-000000000001', 'total_loss',
   'Total loss',
   'Economic or technical total loss - disposal/transfer + asset register update (brief 4/9).',
   array['total_loss'],
   array['incident_evidence','fleet_validation','liability_safety','insurance_claim','technical_assessment','repair_decision','finance_settlement'],
   array['photo_full_front','photo_full_rear','photo_left_side','photo_right_side','photo_damage_closeup','photo_scene','photo_plate','photo_chassis_vin'],
   array['insurance_policy','survey_report','insurer_ack'],
   array['incident_evidence','fleet_validation','liability_safety','insurance_claim','technical_assessment','total_loss_approval','asset_register_update','insurance_settlement','finance_settlement','closure_review'],
   false, true),

  ('00000000-0000-0000-0000-000000000001', 'injury',
   'Injury accident',
   'Injury/fatality - HSE investigation, medical, management + legal review where required (brief 4/9).',
   array['injury','fatal'],
   array['incident_evidence','fleet_validation','liability_safety','insurance_claim','technical_assessment','repair_decision','repair_planning','repair_execution','workshop_qc','fleet_handover','finance_settlement'],
   array['photo_full_front','photo_full_rear','photo_left_side','photo_right_side','photo_damage_closeup','photo_scene','photo_plate','photo_road_condition','photo_dashboard_lights'],
   array['authority_report','medical_report','driver_statement'],
   array['incident_evidence','fleet_validation','liability_safety','hse_investigation','injury_details','insurance_claim','technical_assessment','repair_route','fleet_handover','finance_settlement','management_review','corrective_actions','legal_review','closure_review'],
   false, true),

  ('00000000-0000-0000-0000-000000000001', 'third_party',
   'Third-party damage',
   'Third-party involvement with recovery tracking (brief 14).',
   array['vehicle_to_vehicle','third_party_property','customer_property','subcontractor_vehicle'],
   array['incident_evidence','fleet_validation','liability_safety','insurance_claim','technical_assessment','repair_decision','repair_planning','fleet_offroad','repair_execution','workshop_qc','fleet_handover','finance_settlement'],
   array['photo_full_front','photo_full_rear','photo_left_side','photo_right_side','photo_damage_closeup','photo_scene','photo_plate','photo_other_party_vehicle','photo_other_party_plate'],
   array['authority_report','insurance_policy','driver_statement'],
   array['incident_evidence','fleet_validation','liability_safety','insurance_claim','technical_assessment','repair_route','workshop_qc','fleet_handover','finance_settlement','third_party_recovery','insurance_settlement','closure_review'],
   false, true),

  ('00000000-0000-0000-0000-000000000001', 'hit_and_run',
   'Hit and run',
   'Unknown third party - authority report required, no third-party recovery (brief 14).',
   array['hit_and_run'],
   array['incident_evidence','fleet_validation','liability_safety','insurance_claim','technical_assessment','repair_decision','repair_planning','repair_execution','workshop_qc','fleet_handover','finance_settlement'],
   array['photo_full_front','photo_full_rear','photo_left_side','photo_right_side','photo_damage_closeup','photo_scene','photo_plate','photo_odometer'],
   array['authority_report','police_report','driver_statement'],
   array['incident_evidence','fleet_validation','liability_safety','insurance_claim','technical_assessment','repair_route','workshop_qc','fleet_handover','finance_settlement','insurance_settlement','closure_review'],
   false, true),

  ('00000000-0000-0000-0000-000000000001', 'glass_only',
   'Glass-only damage',
   'Windscreen/glass only - lite liability, optional insurance (brief 14).',
   array['glass_only'],
   array['incident_evidence','liability_safety','repair_decision','repair_execution','finance_settlement'],
   array['photo_damage_closeup','photo_plate','photo_odometer'],
   array[]::text[],
   array['incident_evidence','liability_safety','repair_route','finance_settlement','closure_review'],
   false, true),

  ('00000000-0000-0000-0000-000000000001', 'no_damage',
   'No-damage / near miss',
   'No-damage incident or near miss - evidence + liability + corrective, no repair/finance (brief 14).',
   array['no_damage','near_miss'],
   array['incident_evidence','liability_safety'],
   array['photo_scene','photo_plate'],
   array[]::text[],
   array['incident_evidence','liability_safety','corrective_actions','closure_review'],
   false, true),

  ('00000000-0000-0000-0000-000000000001', 'theft_fire_weather',
   'Theft / fire / weather',
   'Theft, fire or weather damage - authority report, may become total loss (brief 14).',
   array['theft','fire','weather'],
   array['incident_evidence','fleet_validation','liability_safety','insurance_claim','technical_assessment','repair_decision','finance_settlement'],
   array['photo_full_front','photo_full_rear','photo_left_side','photo_right_side','photo_damage_closeup','photo_scene','photo_plate'],
   array['authority_report','police_report','insurance_policy'],
   array['incident_evidence','fleet_validation','liability_safety','insurance_claim','technical_assessment','repair_route','finance_settlement','insurance_settlement','closure_review'],
   false, true)
on conflict (organisation_id, route_key) do nothing;

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
-- PART 4 - accident_sla_definitions (11 internal timers, brief 10/15)
--   Internal targets - deliberately much shorter than the KSA 9/5/45 working-DAY
--   regulatory maxima. business_hours=false only on the wall-clock registration timer.
--   1 business day = 480 min (8 working hours); 4 working hours = 240; 2 days = 960.
-- =============================================================================
insert into public.accident_sla_definitions (
  organisation_id, sla_key, name, activity, workstream_key,
  target_minutes, business_hours, warning_pct, escalation_pct,
  responsible_role, responsible_team, active
) values
  ('00000000-0000-0000-0000-000000000001','initial_registration','Initial accident registration','Register accident + upload emergency evidence','incident_evidence',
    120, false, 80, 100, 'Fleet Incident Officer', 'Fleet / PMV', true),
  ('00000000-0000-0000-0000-000000000001','fleet_validation','Fleet validation','Review asset, driver, report and photographs','fleet_validation',
    240, true, 80, 100, 'Fleet Supervisor', 'Fleet / PMV', true),
  ('00000000-0000-0000-0000-000000000001','insurance_review','Insurance review','Determine coverage and required documents','insurance_claim',
    240, true, 80, 100, 'Insurance Claims Officer', 'Insurance', true),
  ('00000000-0000-0000-0000-000000000001','claim_submission','Submit complete claim','Register claim and submit complete documents','insurance_claim',
    480, true, 80, 100, 'Insurance Claims Officer', 'Insurance', true),
  ('00000000-0000-0000-0000-000000000001','workshop_inspection','Workshop inspection','Inspect vehicle and record damage','technical_assessment',
    480, true, 80, 100, 'Workshop Planner', 'Workshop', true),
  ('00000000-0000-0000-0000-000000000001','repair_estimate','Initial repair estimate','Prepare labour, parts and estimated cost','technical_assessment',
    960, true, 80, 100, 'Workshop Planner', 'Workshop', true),
  ('00000000-0000-0000-0000-000000000001','repair_decision','Repair-route approval','Select and approve internal/external/insurer/total-loss route','repair_decision',
    480, true, 80, 100, 'Fleet Manager', 'Fleet / PMV', true),
  ('00000000-0000-0000-0000-000000000001','po_after_approval','PO after approval','Raise PO after repair route approved','repair_planning',
    480, true, 80, 100, 'Procurement Officer', 'Procurement', true),
  ('00000000-0000-0000-0000-000000000001','fleet_inspection','Fleet inspection after repair','Inspect and accept/reject the completed vehicle','fleet_handover',
    240, true, 80, 100, 'Fleet Inspector', 'Fleet / PMV', true),
  ('00000000-0000-0000-0000-000000000001','rectification_plan','Rectification plan after rejection','Plan rework after a rejected handover','repair_execution',
    480, true, 80, 100, 'Workshop Supervisor', 'Workshop', true),
  ('00000000-0000-0000-0000-000000000001','closure_review','Final closure review','Review all workstreams and corrective actions','closure_review',
    960, true, 80, 100, 'Fleet Manager', 'Fleet / PMV', true)
on conflict (organisation_id, sla_key) do nothing;

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
-- ROLLBACK (commented - review artifact only). Deletes ONLY the seeded rows for
-- Company A by the exact key sets. Safe because these config rows are referenced
-- only by phase-later behaviour that is not yet wired.
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
--   delete from public.accident_sla_definitions
--    where organisation_id = '00000000-0000-0000-0000-000000000001'
--      and sla_key in ('initial_registration','fleet_validation','insurance_review','claim_submission',
--                      'workshop_inspection','repair_estimate','repair_decision','po_after_approval',
--                      'fleet_inspection','rectification_plan','closure_review');
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
--   delete from public.accident_route_profiles
--    where organisation_id = '00000000-0000-0000-0000-000000000001'
--      and route_key in ('minor_no_insurance','internal_repair_insurance','external_repair_insurance',
--                        'total_loss','injury','third_party','hit_and_run','glass_only','no_damage',
--                        'theft_fire_weather');
--
--   delete from public.accident_country_rule_profiles
--    where organisation_id = '00000000-0000-0000-0000-000000000001'
--      and country in ('KSA','UAE','Egypt');
-- commit;
-- =============================================================================
