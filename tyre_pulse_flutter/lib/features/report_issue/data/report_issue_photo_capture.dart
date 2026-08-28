/// Durable photo capture for an offline-queued corrective-action report.
library;

import 'dart:io';

import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';

enum ReportIssuePhotoSource { camera, gallery }

final class ReportIssuePhotoCapture {
  ReportIssuePhotoCapture({ImagePicker? picker})
      : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  static const int maxPhotos = 6;

  Future<String?> captureAndStore({
    required String sessionKey,
    required int orderIndex,
    required ReportIssuePhotoSource source,
  }) async {
    final XFile? picked = await _picker.pickImage(
      source: source == ReportIssuePhotoSource.camera
          ? ImageSource.camera
          : ImageSource.gallery,
      maxWidth: 1600,
      maxHeight: 1600,
      imageQuality: 50,
    );
    if (picked == null) return null;

    final Directory base = await getApplicationDocumentsDirectory();
    final Directory folder = Directory(
      '${base.path}${Platform.pathSeparator}report_issue_draft_photos'
      '${Platform.pathSeparator}${_safe(sessionKey)}',
    );
    await folder.create(recursive: true);
    final String extension = _extension(picked.name);
    final File destination = File(
      '${folder.path}${Platform.pathSeparator}issue_${orderIndex}_'
      '${DateTime.now().toUtc().millisecondsSinceEpoch}$extension',
    );
    await File(picked.path).copy(destination.path);
    return destination.path;
  }

  static String _safe(String value) =>
      value.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');

  static String _extension(String name) {
    final int dot = name.lastIndexOf('.');
    if (dot < 0) return '.jpg';
    final String value = name.substring(dot).toLowerCase();
    return const <String>{'.jpg', '.jpeg', '.png', '.heic'}.contains(value)
        ? value
        : '.jpg';
  }
}
