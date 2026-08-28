library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/features/report_issue/data/report_issue_photo_capture.dart';

final Provider<ReportIssuePhotoCapture> reportIssuePhotoCaptureProvider =
    Provider<ReportIssuePhotoCapture>((Ref ref) => ReportIssuePhotoCapture());
