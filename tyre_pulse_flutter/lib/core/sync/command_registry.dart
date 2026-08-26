/// The one place a Supabase table name may appear for a queued offline write.
///
/// Ports `COMMANDS` from `mobile/lib/recordQueue.ts` (verified directly
/// against that file, not from memory) into a form the sync engine can
/// consume. `docs/flutter-migration/06-offline-command-registry.md` (artifact
/// 06) is the spec this file implements; section 1 names three properties of
/// the React Native design that must survive the rewrite:
///
/// A. **One table-name registry.** [CommandRegistry.specs] is the ONLY place
///    a table name may appear on the client for a queued write. A repository
///    that needs a table string for a write does not hard-code one; it looks
///    up a [CommandSpec] here. Scattering table names across repositories is
///    exactly how the Kotlin rebuild drifted into inventing endpoints that do
///    not exist on any server.
/// B. **A field allow-list per command.** [CommandSpec.fieldAllowList]
///    mirrors the RN `fields` array byte for byte, transcribed from
///    `mobile/lib/recordQueue.ts` on 2026-08-25. Anything not listed must be
///    dropped before the write - a column PostgREST cannot find fails the
///    WHOLE request, so a stray key would otherwise kill a field worker's
///    entire sync. This file only DECLARES the allow-list; enforcing it is
///    `QueuedCommandRepository`'s job (`queued_command_repository.dart`).
/// C. **Idempotency is per command and on by default.** All 14 commands here
///    are idempotent as shipped. Artifact 06 section 1 corrects an earlier
///    draft of itself that recorded `WORKSHOP_EVENT` as an exception - it is
///    not: `MIGRATIONS_V292_TECH_EVENTS_CLIENT_UUID.sql` gave
///    `tech_activity_events` a `client_uuid` column and a unique index for
///    exactly this reason, "every event is at-most-once". The RN
///    `idempotent: false` escape hatch exists in the source but no shipped
///    command uses it, so this port carries no such field at all. Reintroduce
///    one only if a genuinely append-only table with no `client_uuid` ever
///    appears.
library;

import 'package:tyre_pulse/core/network/supabase_tables.dart';

/// Every offline write this client may queue.
///
/// This is 14 of the 16 commands `mobile/lib/recordQueue.ts` defines under
/// its own `CommandType` union. Two are DELIBERATELY absent, and because this
/// is a Dart enum rather than a string union there is no way to construct a
/// [CommandSpec] for either - the exclusion is enforced by the type system,
/// not by a runtime check that could be forgotten.
///
/// - **`CHECKLIST_APPROVAL` is excluded on purpose.** Artifact 06 section 4
///   calls this "the single most important finding" in the document: an
///   approval is a DECISION, not an observation. Three reasons, all recorded
///   in PROJECT_MEMORY - a checklist's closability depends on its own
///   answers and a single blocking fault mark must refuse closure; the
///   database enforces that with a trigger AT APPROVAL TIME, so a queued
///   approval can be accepted by the phone and then refused by the server
///   hours later with nobody present to resolve the conflict; and the
///   approver's identity and permission must be re-checked server-side at
///   the moment of the write. The correct path is the
///   `decide_checklist_approval` RPC ([SupabaseRpcs.decideChecklistApproval])
///   while online, never a queued blind `update` on `checklist_submissions`.
/// - **`REPAIR_REQUEST` is excluded because it is UNVERIFIED**, not because
///   it is judged unsafe. Artifact 06 section 2 records that its table,
///   `repair_requests`, is created by
///   `MIGRATIONS_V608_REPAIR_REQUEST_RFR.sql`, which was untracked,
///   in-flight, parallel-session work at the time artifact 06 was written.
///   Add it once that migration has settled and its shape is verified
///   against the live schema - never guess a `repair_requests` column list
///   from an in-flight file.
enum CommandType {
  /// `tyre_records`, insert. Carries per-position photos. Artifact 06
  /// section 2 describes this as "widest allow-list", but measured against
  /// the live `recordQueue.ts` it is 25 fields against
  /// [reportAccident]'s 54 - see that value's own doc comment.
  tyreChange,

