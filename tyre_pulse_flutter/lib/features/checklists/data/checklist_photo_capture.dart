/// Captures a checklist-field photo and copies it into this feature's own
/// durable draft-photo folder.
///
/// A close mirror of `features/inspections/data/inspection_photo_capture.dart`
/// (read there, never imported from here - each feature owns its own copy of
/// this small, self-contained technique per this port's boundary rules). The
/// same three decisions carry over verbatim, for the same reasons:
///
/// - `image_picker` only, no separate compression package - `pickImage`'s own
///   `maxWidth`/`maxHeight`/`imageQuality` already resize and compress in one
///   native call.
/// - the three-rung resize ladder (1600px/q0.5, 1024px/q0.45, 720px/q0.4),
///   mirroring `mobile/lib/photoUpload.ts`'s `prepareForUpload` exactly, so a
///   memory-pressure failure on a low-end device degrades to a smaller photo
///   rather than losing the evidence outright.
/// - its own folder name, `checklist_draft_photos/<draftKey>/`, DISTINCT from
///   the generic offline queue's own media folder. This is the exact
///   protection this port's brief calls out by name: a past attempt wrote a
///   checklist draft photo into the queue's folder, and the queue's own
///   orphan sweep deleted the operator's evidence on the very next sync
///   because a draft is not a queue entry. `MediaDao`'s own library comment
///   records the identical incident for the inspection draft.
///
/// # UNVERIFIED against real source
///
/// Same caveat as `inspection_photo_capture.dart`: there is no resolvable
/// pub cache in this environment, so `image_picker`'s exact named-parameter
/// surface is written against this project's best understanding of a
/// long-stable, widely-documented package API rather than against installed
/// source.
library;

import 'dart:io';

import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';

enum ChecklistPhotoSource { camera, gallery }

/// One captured, resized, durably-stored photo.
class CapturedChecklistPhoto {
  const CapturedChecklistPhoto({
    required this.localPath,
    required this.capturedAt,
    this.sizeBytes,
  });

  final String localPath;
  final DateTime capturedAt;
  final int? sizeBytes;
}

const List<({int maxDimension, int quality})> _kResizeLadder =
    <({int maxDimension, int quality})>[
  (maxDimension: 1600, quality: 50),
  (maxDimension: 1024, quality: 45),
  (maxDimension: 720, quality: 40),
];

/// Captures one photo for [fieldKey] on [draftKey] and copies it into a
/// durable, feature-owned folder.
///
/// Returns `null` when the user cancelled the picker - not an error, and
/// callers must not report a failure for it.
final class ChecklistPhotoCapture {
  ChecklistPhotoCapture({ImagePicker? picker})
      : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  Future<CapturedChecklistPhoto?> captureAndStore({
    required String draftKey,
    required String fieldKey,
    required ChecklistPhotoSource source,
  }) async {
    final ImageSource pickerSource = source == ChecklistPhotoSource.camera
        ? ImageSource.camera
        : ImageSource.gallery;

    XFile? picked;
    for (final ({int maxDimension, int quality}) rung in _kResizeLadder) {
      try {
        picked = await _picker.pickImage(
          source: pickerSource,
          maxWidth: rung.maxDimension.toDouble(),
          maxHeight: rung.maxDimension.toDouble(),
          imageQuality: rung.quality,
        );
        if (picked != null) break;
        // A null with no exception means the user cancelled - trying a
        // smaller rung would just show the same cancelled picker again.
        return null;
      } on Object {
        continue;
      }
    }
    if (picked == null) return null;

    final Directory folder = await _draftPhotoFolder(draftKey);
    final DateTime now = DateTime.now().toUtc();
    final String ext = _extensionOf(picked.name);
    final String fileName =
        '${_sanitise(fieldKey)}_${now.millisecondsSinceEpoch}$ext';
    final File destination = File(
      '${folder.path}${Platform.pathSeparator}$fileName',
    );

    await File(picked.path).copy(destination.path);
    int? sizeBytes;
    try {
      sizeBytes = await destination.length();
    } on Object {
      sizeBytes = null;
    }

    return CapturedChecklistPhoto(
      localPath: destination.path,
      capturedAt: now,
      sizeBytes: sizeBytes,
    );
  }

  Future<Directory> _draftPhotoFolder(String draftKey) async {
    final Directory base = await getApplicationDocumentsDirectory();
    final Directory folder = Directory(
      '${base.path}${Platform.pathSeparator}checklist_draft_photos'
      '${Platform.pathSeparator}${_sanitise(draftKey)}',
    );
    if (!folder.existsSync()) {
      await folder.create(recursive: true);
    }
    return folder;
  }

  static String _sanitise(String value) =>
      value.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');

  static String _extensionOf(String fileName) {
    final int dot = fileName.lastIndexOf('.');
    if (dot < 0 || dot == fileName.length - 1) return '.jpg';
    final String ext = fileName.substring(dot).toLowerCase();
    const Set<String> allowed = <String>{'.jpg', '.jpeg', '.png', '.heic'};
    return allowed.contains(ext) ? ext : '.jpg';
  }
}
