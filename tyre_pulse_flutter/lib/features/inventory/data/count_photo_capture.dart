/// Captures a compressed count photo and keeps it until the server has it.
///
/// Compressed on the way out of the picker (1280 px long edge, quality 60,
/// the same rung the inspection photos use) so a counter on a weak link is
/// not uploading 6 MB originals. The file is copied into an app-owned folder,
/// because the picker's cache file can be cleared by the OS while the count
/// is still offline.
library;

import 'dart:io';

import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';

final class CountPhotoCapture {
  CountPhotoCapture({ImagePicker? picker}) : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  /// Returns the stored path, or null when the counter cancelled (not an
  /// error).
  Future<String?> capture({
    required String auditId,
    required String clientUuid,
  }) async {
    final XFile? picked = await _picker.pickImage(
      source: ImageSource.camera,
      maxWidth: 1280,
      maxHeight: 1280,
      imageQuality: 60,
    );
    if (picked == null) return null;
    final Directory base = await getApplicationDocumentsDirectory();
    final String safeAudit = auditId.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    final Directory folder = Directory(
      '${base.path}${Platform.pathSeparator}inventory_counts'
      '${Platform.pathSeparator}$safeAudit',
    );
    await folder.create(recursive: true);
    final String safeLine =
        clientUuid.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    final File target = File(
      '${folder.path}${Platform.pathSeparator}'
      '${safeLine}_${DateTime.now().millisecondsSinceEpoch}.jpg',
    );
    await File(picked.path).copy(target.path);
    return target.path;
  }

  /// Deletes local copies whose upload the server confirmed. Never throws.
  static Future<void> discardUploaded(Iterable<String> paths) async {
    for (final String path in paths) {
      try {
        final File file = File(path);
        if (file.existsSync()) await file.delete();
      } on Object {
        // Best effort: a leftover file is harmless, a lost one is not.
      }
    }
  }
}