  /// `work_orders`, insert.
  workOrder,

  /// `rca_records`, insert.
  rca,

  /// `corrective_actions`, insert. The RN command name (`REPORT_ISSUE`) does
  /// not match its table; the table is verified, the name is not renamed
  /// here so the wire string stays identical to the shipped queue rows.
  reportIssue,

  /// `stock_records`, update matched by `id`. Safe to queue because callers
  /// always send an ABSOLUTE value (the new quantity), never a delta - see
  /// [CommandSpec.requiresOptimisticStatusMatch] for why this one is
  /// deliberately `false` while its update-command siblings are `true`.
  stockAdjust,

  /// `work_orders`, update matched by `id`. QUEUEABLE WITH CARE (artifact 06
  /// section 4): a blind patch-by-id can overwrite a decision made elsewhere
  /// while the phone was offline.
  workOrderStatus,

  /// `corrective_actions`, update matched by `id`. QUEUEABLE WITH CARE, same
  /// reason as [workOrderStatus].
  correctiveActionStatus,

  /// `checklist_submissions`, insert. Carries a photo map KEYED by field id,
  /// not a flat array - see artifact 06 section 6.
  checklistSubmission,

  /// `checklist_assignments`, update matched by `id`. QUEUEABLE WITH CARE,
  /// same reason as [workOrderStatus].
  checklistAssignmentStatus,

  /// `odometer_logs`, insert. Advances `vehicle_fleet.current_km` through a
  /// server trigger; the client never writes that column directly.
  odometerLog,

  /// `engine_hours_logs`, insert.
  engineHoursLog,

  /// `accidents`, insert. `accidents.client_uuid` exists specifically so a
  /// replayed field accident report is idempotent. Carries the widest
  /// allow-list of any command here (54 fields) - the field-parity capture
  /// added later to mirror the web incident form. See [tyreChange]'s own
  /// doc comment.
  reportAccident,

  /// `wash_records`, insert.
  washRecord,

  /// `tech_activity_events`, insert. Append-only in spirit (every tap writes
  /// one row) but still upserted on `client_uuid` since V292, so it is
  /// idempotent exactly like every other command here.
  workshopEvent,
}

/// `pending_commands.commandType` values.
///
/// Stable, auditable strings - the exact RN `CommandType` literal for the
/// same command, unchanged, so a support engineer reading a queue row on
/// either platform does not have to translate between two vocabularies.
extension CommandTypeWireName on CommandType {
  String get wireName {
    switch (this) {
      case CommandType.tyreChange:
        return 'TYRE_CHANGE';
      case CommandType.workOrder:
        return 'WORK_ORDER';
      case CommandType.rca:
        return 'RCA';
      case CommandType.reportIssue:
        return 'REPORT_ISSUE';
      case CommandType.stockAdjust:
        return 'STOCK_ADJUST';
      case CommandType.workOrderStatus:
        return 'WORK_ORDER_STATUS';
      case CommandType.correctiveActionStatus:
        return 'CORRECTIVE_ACTION_STATUS';
      case CommandType.checklistSubmission:
        return 'CHECKLIST_SUBMISSION';
      case CommandType.checklistAssignmentStatus:
        return 'CHECKLIST_ASSIGNMENT_STATUS';
      case CommandType.odometerLog:
        return 'ODOMETER_LOG';
      case CommandType.engineHoursLog:
        return 'ENGINE_HOURS_LOG';
      case CommandType.reportAccident:
        return 'REPORT_ACCIDENT';
      case CommandType.washRecord:
        return 'WASH_RECORD';
      case CommandType.workshopEvent:
        return 'WORKSHOP_EVENT';
    }
  }
}

/// How a command mutates its table.
enum CommandOperation {
  insert,
  update,
}

