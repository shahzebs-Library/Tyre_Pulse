/// Workshop Live Control - technician data layer.
///
/// Port of `mobile/lib/workshopApi.ts` (READ-ONLY reference, see
/// `AGENTS.md`). Every object used is created by
/// `MIGRATIONS_V291_WORKSHOP_LIVE_CONTROL.sql` (`tech_activity_events`,
/// `wo_tasks`, `wo_assignments`, `work_orders.assigned_owner_id`) plus
/// `MIGRATIONS_V292_TECH_EVENTS_CLIENT_UUID.sql` (`client_uuid` + its unique
/// index, which is what makes a replayed tap at-most-once).
///
/// # Reads
///
/// Direct PostgREST, scoped server-side by org / country / site RLS and, for
/// `tech_activity_events`, "own rows only". Unlike the React Native source,
/// which degrades EVERY read error to `[]`, every failure is surfaced here -
/// including a schema mismatch, per `supabase_error_mapper.dart` rule 3 ("a
/// missing relation or unknown column must be LOUD") and AGENTS.md rule 5,
/// because "you have no jobs" and "we could not look" are opposite
/// statements. All four objects read are created by V291.
///
/// # The write
///
/// Every tap is ONE `WORKSHOP_EVENT` command through the shared offline
/// queue (`CommandType.workshopEvent`, allow-list in
/// `lib/core/sync/command_registry.dart`). The sync engine stamps the
/// command's idempotency key into `client_uuid`, so a retry never duplicates
/// a row. `at` is NOT sent - it is a server default, exactly as on mobile -
/// which means an event queued offline is timestamped when it syncs; the
/// screen keeps its own device-time copy until then (see
/// [WorkshopEventRecord.localAt]).
///
/// # Evidence (photos + GPS)
///
/// - Photos on Report Problem / Request Parts: exactly as mobile, they are
///   uploaded at record time (`workshop_photo_uploader.dart`) and their
///   `tp-storage://` refs are folded into `note` by
///   [workshopNoteWithPhotos] - the table has no photos column. A photo
///   that cannot upload is dropped; the event is always queued.
/// - GPS: the screen passes a best-effort fix (`gps_lat`/`gps_lng`, both in
///   the allow-list and in V291). A missing fix is sent as null (a
///   known-absent reading, never 0) and never delays the event.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/features/workshop/domain/workshop_evidence.dart';
import 'package:tyre_pulse/features/workshop/domain/workshop_live.dart';
import 'package:uuid/uuid.dart';

String? _text(Object? v) {
  if (v is! String) return null;
  final String t = v.trim();
  return t.isEmpty ? null : t;
}

/// One open job assigned to this technician.
final class WorkshopJob {
  const WorkshopJob({
    required this.id,
    this.workOrderNo,
    this.assetNo,
    this.status,
    this.priority,
    this.targetCompletion,
    this.site,
    this.role,
  });

  final String id;
  final String? workOrderNo;
  final String? assetNo;
  final String? status;
  final String? priority;
  final String? targetCompletion;
  final String? site;

  /// `wo_assignments.role` (`primary` / `helper`) when the job came through
  /// an assignment.
  final String? role;

  static WorkshopJob? fromRow(Map<String, dynamic> row, {String? role}) {
    final String? id = _text(row['id']);
    if (id == null) return null;
    return WorkshopJob(
      id: id,
      workOrderNo: _text(row['work_order_no']),
      assetNo: _text(row['asset_no']),
      status: _text(row['status']),
      priority: _text(row['priority']),
      targetCompletion: _text(row['target_completion']),
      site: _text(row['site']),
      role: role,
    );
  }
}

/// One step of a job (`wo_tasks`).
final class WorkshopTask {
  const WorkshopTask({
    required this.id,
    this.seq,
    this.title,
    this.status,
    this.estMinutes,
  });

  final String id;
  final int? seq;
  final String? title;
  final String? status;
  final num? estMinutes;

  static WorkshopTask? fromRow(Map<String, dynamic> row) {
    final String? id = _text(row['id']);
    if (id == null) return null;
    final Object? seq = row['seq'];
    final Object? est = row['est_minutes'];
    return WorkshopTask(
      id: id,
      seq: seq is num ? seq.toInt() : null,
      title: _text(row['title']),
      status: _text(row['status']),
      estMinutes: est is num ? est : null,
    );
  }
}

