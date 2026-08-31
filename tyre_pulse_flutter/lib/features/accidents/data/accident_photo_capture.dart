library;

import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';

enum AccidentPhotoSource { camera, gallery }

final class AccidentPhotoCapture {
  AccidentPhotoCapture({ImagePicker? picker})
      : _picker = picker ?? ImagePicker();
  final ImagePicker _picker;

  Future<String?> capture({
    required String sessionKey,
    required AccidentPhotoSource source,
  }) async {
    final XFile? picked = await _picker.pickImage(
      source: source == AccidentPhotoSource.camera
          ? ImageSource.camera
          : ImageSource.gallery,
      maxWidth: 1600,
      maxHeight: 1600,
      imageQuality: 50,
    );
    if (picked == null) return null;
    final Directory base = await getApplicationDocumentsDirectory();
    final Directory folder = Directory(
      '${base.path}${Platform.pathSeparator}accident_draft_photos'
      '${Platform.pathSeparator}${_safe(sessionKey)}',
    );
    await folder.create(recursive: true);
    final String extension = accidentEvidenceExtension(picked.name);
    final File destination = File(
      '${folder.path}${Platform.pathSeparator}accident_'
      '${DateTime.now().toUtc().millisecondsSinceEpoch}$extension',
    );
    await File(picked.path).copy(destination.path);
    return destination.path;
  }

  static String _safe(String value) =>
      value.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
}

/// Returns an extension accepted by the live private `accident-photos`
/// bucket without ever relabelling unsupported bytes as JPEG.
///
/// HEIC/HEIF must be transcoded before they can be queued. This capture path
/// has no trustworthy HEIC decoder, so it fails visibly instead of copying
/// HEIC bytes into a `.jpg` file that Storage would accept but readers could
/// not decode.
@visibleForTesting
String accidentEvidenceExtension(String name) {
  final int dot = name.lastIndexOf('.');
  if (dot < 0) {
    throw UnsupportedError(
      'This photo format is not supported for accident evidence.',
    );
  }
  final String extension = name.substring(dot).toLowerCase();
  if (const <String>{'.jpg', '.jpeg', '.png', '.webp'}.contains(extension)) {
    return extension;
  }
  throw UnsupportedError(
    'This photo format is not supported for accident evidence.',
  );
}