/// One command's shape: which table, which operation, which fields survive
/// the allow-list, and whether it needs extra care before or during the
/// push.
final class CommandSpec {
  const CommandSpec({
    required this.type,
    required this.table,
    required this.operation,
    required this.fieldAllowList,
    this.matchColumn,
    this.requiresMediaReady = false,
    this.requiresOptimisticStatusMatch = false,
  });

  final CommandType type;

  /// One of [SupabaseTables]'s constants. Never a raw string literal - if the
  /// table this command needs is not there, it has not been verified against
  /// the live schema, and the correct action is to add it there first.
  final String table;

  final CommandOperation operation;

  /// Anything not in this set is DROPPED from the payload before it is sent.
  /// A column PostgREST cannot find fails the WHOLE request.
  ///
  /// For an update command this set still contains [matchColumn] (mirroring
  /// `recordQueue.ts`'s own `fields` array, which lists its match column
  /// too). It is NOT stripped here: the repository that enqueues a command
  /// keeps the full allow-listed payload, and only the sync engine, at push
  /// time, excludes [matchColumn] from the SET clause it builds - see
  /// [matchColumn].
  final Set<String> fieldAllowList;

  /// Required when [operation] is [CommandOperation.update]. The column an
  /// update is matched by - always `'id'` for the four update commands in
  /// this registry. Excluded from the SET clause the sync engine builds at
  /// push time, so the primary key is never rewritten.
  final String? matchColumn;

  /// True for [CommandType.tyreChange] and [CommandType.checklistSubmission]:
  /// the sync engine must not push the business row until every photo
  /// attached to this command has reached `uploaded` or `verified` (checked
  /// via `MediaDao.commandMediaReady`).
  ///
  /// Several other commands also carry an allow-listed `photos` field
  /// (`RCA`, `REPORT_ISSUE`, `ODOMETER_LOG`, `ENGINE_HOURS_LOG`,
  /// `REPORT_ACCIDENT`, `WASH_RECORD` all do, per `recordQueue.ts`), and in
  /// the RN source EVERY command with a `photos` key is held back by
  /// `resolveCommandPhotos` until its photos are uploaded, not only these
  /// two. This flag is deliberately narrower than that: it marks the two
  /// commands whose photos are multi-item and structurally significant (one
  /// photo set per tyre POSITION for a tyre change, one photo set per
  /// checklist FIELD for a submission - see artifact 06 section 6 on the
  /// flat-array-vs-keyed-map split), which is why they need an explicit gate
  /// in the Drift-based engine rather than best-effort inline waiting.
  /// Flagged for review, not silently widened: if the Flutter sync engine is
  /// meant to fully reproduce RN's "hold back any command with photos"
  /// behaviour, the other six photo-bearing commands may need this flag too.
  final bool requiresMediaReady;

  /// True for [CommandType.workOrderStatus],
  /// [CommandType.correctiveActionStatus] and
  /// [CommandType.checklistAssignmentStatus] - the "QUEUEABLE WITH CARE" row
  /// of artifact 06 section 4.
  ///
  /// A blind patch-by-id can overwrite a decision someone else made while the
  /// phone was offline, so the payload for these three additionally carries
  /// the expected PRIOR status and the sync engine adds
  /// `.eq('status', expectedPriorStatus)` to the update, treating a zero-row
  /// result as a stale conflict rather than success.
  ///
  /// Deliberately `false` for [CommandType.stockAdjust] even though it is
  /// also an update command: it is safe because callers always send an
  /// ABSOLUTE value (the new quantity), not because of any status match -
  /// see artifact 06 section 3.
  final bool requiresOptimisticStatusMatch;
}

