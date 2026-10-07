/// The single registry of remote object names.
///
/// # Why this file exists
///
/// Artifact 06 section 1 names "one table-name registry" as the FIRST of three
/// load-bearing properties that must survive the rewrite. The React Native
/// source describes its `COMMANDS` map as "the ONLY place a table name may
/// appear on the client", and the reason is recorded in AGENTS.md rule 3:
/// scattering names across repositories is exactly how the Kotlin rebuild
/// drifted into declaring `/approvals`, `/tasks`, `/replacements`,
/// `/workshop/jobs` and `/notifications/{id}/read` - five endpoints that do not
/// exist on any server.
///
/// **A repository must not hard-code a table string.** It references a constant
/// here. If the constant is absent, the object has not been verified, and the
/// correct action is to add it to
/// `docs/flutter-migration/02-backend-table-rpc-map.md` as UNVERIFIED and stop -
/// not to type the name into a `.from(...)` call.
///
/// # What "verified" means here
///
/// Every name below is transcribed from artifact 02, which derived them by
/// scanning `mobile/lib/**` and `mobile/app/**` for `.from('<table>')` and
/// `.rpc('<name>')` in the production Expo application. They are names the live
/// database answers to today, not names anybody would like it to answer to.
///
/// # There is no application server
///
/// Artifact 02 section 1 and AGENTS.md rule 3. Every call is one of exactly
/// three things: PostgREST on a real table, a Postgres RPC that already exists,
/// or a Supabase Edge Function that already exists. There is no fourth kind and
/// no base URL to configure. That is why this file has three groups and no
/// concept of a "path".
library;

/// Tables the production mobile application reads or writes.
///
/// Transcribed from artifact 02 section 2. NOTE: that section's prose says
/// "30 tables" while its own table lists 31 rows. The 31 rows are the data; the
/// count in the sentence is an arithmetic slip in the document. This registry
/// carries all 31, plus [engineHoursLogs], which artifact 02 section 1 verifies
/// separately as a real table referenced by 20 migrations.
abstract final class SupabaseTables {
  /// Asset register. The widest-used table in the application.
  static const String vehicleFleet = 'vehicle_fleet';

  /// Tyre inspections. Carries `approval_status`, which is what makes the
  /// approvals queue a QUERY rather than an endpoint.
  static const String inspections = 'inspections';

  /// Planned inspections - what a crew is SUPPOSED to do, as opposed to
  /// [inspections], which is what they did.
  ///
  /// VERIFIED 2026-09-21 against the live database, not transcribed from an
  /// artifact: the table already existed, and migration
  /// `20260921074351_inspection_plan_adherence.sql` (applied and recorded in
  /// `supabase_migrations`) added `assigned_to`, `team`, `plan_ref` and
  /// `grace_days` to it. 244 real plans were loaded under
  /// `plan_ref = 'PLAN-20260921-BACKLOG-KSA'`. RLS was read directly: SELECT is
  /// open to any approved member and then narrowed by RESTRICTIVE org and
  /// country isolation, so a plain `.eq('assigned_to', me)` read is already
  /// scoped to this user's own tenant without the client asserting anything.
  ///
  /// Adherence (done / missed / due) is DERIVED server-side by
  /// `get_schedule_adherence()` and is deliberately NOT stored on this table -
  /// a stored state goes stale the moment an inspection lands. The phone reads
  /// the plan rows and computes the same states locally through
  /// `InspectionPlanState`, which is a MIRROR of that SQL.
  static const String inspectionSchedules = 'inspection_schedules';

  static const String accidents = 'accidents';

  /// User profile. `country` and `sites` are `text[]`, NOT scalars - the type
  /// mistake that broke login in the Kotlin rebuild. See
  /// `lib/core/workspace/workspace_scope.dart`.
  static const String profiles = 'profiles';

  /// Tyre lifecycle rows. A "replacement" is a write here plus a
  /// [tyreStatusMarks] row, never a `POST /replacements`.
  static const String tyreRecords = 'tyre_records';

  static const String correctiveActions = 'corrective_actions';
  static const String sites = 'sites';
  static const String alerts = 'alerts';
  static const String notifications = 'notifications';