/// One `tech_activity_events` row, or a just-recorded local copy of one.
final class WorkshopEventRecord {
  const WorkshopEventRecord({
    required this.eventType,
    this.id,
    this.jobId,
    this.reasonCode,
    this.at,
    this.clientUuid,
    this.localAt,
  });

  final String? id;
  final String? jobId;
  final String eventType;
  final String? reasonCode;

  /// Server timestamp. Null for a local copy not yet synced.
  final DateTime? at;

  /// `client_uuid` - lets the screen drop its local copy the moment the
  /// synced row appears.
  final String? clientUuid;

  /// Device time a LOCAL copy was recorded. Null for a server row.
  final DateTime? localAt;

  WorkshopEventLike get asLike => WorkshopEventLike(
        eventType: eventType,
        reasonCode: reasonCode,
        at: at ?? localAt,
      );

  static WorkshopEventRecord? fromRow(Map<String, dynamic> row) {
    final String? type = _text(row['event_type']);
    if (type == null) return null;
    final String? at = _text(row['at']);
    return WorkshopEventRecord(
      id: _text(row['id']),
      jobId: _text(row['job_id']),
      eventType: type,
      reasonCode: _text(row['reason_code']),
      at: at == null ? null : DateTime.tryParse(at),
      clientUuid: _text(row['client_uuid']),
    );
  }
}

/// Merges server rows with local copies still waiting to sync, dropping a
/// local copy once its `client_uuid` is on the server.
List<WorkshopEventRecord> mergeWorkshopEvents(
  List<WorkshopEventRecord> server,
  List<WorkshopEventRecord> local,
) {
  final Set<String> synced = <String>{
    for (final WorkshopEventRecord e in server)
      if (e.clientUuid != null) e.clientUuid!,
  };
  return <WorkshopEventRecord>[
    ...server,
    for (final WorkshopEventRecord e in local)
      if (e.clientUuid == null || !synced.contains(e.clientUuid)) e,
  ];
}

/// Input for one activity tap.
final class RecordWorkshopEventInput {
  const RecordWorkshopEventInput({
    required this.eventType,
    this.jobId,
    this.taskId,
    this.assetNo,
    this.reasonCode,
    this.note,
    this.site,
    this.country,
    this.device,
    this.photoRefs = const <String>[],
    this.gps,
  });

  final String eventType;
  final String? jobId;
  final String? taskId;
  final String? assetNo;
  final String? reasonCode;
  final String? note;
  final String? site;
  final String? country;
  final String? device;

  /// Permanent `tp-storage://` refs, folded into `note` on the way out.
  final List<String> photoRefs;

  /// Best-effort device fix; null = no reading.
  final WorkshopGpsReading? gps;
}

abstract interface class WorkshopRepository {
  Future<List<WorkshopJob>> listMyJobs(String userId);
  Future<List<WorkshopEventRecord>> listMyRecentEvents(
    String userId, {
    int limit = 200,
  });
  Future<List<WorkshopTask>> listTasksForJob(String jobId);

  /// Queues one event. Returns the stored local copy (with its
  /// `client_uuid`) so the screen can show it straight away.
  Future<WorkshopEventRecord> recordEvent({
    required WorkspaceContext workspace,
    required RecordWorkshopEventInput input,
  });
}

const String _woColumns =
    'id,work_order_no,asset_no,status,priority,target_completion,site';
const String _eventColumns = 'id,job_id,event_type,reason_code,at,client_uuid';

