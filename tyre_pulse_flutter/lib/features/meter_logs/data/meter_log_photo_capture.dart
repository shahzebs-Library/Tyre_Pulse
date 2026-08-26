/// Captures a gauge photo (odometer or engine-hour meter) and copies it into
/// this feature's own durable folder.
///
/// A close mirror of `features/inspections/data/inspection_photo_capture.dart`
/// and `features/checklists/data/checklist_photo_capture.dart` (read there,
/// never imported from here - each top-level feature owns its own copy of
/// this small, self-contained technique per this port's boundary rules, for
/// the same reason `inspection_approval_signature_pad.dart`'s own library
/// comment gives for the equivalent choice about signature pads). The same
/// three decisions carry over verbatim, for the same reasons:
///
/// - `image_picker` only, no separate compression package - `pickImage`'s
///   own `maxWidth`/`maxHeight`/`imageQuality` already resize and compress
///   in one native call.
/// - the three-rung resize ladder (1600px/q0.5, 1024px/q0.45, 720px/q0.4),
///   mirroring `mobile/lib/photoUpload.ts`'s `prepareForUpload` exactly, so
///   a memory-pressure failure on a low-end device degrades to a smaller
///   photo rather than losing the evidence outright.
/// - its own folder name, `meter_log_draft_photos/<sessionKey>/`, DISTINCT
///   from the generic offline queue's own media folder and from every other
///   feature's draft-photo folder - the exact protection this port's brief
///   calls out by name: a draft photo sharing a folder with the queue's own
///   sweep gets deleted on the very next sync because a draft is not a
///   queue entry.
///
/// # No persisted, multi-day draft here - a narrower, disclosed simplification
///
/// Unlike the inspection and checklist drafts, a meter reading is a single,
/// short-lived in-memory form with no cross-app-restart resume story in the
/// reference screen (`mobile/app/(app)/meter-logs.tsx` holds its photo state
/// in plain `useState`, never persisted). So [sessionKey] here is minted
/// once per screen visit (see `MeterLogScreen`), not looked up against a
/// `checklist_drafts`-style bookkeeping table, and there is no
/// `discardDraft` step: once a photo is handed to
/// `QueuedCommandRepository.enqueue` as a [QueuedMediaAttachment], ownership
/// moves to the offline queue exactly as `checklist_submission_repository
/// .dart`'s own library comment describes ("draft folder -> queue, never
/// both"), and the file is never deleted from here again. A photo captured
/// and then abandoned (the screen is left without pressing Save) is a
/// genuine, disclosed residue of this simplification: it stays on disk,
/// referenced by nothing, until the OS or a future sweep reclaims it. That
/// is a materially smaller risk than the inspection/checklist case that
/// motivated their own draft/sweep machinery, because there the very same
/// mechanism protects days of unsynced field work; here it is at most one
/// small compressed image from a form the user chose not to submit.
///
/// # UNVERIFIED against real source
///
/// Same caveat as the two mirrored files: there is no resolvable pub cache
/// in this environment, so `image_picker`'s exact named-parameter surface is
/// written against this project's best understanding of a long-stable,
/// widely-documented package API rather than against installed source.
library;

import 'dart:io';

import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';

enum MeterLogPhotoSource { camera, gallery }

/// One captured, resized, durably-stored photo.
final class CapturedMeterLogPhoto {
  const CapturedMeterLogPhoto({
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

/// Captures one gauge photo for [sessionKey] and copies it into a durable,
/// feature-owned folder.
///
/// [slot] distinguishes the odometer photo from the engine-hours photo
/// within the same session, so the two can never collide on disk.
///
/// Returns `null` when the user cancelled the picker - not an error, and
/// callers must not report a failure for it.
final class MeterLogPhotoCapture {
  MeterLogPhotoCapture({ImagePicker? picker})
      : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  Future<CapturedMeterLogPhoto?> captureAndStore({
    required String sessionKey,
    required String slot,
    required MeterLogPhotoSource source,
  }) async {
    final ImageSource pickerSource = source == MeterLogPhotoSource.camera
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
        '${_sanitise(slot)}_${now.millisecondsSinceEpoch}$ext';
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

    return CapturedMeterLogPhoto(
      localPath: destination.path,
      capturedAt: now,
      sizeBytes: sizeBytes,
    );
  }

  Future<Directory> _sessionPhotoFolder(String sessionKey) async {
    final Directory base = await getApplicationDocumentsDirectory();
    final Directory folder = Directory(
      '${base.path}${Platform.pathSeparator}meter_log_draft_photos'
      '${Platform.pathSeparator}${_sanitise(sessionKey)}',
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
