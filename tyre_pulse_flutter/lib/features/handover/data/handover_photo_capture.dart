/// Captures a handover evidence photo to a durable device folder and returns
/// its local path.
///
/// Mirrors `accident_photo_capture.dart`: `image_picker` resizes/compresses on
/// the way out (maxWidth/maxHeight 1600, quality 50) so a 13-megapixel field
/// photo never lands at full size, then the file is copied into a durable
/// `handover_draft_photos/<sessionKey>/` folder the queue owns until the server
/// confirms the upload. A photo is NEVER deleted before the server confirms its
/// upload (AGENTS.md offline rule).
library;

import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';

enum HandoverPhotoSource { camera, gallery }

final class HandoverPhotoCapture {
  HandoverPhotoCapture({ImagePicker? picker})
      : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  /// Picks an image for [sessionKey] and returns its durable local path, or
  /// null when the picker was cancelled.
  Future<String?> capture({
    required String sessionKey,
    required HandoverPhotoSource source,
  }) async {
    final XFile? picked = await _picker.pickImage(
      source: source == HandoverPhotoSource.camera
          ? ImageSource.camera
          : ImageSource.gallery,
      maxWidth: 1600,
      maxHeight: 1600,
      imageQuality: 50,
    );
    if (picked == null) return null;
    final Directory base = await getApplicationDocumentsDirectory();
    final Directory folder = Directory(
      '${base.path}${Platform.pathSeparator}handover_draft_photos'
      '${Platform.pathSeparator}${_safe(sessionKey)}',
    );
    await folder.create(recursive: true);
    final String extension = handoverEvidenceExtension(picked.name);
    final File destination = File(
      '${folder.path}${Platform.pathSeparator}handover_'
      '${DateTime.now().toUtc().millisecondsSinceEpoch}$extension',
    );
    await File(picked.path).copy(destination.path);
    return destination.path;
  }

  static String _safe(String value) =>
      value.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
}

/// Returns an extension the private `tyre-photos` bucket accepts, without ever
/// relabelling unsupported bytes. HEIC/HEIF would need transcoding this path
/// has no decoder for, so it fails visibly rather than copying HEIC bytes into
/// a `.jpg` file readers could not decode - mirrors
/// `accidentEvidenceExtension`.
@visibleForTesting
String handoverEvidenceExtension(String name) {
  final int dot = name.lastIndexOf('.');
  if (dot < 0) {
    throw UnsupportedError(
      'This photo format is not supported for handover evidence.',
    );
  }
  final String extension = name.substring(dot).toLowerCase();
  if (const <String>{'.jpg', '.jpeg', '.png', '.webp'}.contains(extension)) {
    return extension;
  }
  throw UnsupportedError(
    'This photo format is not supported for handover evidence.',
  );
}