  /// Checklist submissions. Also carries `approval_status`.
  static const String checklistSubmissions = 'checklist_submissions';

  /// The approver's own saved signature. Its own table, not a column on
  /// [profiles], because every colleague can read every profile row.
  static const String userSignatures = 'user_signatures';

  static const String workOrders = 'work_orders';

  /// Workshop activity log. The real table behind the fabricated
  /// `GET workshop_events`.
  static const String techActivityEvents = 'tech_activity_events';

  static const String stockRecords = 'stock_records';
  static const String pmPrograms = 'pm_programs';
  static const String pendingUploads = 'pending_uploads';
  static const String odometerLogs = 'odometer_logs';
  static const String checklistTemplates = 'checklist_templates';

  /// The real table behind the fabricated `GET tasks`.
  static const String woTasks = 'wo_tasks';

  static const String woAssignments = 'wo_assignments';
  static const String washRecords = 'wash_records';
  static const String userAccessGrants = 'user_access_grants';
  static const String tyreStatusMarks = 'tyre_status_marks';
  static const String systemConfig = 'system_config';
  static const String stockMovements = 'stock_movements';
  static const String rcaRecords = 'rca_records';
  static const String checklistAssignments = 'checklist_assignments';

  /// In-app account deletion request. A Play Store requirement.
  static const String accountDeletionRequests = 'account_deletion_requests';

  static const String accidentRemarks = 'accident_remarks';
  static const String accidentParts = 'accident_parts';
  static const String accidentCaseWorkstreams = 'accident_case_workstreams';

  /// Live schema/RLS verified; docs/accident-module/02_DATA_MODEL.sql and 14_INSURANCE.sql.
  static const String accidentInsuranceClaims = 'accident_insurance_claims';

  /// Live since V417 (docs/accident-module/02_DATA_MODEL.sql). The vendor
  /// contact columns on this table come from the 2026-09-16 parity migration,
  /// which is AUTHORED, NOT APPLIED - a reader must catch a schema mismatch.
  static const String accidentRepairOrders = 'accident_repair_orders';

  /// Live since V417. The legacy accepted/rejected handover decision.
  static const String accidentHandoverInspections =
      'accident_handover_inspections';

  /// Live since V417 (12_SLA_ENGINE.sql).
  static const String accidentSlaInstances = 'accident_sla_instances';

  /// Live since V417 (11_NOTIFICATIONS.sql). Notes, emails and calls on a case.
  static const String accidentCaseCommunications =
      'accident_case_communications';

  /// Live since V417 (13_EVIDENCE.sql).
  static const String accidentEvidence = 'accident_evidence';

  /// AUTHORED, NOT APPLIED: `supabase/migrations/20260916130000_accident_mock_
  /// field_parity.sql`. One row per dispatch leg. Every reader of this table
  /// must treat a 42P01 as "not provisioned yet", never as an empty leg.
  static const String accidentDispatches = 'accident_dispatches';

  /// Live since V417 (14_INSURANCE.sql / 15_REPAIR_FINANCE.sql /
  /// 02_DATA_MODEL.sql). Read by the mock M4/M5 workspaces. Columns the
  /// 2026-09-16 parity migration adds are read defensively.
  static const String accidentClaimRecoveries = 'accident_claim_recoveries';
  static const String accidentLiabilityAssessments =
      'accident_liability_assessments';
  static const String accidentDamageAssessments = 'accident_damage_assessments';

  /// VERIFIED real (artifact 02 section 1: referenced by 20 migrations) and
  /// carried by the `ENGINE_HOURS_LOG` offline command in artifact 06 section
  /// 2. Listed apart from the block above only because artifact 02's call-site
  /// scan did not surface it.
  static const String engineHoursLogs = 'engine_hours_logs';

  /// Request For Repair (RFR). Created by V608 (`repair_requests`,
  /// `next_rfr_no`, `convert_repair_request_to_job_card`) and verified live on
  /// 2026-09-28. The Kotlin rebuild declared this name before the table
  /// existed, which is why it used to sit in [knownFabrications].
  static const String repairRequests = 'repair_requests';

