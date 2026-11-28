/// Read helpers over [InspectionSubmissionQueue] for the "Pending sync"
/// counts and Profile's sync queue screen.
///
/// The queue is one JSON file per submission with no change notification, so
/// a live view polls. It is device-wide, so reads are narrowed to one person:
/// their `createdBy`, or a draft key under their user id (`userId|ASSET...`).
/// An unreadable queue throws - never an empty list - matching the queue's
/// own "refuse, never guess" rule.
library;

import 'package:tyre_pulse/features/inspections/data/inspection_submission_queue.dart';
import 'package:tyre_pulse/features/inspections/domain/queued_inspection.dart';

/// How often the file-backed inspection submission queue is re-read. It has
/// no change notification (one JSON file per submission, see
/// `inspection_submission_queue.dart`), so its share of the counts is polled.
const Duration inspectionQueuePollInterval = Duration(seconds: 10);

/// This person's inspection submissions, read now and every [interval]
/// (Profile's sync queue screen and its "Pending sync" count).
Stream<List<QueuedInspection>> watchUserInspectionSubmissions(
  InspectionSubmissionQueue queue, {
  required String userId,
  Duration interval = inspectionQueuePollInterval,
}) async* {
  final String user = userId.trim();
  if (user.isEmpty) {
    yield const <QueuedInspection>[];
    return;
  }
  yield await readUserInspectionSubmissions(queue, userId: user);
  await for (final _ in Stream<void>.periodic(interval)) {
    yield await readUserInspectionSubmissions(queue, userId: user);
  }
}

/// One read of this person's inspection submissions. Throws on an unreadable
/// queue rather than returning an empty list.
Future<List<QueuedInspection>> readUserInspectionSubmissions(
  InspectionSubmissionQueue queue, {
  required String userId,
}) async {
  final String user = userId.trim();
  if (user.isEmpty) return const <QueuedInspection>[];
  final InspectionQueueReadResult result = await queue.list();
  if (!result.isReadable) {
    throw StateError('The inspection submission queue could not be read.');
  }
  return result.items
      .where(
        (QueuedInspection q) =>
            q.payload.createdBy?.trim() == user ||
            q.draftKey.startsWith('$user|'),
      )
      .toList(growable: false);
}

/// Inspection submissions in [items] that have not reached `synced`.
int pendingInspectionCount(List<QueuedInspection> items) => items
    .where((QueuedInspection q) => q.status != InspectionQueueStatus.synced)
    .length;
