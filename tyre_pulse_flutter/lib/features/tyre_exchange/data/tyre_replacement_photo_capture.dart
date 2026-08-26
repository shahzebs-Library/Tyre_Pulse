/// Captures a tyre-replacement photo and copies it into this feature's own
/// durable folder.
///
/// A close mirror of `features/washing/data/wash_photo_capture.dart`
/// (itself a mirror of `features/meter_logs/data/meter_log_photo_capture
/// .dart`, `features/inspections/data/inspection_photo_capture.dart` and
/// `features/checklists/data/checklist_photo_capture.dart`) - see those
/// files' own library comments for the full reasoning, which carries over
/// verbatim: `image_picker` only (its own resize/quality parameters do the
/// work a separate compression package would otherwise be added for), the
/// same three-rung resize ladder mirroring `mobile/lib/photoUpload.ts`'s
/// `prepareForUpload`, and this feature's OWN folder name
/// (`tyre_change_draft_photos/<sessionKey>/`), distinct from every other
/// feature's draft-photo folder and from the generic offline queue's own
/// media folder - the exact protection this port's brief calls out by
/// name: a draft photo sharing a folder with the queue's own sweep gets
/// deleted on the very next sync because a draft is not a queue entry.
///
/// Like washing's own photo set (and unlike the meter-log's two fixed
/// slots), a tyre replacement carries up to [TyreReplacementPhotoCapture
/// .maxPhotos] photos in a flat, orderable list - mirroring
/// `mobile/app/(app)/tyre-change.tsx`'s own bare `<PhotoCapture value=
/// {photos} onChange={setPhotos} module="tyre-change" .../>`, which takes
/// NO explicit `max` prop and so falls back to `PhotoCapture`'s own default
/// of 6 (`mobile/components/PhotoCapture.tsx`, `max = 6`) - the same
/// default `WashPhotoCapture.maxPhotos` already uses.
///
/// # No persisted, multi-day draft here
///
/// Same disclosed simplification as the wash and meter-log captures: the
/// reference tyre-change screen holds its photo list in plain in-memory
/// `useState` with no cross-app-restart resume story, so there is no
/// `checklist_drafts`-style bookkeeping table behind [sessionKey] here
/// either - see `meter_log_photo_capture.dart`'s own library comment for
/// the residue this accepts (an abandoned capture leaves one small file on
/// disk, referenced by nothing) and why it is a materially smaller risk
/// than the inspection/checklist case that motivated their own draft/sweep
/// machinery.
///
/// # UNVERIFIED against real source
///
/// Same caveat as the files this mirrors: there is no resolvable pub cache
/// in this environment, so `image_picker`'s exact named-parameter surface
/// is written against this project's best understanding of a long-stable,
/// widely-documented package API rather than against installed source.
library;

import 'dart:io';

import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';

enum TyreReplacementPhotoSource { camera, gallery }

/// One captured, resized, durably-stored photo.
final class CapturedTyreReplacementPhoto {
  const CapturedTyreReplacementPhoto({
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

/// Captures one tyre-replacement photo for [sessionKey] and copies it into
/// a durable, feature-owned folder.
///
/// Returns `null` when the user cancelled the picker - not an error, and
/// callers must not report a failure for it.
final class TyreReplacementPhotoCapture {
  TyreReplacementPhotoCapture({ImagePicker? picker})
      : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  /// Mirrors `PhotoCapture`'s own default of 6 - see the library comment.
  static const int maxPhotos = 6;

  Future<CapturedTyreReplacementPhoto?> captureAndStore({
    required String sessionKey,
    required int orderIndex,
    required TyreReplacementPhotoSource source,
  }) async {
    final ImageSource pickerSource = source == TyreReplacementPhotoSource.camera
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

    final Directory folder = await _sessionPhotoFolder(sessionKey);
    final DateTime now = DateTime.now().toUtc();
    final String ext = _extensionOf(picked.name);
    final String fileName =
        'tyre_${orderIndex}_${now.millisecondsSinceEpoch}$ext';
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

    return CapturedTyreReplacementPhoto(
      localPath: destination.path,
      capturedAt: now,
      sizeBytes: sizeBytes,
    );
  }

  Future<Directory> _sessionPhotoFolder(String sessionKey) async {
    final Directory base = await getApplicationDocumentsDirectory();
    final Directory folder = Directory(
      '${base.path}${Platform.pathSeparator}tyre_change_draft_photos'
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
