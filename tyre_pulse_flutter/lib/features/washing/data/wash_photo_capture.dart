/// Captures a wash photo and copies it into this feature's own durable
/// folder.
///
/// A close mirror of `features/meter_logs/data/meter_log_photo_capture.dart`
/// (itself a mirror of `features/inspections/data/inspection_photo_capture
/// .dart` and `features/checklists/data/checklist_photo_capture.dart`) - see
/// that file's own library comment for the full reasoning, which carries
/// over verbatim: `image_picker` only (its own resize/quality parameters do
/// the work a separate compression package would otherwise be added for),
/// the same three-rung resize ladder mirroring `mobile/lib/photoUpload.ts`,
/// and this feature's OWN folder name (`wash_draft_photos/<sessionKey>/`),
/// distinct from every other feature's draft-photo folder and from the
/// generic offline queue's own media folder.
///
/// Unlike the meter-log slots (exactly one odometer photo, one optional
/// hour-meter photo), a wash record carries up to
/// [WashPhotoCapture.maxPhotos] photos in a flat, orderable list - mirroring
/// `mobile/app/(app)/washing.tsx`'s own `<PhotoCapture ... max={6} />`. This
/// class therefore identifies each captured file by its POSITION in that
/// list ([orderIndex]) rather than by a fixed named slot.
///
/// # No persisted, multi-day draft here
///
/// Same disclosed simplification as the meter-log capture: the reference
/// washing screen holds its photo list in plain in-memory state with no
/// cross-app-restart resume story, so there is no `checklist_drafts`-style
/// bookkeeping table behind [sessionKey] here either - see
/// `meter_log_photo_capture.dart`'s own library comment for the residue this
/// accepts (an abandoned capture leaves one small file on disk, referenced
/// by nothing) and why it is a materially smaller risk than the
/// inspection/checklist case that motivated their own draft/sweep machinery.
///
/// # UNVERIFIED against real source
///
/// Same caveat as the files this mirrors: there is no resolvable pub cache
/// in this environment, so `image_picker`'s exact named-parameter surface is
/// written against this project's best understanding of a long-stable,
/// widely-documented package API rather than against installed source.
library;

import 'dart:io';

import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';

enum WashPhotoSource { camera, gallery }

/// One captured, resized, durably-stored photo.
final class CapturedWashPhoto {
  const CapturedWashPhoto({
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

/// Captures one wash photo for [sessionKey] and copies it into a durable,
/// feature-owned folder.
///
/// Returns `null` when the user cancelled the picker - not an error, and
/// callers must not report a failure for it.
final class WashPhotoCapture {
  WashPhotoCapture({ImagePicker? picker}) : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  /// Mirrors `mobile/app/(app)/washing.tsx`'s own `max={6}`.
  static const int maxPhotos = 6;

  Future<CapturedWashPhoto?> captureAndStore({
    required String sessionKey,
    required int orderIndex,
    required WashPhotoSource source,
  }) async {
    final ImageSource pickerSource = source == WashPhotoSource.camera
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
        return null;
      } on Object {
        continue;
      }
    }
    if (picked == null) return null;

    final Directory folder = await _sessionPhotoFolder(sessionKey);
    final DateTime now = DateTime.now().toUtc();
    final String ext = _extensionOf(picked.name);
    final String fileName =
        'wash_${orderIndex}_${now.millisecondsSinceEpoch}$ext';
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

    return CapturedWashPhoto(
      localPath: destination.path,
      capturedAt: now,
      sizeBytes: sizeBytes,
    );
  }

  Future<Directory> _sessionPhotoFolder(String sessionKey) async {
    final Directory base = await getApplicationDocumentsDirectory();
    final Directory folder = Directory(
      '${base.path}${Platform.pathSeparator}wash_draft_photos'
      '${Platform.pathSeparator}${_sanitise(sessionKey)}',
    );
    if (!await folder.exists()) {
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
