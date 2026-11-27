library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/features/report_issue/data/report_issue_photo_capture.dart';

final Provider<ReportIssuePhotoCapture> reportIssuePhotoCaptureProvider =
    Provider<ReportIssuePhotoCapture>((Ref ref) => ReportIssuePhotoCapture());

/// The shared offline queue, live - read by the report screen to say when a
/// just-submitted issue was refused by the server instead of letting it look
/// "saved" forever.
final StreamProvider<List<PendingCommand>> reportIssueQueueProvider =
    StreamProvider<List<PendingCommand>>((Ref ref) {
  final AppDatabase db = ref.watch(appDatabaseProvider);
  return db.queueDao.watchQueuedCommands();
});
