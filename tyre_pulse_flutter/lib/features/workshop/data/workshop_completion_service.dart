/// Job completion - data side.
///
/// * [WorkshopCompletionService.jobPartsRequests] - the parts already
///   requested on this job, offered as one-tap "parts used" picks.
/// * [WorkshopCompletionService.assetMeters] - whether the asset carries an
///   odometer and / or an hour meter, so the sheet only asks for what exists.
/// * [WorkshopCompletionService.submit] - queues ONE `JOB_COMPLETION` command
///   (an RPC command, idempotent per technician on `client_uuid`). Works
///   offline: the photos ride along as queued media attachments (bucket
///   `tyre-photos`, file name `jobdone_...` so they land under
///   `modules/workshop/<user>/`), the payload keeps their local paths, and
///   `JobCompletionEvidenceCommandPusher` swaps those for the uploaded
///   references when the queue sends it. The server
///   (`submit_job_completion`) moves the job to Quality Inspection for a
///   supervisor; it never closes the job.
///
/// Reads are best effort: an unreadable parts list or meter lookup degrades
/// to "nothing to pick" / "ask for both", never to a blocked completion.
library;

import 'dart:convert';

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/queue_dao.dart'
    show QueuedMediaAttachment;
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/core/sync/supabase_command_pusher.dart'
    show workshopCompletionMediaBucket, workshopCompletionMediaPrefix;
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_repository.dart';
import 'package:tyre_pulse/features/workshop/domain/workshop_completion.dart';
import 'package:uuid/uuid.dart';

/// Which meters the asset carries. Unknown (lookup failed) asks for both.
final class WorkshopAssetMeters {
  const WorkshopAssetMeters({
    required this.hasKm,
    required this.hasHours,
    this.lastKm,
    this.lastHours,
  });

  static const WorkshopAssetMeters unknown =
      WorkshopAssetMeters(hasKm: true, hasHours: true);

  final bool hasKm;
  final bool hasHours;
  final num? lastKm;
  final num? lastHours;
}

abstract interface class WorkshopCompletionService {
  Future<List<WorkshopPartUsed>> jobPartsRequests(String jobId);

  Future<WorkshopAssetMeters> assetMeters(String? assetNo);

  /// Queues the completion with its photos (durable local paths). Returns
  /// the command's idempotency key.
  Future<String> submit({
    required WorkspaceContext workspace,
    required WorkshopJob job,
    required WorkshopCompletionDraft draft,
    required String workDone,
    String? taskId,
  });
}

/// `parts_requests` is not in `SupabaseTables` (that registry is owned
/// elsewhere); see `workshop_offline.dart`.
const String _partsRequestsTable = 'parts_requests';

final class SupabaseWorkshopCompletionService
    with SupabaseGateway
    implements WorkshopCompletionService {
  SupabaseWorkshopCompletionService(this._client, this._commands);

  final SupabaseClient _client;
  final QueuedCommandRepository _commands;

  static const Uuid _uuid = Uuid();

  @override
  Future<List<WorkshopPartUsed>> jobPartsRequests(String jobId) async {
    if (jobId.isEmpty) return const <WorkshopPartUsed>[];
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(
      () => _client
          .from(_partsRequestsTable)
          .select('id,part_name,qty,status')
          .eq('job_id', jobId)
          .order('requested_at', ascending: true),
    );
    return <WorkshopPartUsed>[
      for (final Map<String, dynamic> r in rows)
        if (r['part_name'] is String &&
            (r['part_name'] as String).trim().isNotEmpty &&
            r['status'] != 'rejected' &&
            r['status'] != 'cancelled')
          WorkshopPartUsed(
            name: (r['part_name'] as String).trim(),
            qty: r['qty'] is num ? r['qty'] as num : 1,
            requestId: r['id'] as String?,
          ),
    ];
  }

  @override
  Future<WorkshopAssetMeters> assetMeters(String? assetNo) async {
    final String asset = (assetNo ?? '').trim();
    if (asset.isEmpty) return WorkshopAssetMeters.unknown;
    try {
      final List<Map<String, dynamic>> fleet =
          await guard<List<Map<String, dynamic>>>(
        () => _client
            .from(SupabaseTables.vehicleFleet)
            .select('current_km')
            .eq('asset_no', asset)
            .limit(1),
      );
      final List<Map<String, dynamic>> hours =
          await guard<List<Map<String, dynamic>>>(
        () => _client
            .from(SupabaseTables.engineHoursLogs)
            .select('engine_hours')
            .eq('asset_no', asset)
            .order('reading_date', ascending: false)
            .limit(1),
      );
      final Object? km = fleet.isEmpty ? null : fleet.first['current_km'];
      final Object? h = hours.isEmpty ? null : hours.first['engine_hours'];
      final bool hasKm = km is num && km > 0;
      final bool hasHours = h is num && h > 0;
      // An asset with no reading of either kind still has SOME meter we do
      // not know about: ask for both rather than hiding the question.
      if (!hasKm && !hasHours) return WorkshopAssetMeters.unknown;
      return WorkshopAssetMeters(
        hasKm: hasKm,
        hasHours: hasHours,
        lastKm: hasKm ? km : null,
        lastHours: hasHours ? h : null,
      );
    } on Object {
      return WorkshopAssetMeters.unknown;
    }
  }

  @override
  Future<String> submit({
    required WorkspaceContext workspace,
    required WorkshopJob job,
    required WorkshopCompletionDraft draft,
    required String workDone,
    String? taskId,
  }) async {
    final String key = 'jobdone_${_uuid.v4()}';
    await _commands.enqueue(
      type: CommandType.jobCompletion,
      payload: workshopCompletionPayload(
        key: key,
        job: job,
        draft: draft,
        workDone: workDone,
        taskId: taskId,
        now: DateTime.now(),
      ),
      workspace: workspace,
      now: DateTime.now(),
      country: workspace.activeCountry,
      idempotencyKey: key,
      attachments: workshopCompletionAttachments(key: key, draft: draft),
    );
    return key;
  }
}