  /// Daily Ops -> Workshop Status: one row per vehicle in the workshop's daily
  /// Excel report. RLS scopes reads by org, country, site and the module's
  /// `view` permission. Never written directly: the only writer from the phone
  /// is [SupabaseRpcs.workshopStatusUpdateRecord].
  static const String workshopStatusRecords = 'workshop_status_records';

  /// Every verified table name, for a drift test.
  ///
  /// A repository that needs a name not in this set is describing an object
  /// nobody has verified. Stop and record it as UNVERIFIED.
  static const Set<String> all = <String>{
    vehicleFleet,
    inspections,
    inspectionSchedules,
    accidents,
    profiles,
    tyreRecords,
    correctiveActions,
    sites,
    alerts,
    notifications,
    checklistSubmissions,
    userSignatures,
    workOrders,
    techActivityEvents,
    stockRecords,
    pmPrograms,
    pendingUploads,
    odometerLogs,
    checklistTemplates,
    woTasks,
    woAssignments,
    washRecords,
    userAccessGrants,
    tyreStatusMarks,
    systemConfig,
    stockMovements,
    rcaRecords,
    checklistAssignments,
    accountDeletionRequests,
    accidentRemarks,
    accidentParts,
    accidentCaseWorkstreams,
    accidentInsuranceClaims,
    accidentEvidence,
    accidentHandoverInspections,
    accidentSlaInstances,
    accidentClaimRecoveries,
    accidentLiabilityAssessments,
    accidentDamageAssessments,
    accidentRepairOrders,
    accidentCaseCommunications,
    engineHoursLogs,
    repairRequests,
    workshopStatusRecords,
  };

  /// Names that were declared by the Kotlin rebuild and DO NOT EXIST.
  ///
  /// Kept as data rather than prose so a test can assert none of them ever
  /// appears in [all]. Artifact 02 section 1 checked each one against every
  /// `MIGRATIONS_V*.sql` in the repository and found no `create table`.
  static const Set<String> knownFabrications = <String>{
    'approvals',
    'tasks',
    'replacements',
    'lookup_reasons',
    'tyre_history',
    'workshop_events',
  };
}

/// Postgres functions the production mobile application calls.
///
/// Transcribed from artifact 02 section 3. Artifact 02 records an open
/// question: which of these are SECURITY DEFINER, and their exact argument
/// signatures, are UNVERIFIED. Getting an argument NAME wrong produces a 42883
/// that reads to a user as "function does not exist" - the error mapper
/// classifies that as a schema mismatch precisely so it cannot be mistaken for
/// an empty result.
abstract final class SupabaseRpcs {
  // --- Auth and access ---

  /// Pre-auth lockout probe. Anon-callable.
  static const String loginAttemptStatus = 'login_attempt_status';

  /// Records a failed attempt. Anon-callable.
  static const String recordLoginFailure = 'record_login_failure';

  /// Clears the caller's OWN counter. AUTHENTICATED only. That asymmetry is
  /// what makes the lockout real: someone who cannot sign in cannot reset it.
  static const String resetLoginAttempts = 'reset_login_attempts';

  /// Anon-safe public subset of `system_config` (never secrets). Read before
  /// sign-in for presentation such as the administrator-chosen login artwork
  /// (`mobile_login_hero`).
  static const String getPublicConfig = 'get_public_config';

  /// Asked AFTER a password sign-in succeeds: does this user's organisation
  /// require SSO (`sso_connections.enforce_sso`)? Returns jsonb
  /// `{allowed, reason}`; super admins are exempt server-side. Created by
  /// `supabase/migrations/20260924117000_access_policies.sql`; mirrors
  /// `mobile/lib/ssoPolicy.ts`.
  static const String ssoPasswordLoginCheck = 'sso_password_login_check';

  /// The caller's own per-user overrides: jsonb `{module_key: grant|revoke}`,
  /// expired rows already dropped and revoke-wins already applied (V225).
  static const String getMyAccessGrants = 'get_my_access_grants';

  /// The caller's role matrix: jsonb `{module_key: bool}` from
  /// `module_permissions`, keyed by the Title Case `profiles.role`.
  static const String getUserModulePermissions = 'get_user_module_permissions';

  static const String registerUserDevice = 'register_user_device';
  static const String revokeUserDevice = 'revoke_user_device';
  static const String setUserAccessGrant = 'set_user_access_grant';
  static const String revokeUserAccessGrant = 'revoke_user_access_grant';
  static const String adminMobileUserAction = 'admin_mobile_user_action';

