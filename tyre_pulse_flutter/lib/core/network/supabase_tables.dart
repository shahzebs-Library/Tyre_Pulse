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

  /// VERIFIED real (artifact 02 section 1: referenced by 20 migrations) and
  /// carried by the `ENGINE_HOURS_LOG` offline command in artifact 06 section
  /// 2. Listed apart from the block above only because artifact 02's call-site
  /// scan did not surface it.
  static const String engineHoursLogs = 'engine_hours_logs';

  /// Every verified table name, for a drift test.
  ///
  /// A repository that needs a name not in this set is describing an object
  /// nobody has verified. Stop and record it as UNVERIFIED.
  static const Set<String> all = <String>{
    vehicleFleet,
    inspections,
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
    engineHoursLogs,
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
    'repair_requests',
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

  static const String getReportSnapshotAuthed = 'get_report_snapshot_authed';
  static const String getAccidentAudit = 'get_accident_audit';

  /// Every verified RPC name, for a drift test.
  static const Set<String> all = <String>{
    loginAttemptStatus,
    recordLoginFailure,
    resetLoginAttempts,
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
    getReportSnapshotAuthed,
    getAccidentAudit,
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
  };
}

/// Supabase Edge Functions.
abstract final class SupabaseFunctions {
  /// The only edge function the mobile application invokes.
  static const String chatAi = 'chat-ai';

  static const Set<String> all = <String>{chatAi};
}