/// The queued photos of a completion, one attachment per local photo.
/// Already-uploaded references are not re-queued.
List<QueuedMediaAttachment> workshopCompletionAttachments({
  required String key,
  required WorkshopCompletionDraft draft,
}) {
  final String stem = key.replaceAll(RegExp('[^A-Za-z0-9_-]'), '');
  final List<QueuedMediaAttachment> out = <QueuedMediaAttachment>[];
  void add(List<String> photos, String field) {
    for (int i = 0; i < photos.length; i++) {
      final String path = photos[i];
      if (path.startsWith('tp-storage://')) continue;
      final bool png = path.toLowerCase().endsWith('.png');
      final String core = stem.startsWith(workshopCompletionMediaPrefix)
          ? stem.substring(workshopCompletionMediaPrefix.length)
          : stem;
      out.add(
        QueuedMediaAttachment(
          localPath: path,
          fileName: '$workshopCompletionMediaPrefix${core}_${field}_$i'
              '${png ? '.png' : '.jpg'}',
          orderIndex: i,
          fieldKey: field,
          mimeType: png ? 'image/png' : 'image/jpeg',
          bucket: workshopCompletionMediaBucket,
        ),
      );
    }
  }

  add(draft.beforePhotos, 'before');
  add(draft.afterPhotos, 'after');
  return out;
}

/// The exact payload the RPC reads. Pure, so it is tested directly.
Map<String, Object?> workshopCompletionPayload({
  required String key,
  required WorkshopJob job,
  required WorkshopCompletionDraft draft,
  required String workDone,
  required DateTime now,
  String? taskId,
}) =>
    <String, Object?>{
      // The RPC answer is matched on this, so it must equal the command's
      // idempotency key.
      'client_uuid': key,
      'job_id': job.id,
      'task_id': taskId,
      'work_done': workDone,
      'quick_picks': <String>[
        for (final String p in kWorkshopQuickPicks)
          if (draft.quickPicks.contains(p)) p,
      ],
      'parts_used': <Map<String, Object?>>[
        for (final WorkshopPartUsed p in draft.parts) p.toJson(),
      ],
      // Local paths until the queue sends it; see the library comment.
      'before_photos': draft.beforePhotos,
      'after_photos': draft.afterPhotos,
      'km': draft.km,
      'engine_hours': draft.engineHours,
      'signature': draft.signature,
      'completed_at': now.toUtc().toIso8601String(),
    };

/// Where a completion still on this phone stands.
enum WorkshopCompletionQueueState {
  /// Saved on the phone, waiting for signal (or for its photos to upload).
  queued,

  /// The server refused it, or sending keeps failing; [error] says why.
  failed,
}

/// One still-unsent completion from the queue: the job it is for, and the
/// server's refusal when there was one.
final class WorkshopPendingCompletion {
  const WorkshopPendingCompletion({
    required this.jobId,
    this.error,
    this.state = WorkshopCompletionQueueState.queued,
  });

  final String jobId;
  final String? error;
  final WorkshopCompletionQueueState state;

  bool get isFailed => state == WorkshopCompletionQueueState.failed;
}

/// This user's completions still in the offline queue, keyed by job.
Map<String, WorkshopPendingCompletion> workshopPendingCompletions(
  Iterable<PendingCommand> commands, {
  required String userId,
}) {
  final String wire = CommandType.jobCompletion.wireName;
  final Map<String, WorkshopPendingCompletion> out =
      <String, WorkshopPendingCompletion>{};
  for (final PendingCommand c in commands) {
    if (c.commandType != wire || c.createdBy != userId) continue;
    Object? decoded;
    try {
      decoded = jsonDecode(c.payloadJson);
    } on Object {
      continue;
    }
    if (decoded is! Map) continue;
    final Object? job = decoded['job_id'];
    if (job is! String || job.isEmpty) continue;
    final String? err = c.lastError?.trim();
    final bool failed = err != null && err.isNotEmpty;
    out[job] = WorkshopPendingCompletion(
      jobId: job,
      error: failed ? err : null,
      state: failed
          ? WorkshopCompletionQueueState.failed
          : WorkshopCompletionQueueState.queued,
    );
  }
  return out;
}