  // --- Approvals ---

  /// The ONLY correct way to approve an inspection. The server derives the
  /// approver identity and refuses an unsigned approval; a direct table update
  /// bypasses both.
  static const String decideInspectionApproval = 'decide_inspection_approval';

  /// The correct path for a checklist decision, for the same reasons.
  ///
  /// Artifact 02 section 1 and artifact 06 section 4 both name it; artifact 02
  /// section 3's list of 27 omits it. Included here on the strength of the two
  /// sections that do name it.
  static const String decideChecklistApproval = 'decide_checklist_approval';

  static const String approvePendingUpload = 'approve_pending_upload';
  static const String rejectPendingUpload = 'reject_pending_upload';
  static const String restampPendingUploadCountry =
      'restamp_pending_upload_country';
  static const String approveAccidentClosure = 'approve_accident_closure';
  static const String rejectAccidentClosure = 'reject_accident_closure';

  /// Last submission for a template. Drives the interval warning.
  static const String checklistLastSubmission = 'checklist_last_submission';

  // --- Operations ---

  /// Atomic scrap: writes the mark AND the status together, so the two can
  /// never disagree. Doing it as two client writes is how a tyre ends up
  /// marked scrapped while still reading Active.
  static const String scrapTyreBySerial = 'scrap_tyre_by_serial';
  static const String unscrapTyreBySerial = 'unscrap_tyre_by_serial';

  /// Server-answered permission. The client must ASK; it must never infer the
  /// answer from a role string.
  static const String tyreScrapAllowed = 'tyre_scrap_allowed';
  static const String tyreUnscrapAllowed = 'tyre_unscrap_allowed';

  /// Atomic insert-and-advance of a preventive-maintenance schedule.
  static const String recordPmService = 'record_pm_service';

  static const String setStockCount = 'set_stock_count';
  static const String postStockMovement = 'post_stock_movement';

  /// Set-returning picker option lists. Both are subject to the 1000-row cap
  /// and must be paged BY IDENTITY - see `rpc_identity_pager.dart`.
  static const String referenceAssetOptions = 'reference_asset_options';
  static const String referenceSiteOptions = 'reference_site_options';

  /// One-row analytics aggregate. Replaced a client-side full-table scan that
  /// paged every tyre record into device memory.
  static const String getMobileAnalytics = 'get_mobile_analytics';

  /// Inspection plans in a window, each already joined to the inspection that
  /// fulfilled it, with the resulting state.
  ///
  /// VERIFIED 2026-09-21: created by migration
  /// `20260921074351_inspection_plan_adherence.sql`, SECURITY INVOKER, granted
  /// to `authenticated`, anon revoked by `20260921084516`. Signature
  /// `(p_country text, p_from date, p_to date)`.
  ///
  /// THE PHONE CALLS THIS RATHER THAN COMPUTING STATE ITSELF, and that is the
  /// whole point: done / started / missed / due is already defined ONCE in SQL
  /// `inspection_plan_state()` and mirrored ONCE in the web engine
  /// (`src/lib/schedulePlan.js`). A third copy in Dart would be a third thing
  /// to keep in step, and the matching rule it would have to reproduce (an
  /// inspection on that vehicle inside the plan's grace window) is exactly the
  /// kind of rule that drifts silently. The phone parses `plan_state`; it does
  /// not re-derive it.
  static const String getScheduleAdherence = 'get_schedule_adherence';

  // --- Problem tracking ---

  /// "Report a problem". SECURITY DEFINER: stamps reporter, company, country,
  /// site and time server-side and attaches the reporter's own recent error
  /// logs. VERIFIED 2026-09-30: created by
  /// `supabase/migrations/20260930150000_user_issues.sql`, granted to
  /// `authenticated` (anon has no EXECUTE). Signature `(p_description,
  /// p_category, p_severity, p_platform, p_app_version, p_device, p_os,
  /// p_page, p_reference_id)`, all text; returns jsonb `{ok, id,
  /// linked_logs}`. `p_platform` must be `flutter` - see
  /// `features/problem_report/domain/problem_report.dart`.
  static const String submitUserIssue = 'submit_user_issue';