/// The single table-name registry. See the library comment.
abstract final class CommandRegistry {
  static const Map<CommandType, CommandSpec> specs =
      <CommandType, CommandSpec>{
    // ---- Inserts (observations - safe to queue outright) ----
    CommandType.tyreChange: CommandSpec(
      type: CommandType.tyreChange,
      table: SupabaseTables.tyreRecords,
      operation: CommandOperation.insert,
      fieldAllowList: <String>{
        'asset_no',
        'serial_no',
        'serial_number',
        'tyre_serial',
        'brand',
        'size',
        'site',
        'country',
        'cost_per_tyre',
        'qty',
        'position',
        'tyre_position',
        'km_at_fitment',
        'km_at_removal',
        'hrs_at_fitment',
        'hrs_at_removal',
        'tread_depth',
        'removal_reason',
        'removal_date',
        'fitment_date',
        'issue_date',
        'status',
        'risk_level',
        'category',
        'photos',
      },
      requiresMediaReady: true,
    ),
    CommandType.workOrder: CommandSpec(
      type: CommandType.workOrder,
      table: SupabaseTables.workOrders,
      operation: CommandOperation.insert,
      fieldAllowList: <String>{
        'work_order_no',
        'asset_no',
        'tyre_serial',
        'status',
        'priority',
        'work_type',
        'description',
        'technician_name',
        'site',
        'country',
        'opened_at',
        'labour_cost',
        'parts_cost',
        'total_cost',
        'notes',
        'created_by',
      },
    ),
    CommandType.rca: CommandSpec(
      type: CommandType.rca,
      table: SupabaseTables.rcaRecords,
      operation: CommandOperation.insert,
      fieldAllowList: <String>{
        'asset_no',
        'tyre_serial',
        'brand',
        'site',
        'region',
        'failure_date',
        'km_at_failure',
        'root_cause',
        'contributing_factors',
        'photos',
        'corrective_action_id',
        'created_by',
        'country',
      },
    ),
    CommandType.reportIssue: CommandSpec(
      type: CommandType.reportIssue,
      table: SupabaseTables.correctiveActions,
      operation: CommandOperation.insert,
      fieldAllowList: <String>{
        'title',
        'priority',
        'site',
        'region',
        'description',
        'assigned_to',
        'status',
        'root_cause',
        'asset_no',
        'tyre_serial',
        'created_by',
        'country',
        'due_date',
        'photos',
      },
    ),
    CommandType.checklistSubmission: CommandSpec(
      type: CommandType.checklistSubmission,
      table: SupabaseTables.checklistSubmissions,
      operation: CommandOperation.insert,
      fieldAllowList: <String>{
        'id',
        'template_id',
        'template_name',
        'template_version',
        'country',
        'site',
        'asset_no',
        'title',
        'status',
        'answers',
        'photos',
        'signature_data',
        'printed_name',
        'score_pct',
        'score_passed',
        'approval_status',
        // Real columns since V212 that a stripped payload would otherwise
        // silently drop. `signatures` = every trade's sign-off keyed by
        // field id; `notes` = the per-line Remarks a fitter writes to
        // explain a failed check.
        'signatures',
        'notes',
      },
      requiresMediaReady: true,
    ),
    CommandType.odometerLog: CommandSpec(
      type: CommandType.odometerLog,
      table: SupabaseTables.odometerLogs,
      operation: CommandOperation.insert,
      fieldAllowList: <String>{
        'asset_no',
        'odometer_km',
        'reading_date',
        'source',
        'site',
        'country',
        'notes',
        'photos',
        'created_by',
        'signature',
      },
    ),
    CommandType.engineHoursLog: CommandSpec(
      type: CommandType.engineHoursLog,
      table: SupabaseTables.engineHoursLogs,
      operation: CommandOperation.insert,
      fieldAllowList: <String>{
        'asset_no',
        'engine_hours',
        'reading_date',
        'source',
        'site',
        'country',
        'notes',
        'photos',
        'created_by',
        'signature',
      },
    ),
    CommandType.reportAccident: CommandSpec(
      type: CommandType.reportAccident,
      table: SupabaseTables.accidents,
      operation: CommandOperation.insert,
      fieldAllowList: <String>{
        'site',
        'asset_no',
        'vehicle_id',
        'reported_by',
        'reporter_name',
        'incident_date',
        'incident_time',
        'location',
        'accident_type',
        'severity',
        'description',
        'injuries',
        'injury_count',
        'third_party_involved',
        'police_report_no',
        'damage_description',
        'estimated_damage_cost',
        'photos',
        'notes',
        'status',
        'country',
        'driver_name',
        // Field-parity capture (mirrors the web incident form): the full
        // classification / GCC-case / claim / repair record.
        'plate_number',
        'vehicle_type',
        'current_status',
        'damage_condition',
        'fault_status',
        'gcc_liability_ratio',
        'najm_status',
        'najm_fault',
        'taqdeer_status',
        'taqdeer_no',
        'liable_party',
        'payer',
        'responsible_party',
        'insurer',
        'policy_no',
        'insurance_claim_no',
        'claim_status',
        'claim_amount',
        'claim_approved_amount',
        'deductible',
        'recovered_amount',
        'recovery_status',
        'recovery_source',
        'recovery_date',
        'recovery_reference',
        'amount_transfer',
        'repair_type',
        'workshop_name',
        'workshop_location',
        'repair_cost',
        'expected_release_date',
        'release_date',
      },
    ),
    CommandType.washRecord: CommandSpec(
      type: CommandType.washRecord,
      table: SupabaseTables.washRecords,
      operation: CommandOperation.insert,
      fieldAllowList: <String>{
        'asset_no',
        'vehicle_type',
        'site',
        'country',
        'created_by',
        'washed_by',
        'wash_date',
        'wash_time',
        'wash_type',
        'bay',
        'water_liters',
        'cost',
        'duration_min',
        'odometer_km',
        'status',
        'notes',
        'photos',
      },
    ),
    CommandType.workshopEvent: CommandSpec(
      type: CommandType.workshopEvent,
      table: SupabaseTables.techActivityEvents,
      operation: CommandOperation.insert,
      fieldAllowList: <String>{
        'user_id',
        'job_id',
        'task_id',
        'asset_no',
        'event_type',
        'reason_code',
        'note',
        'device',
        'gps_lat',
        'gps_lng',
        'site',
        'country',
        'foreman_confirmed',
        'confirmed_by',
      },
    ),

    // ---- Update-by-id commands (offline-safe status/quantity changes) ----
    CommandType.stockAdjust: CommandSpec(
      type: CommandType.stockAdjust,
      table: SupabaseTables.stockRecords,
      operation: CommandOperation.update,
      matchColumn: 'id',
      fieldAllowList: <String>{
        'id',
        'stock_qty',
        'stock_status',
        'updated_by',
        'updated_at',
      },
    ),
    CommandType.workOrderStatus: CommandSpec(
      type: CommandType.workOrderStatus,
      table: SupabaseTables.workOrders,
      operation: CommandOperation.update,
      matchColumn: 'id',
      fieldAllowList: <String>{
        'id',
        'status',
        'started_at',
        'completed_at',
      },
      requiresOptimisticStatusMatch: true,
    ),
    CommandType.correctiveActionStatus: CommandSpec(
      type: CommandType.correctiveActionStatus,
      table: SupabaseTables.correctiveActions,
      operation: CommandOperation.update,
      matchColumn: 'id',
      fieldAllowList: <String>{
        'id',
        'status',
        'closed_at',
      },
      requiresOptimisticStatusMatch: true,
    ),
    CommandType.checklistAssignmentStatus: CommandSpec(
      type: CommandType.checklistAssignmentStatus,
      table: SupabaseTables.checklistAssignments,
      operation: CommandOperation.update,
      matchColumn: 'id',
      fieldAllowList: <String>{
        'id',
        'status',
        'submission_id',
        'completed_at',
      },
      requiresOptimisticStatusMatch: true,
    ),
  };

  /// Looks up the spec for [type]. Every [CommandType] value has an entry -
  /// enforced by `test/core/sync/command_registry_test.dart`, not by a
  /// runtime check here, so a missing entry is a build-time test failure
  /// rather than a null-check crash discovered in the field.
  static CommandSpec specFor(CommandType type) => specs[type]!;
}