final class SupabaseWorkshopRepository
    with SupabaseGateway
    implements WorkshopRepository {
  SupabaseWorkshopRepository(this._client, this._commands);

  final SupabaseClient _client;
  final QueuedCommandRepository _commands;

  static const Uuid _uuid = Uuid();

  @override
  Future<List<WorkshopJob>> listMyJobs(String userId) async {
    if (userId.isEmpty) return const <WorkshopJob>[];
    final Map<String, WorkshopJob> byId = <String, WorkshopJob>{};

    // 1. Active assignments -> their work orders (the primary source).
    final List<Map<String, dynamic>> assigned =
        await guard<List<Map<String, dynamic>>>(
      () => _client
          .from(SupabaseTables.woAssignments)
          .select('role,active,work_orders!job_id($_woColumns)')
          .eq('user_id', userId)
          .eq('active', true),
    );
    for (final Map<String, dynamic> row in assigned) {
      final Object? wo = row['work_orders'];
      if (wo is Map) {
        final WorkshopJob? job = WorkshopJob.fromRow(
          Map<String, dynamic>.from(wo),
          role: _text(row['role']),
        );
        if (job != null) byId[job.id] = job;
      }
    }

    // 2. Single-owner jobs (`work_orders.assigned_owner_id`).
    final List<Map<String, dynamic>> owned =
        await guard<List<Map<String, dynamic>>>(
      () => _client
          .from(SupabaseTables.workOrders)
          .select(_woColumns)
          .eq('assigned_owner_id', userId),
    );
    for (final Map<String, dynamic> row in owned) {
      final WorkshopJob? job = WorkshopJob.fromRow(row);
      if (job != null) byId.putIfAbsent(job.id, () => job);
    }

    return <WorkshopJob>[
      for (final WorkshopJob j in byId.values)
        if (isOpenWorkshopJob(j.status)) j,
    ];
  }

  @override
  Future<List<WorkshopEventRecord>> listMyRecentEvents(
    String userId, {
    int limit = 200,
  }) async {
    if (userId.isEmpty) return const <WorkshopEventRecord>[];
    // Newest first so the limit keeps the RECENT events (mobile ordered
    // ascending with a limit, which keeps the oldest 200 - a stale status
    // for anyone with a long history). The engine re-sorts by time.
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(
      () => _client
          .from(SupabaseTables.techActivityEvents)
          .select(_eventColumns)
          .eq('user_id', userId)
          .order('at', ascending: false)
          .limit(limit),
    );
    return <WorkshopEventRecord>[
      for (final Map<String, dynamic> row in rows.reversed)
        if (WorkshopEventRecord.fromRow(row) case final WorkshopEventRecord e)
          e,
    ];
  }

  @override
  Future<List<WorkshopTask>> listTasksForJob(String jobId) async {
    if (jobId.isEmpty) return const <WorkshopTask>[];
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(
      () => _client
          .from(SupabaseTables.woTasks)
          .select('id,job_id,seq,title,est_minutes,status')
          .eq('job_id', jobId)
          .order('seq', ascending: true),
    );
    return <WorkshopTask>[
      for (final Map<String, dynamic> row in rows)
        if (WorkshopTask.fromRow(row) case final WorkshopTask t) t,
    ];
  }

  @override
  Future<WorkshopEventRecord> recordEvent({
    required WorkspaceContext workspace,
    required RecordWorkshopEventInput input,
  }) async {
    if (!kWorkshopEventTypes.contains(input.eventType)) {
      throw ArgumentError.value(
        input.eventType,
        'eventType',
        'is not in the tech_activity_events CHECK vocabulary',
      );
    }
    final String key = 'ws_${input.eventType}_${_uuid.v4()}';
    final DateTime now = DateTime.now();
    await _commands.enqueue(
      type: CommandType.workshopEvent,
      payload: <String, Object?>{
        'user_id': workspace.userId,
        'job_id': input.jobId,
        'task_id': input.taskId,
        'asset_no': _text(input.assetNo),
        'event_type': input.eventType,
        'reason_code': _text(input.reasonCode),
        'note': workshopNoteWithPhotos(input.note, input.photoRefs),
        'device': input.device,
        'gps_lat': input.gps?.lat,
        'gps_lng': input.gps?.lng,
        'site': _text(input.site),
        'country': input.country,
      },
      workspace: workspace,
      now: now,
      country: input.country ?? workspace.activeCountry,
      idempotencyKey: key,
    );
    return WorkshopEventRecord(
      jobId: input.jobId,
      eventType: input.eventType,
      reasonCode: _text(input.reasonCode),
      clientUuid: key,
      localAt: now,
    );
  }
}