  /// "Sign in on a computer": a signed-in phone approves or declines the
  /// one-time code the web sign-in page shows as a QR. VERIFIED 2026-10-04:
  /// created by `supabase/migrations/20261004121000_login_showcase_and_qr_login.sql`,
  /// SECURITY DEFINER, granted to `authenticated` only (anon revoked).
  /// Signature `(p_id uuid, p_secret text, p_approve boolean default true,
  /// p_match text default null)` (p_match since the 20261004150000 hardening);
  /// returns jsonb `{ok, status}` or `{ok:false, reason}`; raises 42501 for an
  /// unapproved or locked caller. Online only - see
  /// `features/qr_login/data/qr_login_repository.dart`.
  static const String qrLoginApprove = 'qr_login_approve';

  /// Hardened QR sign-in (`supabase/migrations/20261004150000_qr_login_hardening.sql`):
  /// the phone reads which browser is asking plus three 2-digit options
  /// before approving. Signature `(p_id uuid, p_secret text)`, authenticated
  /// only; returns jsonb `{ok:true, user_agent, ip, age_seconds, options}` or
  /// `{ok:false, reason}`. `qr_login_approve` now also takes
  /// `p_match text default null`.
  static const String qrLoginPeek = 'qr_login_peek';

  /// Workshop Status: the caller's own action flags as jsonb booleans
  /// (`view`, `update`, `assign`, ...). Read fails closed.
  static const String workshopStatusMyPermissions =
      'workshop_status_my_permissions';

  /// Workshop Status: the ONE writer (p_record_id, p_patch,
  /// p_expected_updated_at). Stale expected_updated_at raises PT409.
  static const String workshopStatusUpdateRecord =
      'workshop_status_update_record';

  static const String getReportSnapshotAuthed = 'get_report_snapshot_authed';
  static const String getAccidentAudit = 'get_accident_audit';

  /// Every verified RPC name, for a drift test.
  static const Set<String> all = <String>{
    loginAttemptStatus,
    recordLoginFailure,
    resetLoginAttempts,
    ssoPasswordLoginCheck,
    registerUserDevice,
    revokeUserDevice,
    setUserAccessGrant,
    revokeUserAccessGrant,
    adminMobileUserAction,
    decideInspectionApproval,
    decideChecklistApproval,
    approvePendingUpload,
    rejectPendingUpload,
    restampPendingUploadCountry,
    approveAccidentClosure,
    rejectAccidentClosure,
    checklistLastSubmission,
    scrapTyreBySerial,
    unscrapTyreBySerial,
    tyreScrapAllowed,
    tyreUnscrapAllowed,
    recordPmService,
    setStockCount,
    postStockMovement,
    referenceAssetOptions,
    referenceSiteOptions,
    getMobileAnalytics,
    getScheduleAdherence,
    getReportSnapshotAuthed,
    submitUserIssue,
    getAccidentAudit,
    qrLoginApprove,
    qrLoginPeek,
    workshopStatusMyPermissions,
    workshopStatusUpdateRecord,
  };

  /// Set-returning RPCs, which are capped at 1000 rows exactly as a table read
  /// is (artifact 02 section 4) and therefore must never be read unpaged.
  ///
  /// Artifact 02 also records that `get_asset_master` carries an INTERNAL
  /// limit, so a caller must raise `p_limit` as well as page. Whether any RPC
  /// here does the same is UNVERIFIED.
  static const Set<String> setReturning = <String>{
    referenceAssetOptions,
    referenceSiteOptions,

    /// Returns one row per PLAN in the requested window, so it is capped at
    /// 1000 like any other read. The phone bounds it by asking for a short
    /// window (see `InspectionPlanRepository.myPlans`) rather than paging,
    /// because one crew member's few weeks of work is tens of rows, not
    /// thousands - but the ceiling is real and the repository reports when a
    /// result touches it rather than quietly showing a short list.
    getScheduleAdherence,
  };
}

/// Supabase Edge Functions.
abstract final class SupabaseFunctions {
  /// The only edge function the mobile application invokes.
  static const String chatAi = 'chat-ai';

  static const Set<String> all = <String>{chatAi};
}
