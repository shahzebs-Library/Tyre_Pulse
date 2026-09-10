import 'package:drift/drift.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/media_dao.dart';
import 'package:tyre_pulse/core/database/dao/queue_dao.dart';
import 'package:tyre_pulse/core/sync/accident_evidence_command_pusher.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/sync_engine.dart';

/// Older meter/wash captures omitted their already-established upload bucket.
/// Repair only untouched/failed media in this workspace; never reassign known
/// buckets, in-flight uploads, or verified evidence, and never delete local files.
Future<int> prepareMeterWashMedia(AppDatabase db, String workspaceId) =>
    db.customUpdate(
      '''UPDATE pending_media_uploads
     SET bucket = 'tyre-photos', state = 'queued', attempts = 0, last_error = NULL
     WHERE (bucket IS NULL OR bucket = '') AND state IN ('queued', 'failed')
       AND command_id IN (
         SELECT id FROM pending_commands WHERE workspace_id = ?
           AND command_type IN (?, ?, ?)
       )''',
      variables: <Variable<Object>>[
        Variable<String>(workspaceId),
        Variable<String>(CommandType.odometerLog.wireName),
        Variable<String>(CommandType.engineHoursLog.wireName),
        Variable<String>(CommandType.washRecord.wireName),
      ],
      updates: <TableInfo<Table, Object?>>{db.pendingMediaUploads},
    );

/// The existing flat-photo resolver, scoped to the legacy meter/wash bucket.
/// Verified: mobile/lib/recordQueue.ts -> photoUpload.uploadModulePhoto and
/// live private tyre-photos bucket/RLS. Default accident behavior is unchanged.
class MeterWashEvidenceCommandPusher implements CommandPusher {
  const MeterWashEvidenceCommandPusher({
    required this.delegate,
    required this.queueDao,
    required this.mediaDao,
  });
  final CommandPusher delegate;
  final QueueDao queueDao;
  final MediaDao mediaDao;

  @override
  Future<List<Map<String, Object?>>> push({
    required CommandSpec spec,
    required Map<String, Object?> payload,
    String? matchValue,
    String? expectedPriorStatus,
  }) {
    final isSupported = spec.type == CommandType.odometerLog ||
        spec.type == CommandType.engineHoursLog ||
        spec.type == CommandType.washRecord;
    final CommandPusher pusher = isSupported
        ? AccidentEvidenceCommandPusher(
            delegate: delegate,
            queueDao: queueDao,
            mediaDao: mediaDao,
            commandType: spec.type,
            bucket: 'tyre-photos',
          )
        : delegate;
    return pusher.push(
      spec: spec,
      payload: payload,
      matchValue: matchValue,
      expectedPriorStatus: expectedPriorStatus,
    );
  }
}
