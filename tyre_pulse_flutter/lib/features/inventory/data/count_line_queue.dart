/// Queues blind count lines for background delivery (INVENTORY_COUNT_LINE).
///
/// Every finished line is queued. A line still holding local photos carries
/// their paths under `local_photo_paths`; `InventoryCountCommandPusher`
/// uploads them first (deterministic, upserted object paths) and only then
/// sends the line, so the server never holds a line whose evidence is still
/// on the phone. The draft keeps the line (and its photo files) until the
/// server confirms it. Each line is idempotent on its client_uuid,
/// which is also the command's idempotency key, so a line queued twice (or
/// queued and then sent by hand) is stored once.
library;

import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/inventory_count_command_pusher.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/features/inventory/domain/count_session.dart';

Future<int> queueCountLines({
  required QueuedCommandRepository commands,
  required String auditId,
  required String deviceId,
  required List<CountLine> lines,
  required WorkspaceContext workspace,
  required DateTime now,
  Future<bool> Function(String idempotencyKey)? isQueued,
}) async {
  var queued = 0;
  for (final CountLine line in lines) {
    // The queue's idempotency key is UNIQUE: enqueuing a line already queued
    // (Send pressed twice without signal) would raise. It is already on its
    // way, so it counts as queued.
    if (isQueued != null && await isQueued(line.clientUuid)) {
      queued++;
      continue;
    }
    try {
      await commands.enqueue(
        type: CommandType.inventoryCountLine,
        idempotencyKey: line.clientUuid,
        payload: <String, Object?>{
          'audit_id': auditId,
          'device_id': deviceId,
          'lines': <Map<String, Object?>>[
            <String, Object?>{
              ...line.toSubmitJson(),
              if (line.photoPaths.isNotEmpty)
                localPhotosKey: <String>[...line.photoPaths],
            },
          ],
        },
        workspace: workspace,
        now: now,
      );
    } on Object {
      // Not queued: the line is still in the encrypted draft and the screen
      // reports "send again when you have signal". Nothing is lost.
      continue;
    }
    queued++;
  }
  return queued;
}
