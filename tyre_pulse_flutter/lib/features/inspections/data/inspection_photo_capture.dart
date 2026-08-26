/// Captures a tyre-position photo and copies it into this feature's own
/// durable draft-photo folder.
///
/// # Package choice, and what was deliberately NOT added
///
/// [image_picker] is the package chosen for camera and gallery capture -
/// the standard, actively-maintained Flutter package for exactly this
/// need, and the one this feature's task brief pre-authorises ("camera/
/// photo capture... you are explicitly authorized to add well-established,
/// widely-used packages for these").
///
/// A SEPARATE image-compression package (`flutter_image_compress` and
/// similar) was deliberately NOT added. `image_picker`'s own `pickImage`
/// already accepts `maxWidth` and `imageQuality`, which together resize
/// AND compress in one native call - there is nothing a second package
/// would add for this feature's actual need (a still photo of a tyre,
/// not a video or a raw-format workflow). Spec section 64's "do not add a
/// package to shorten five lines" is exactly on point here.
///
/// # The resize ladder
///
/// Mirrors `mobile/lib/photoUpload.ts`'s `prepareForUpload` three-rung
/// ladder (1600px/q0.5, then 1024px/q0.45, then 720px/q0.4) and its stated
/// reason: "a single failed resize used to fall back to the ORIGINAL
/// multi-megapixel file... real evidence lost on a 13-photo inspection."
/// [captureAndStore] tries each rung until one produces a file, and only
/// gives up after all three attempts genuinely fail.
///
/// # UNVERIFIED against real source
///
/// There is no Flutter SDK or resolvable pub cache in this environment
/// (artifact/risk R1), so the exact named-parameter surface of
/// `image_picker: ^1.x`'s `ImagePicker.pickImage` (`source`, `maxWidth`,
/// `maxHeight`, `imageQuality`, `preferredCameraDevice`) is written
/// against this project's best understanding of a long-stable,
/// widely-documented package API rather than against installed source -
/// exactly the same caveat `background_sync.dart` already carries for
/// `workmanager`/`connectivity_plus`. Should CI report a compile error in
/// this file, this parameter list is the first place to check.
library;

import 'dart:io';

import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';

/// Where a photo should come from.
enum PhotoCaptureSource { camera, gallery }

/// One captured, resized, durably-stored photo.
class CapturedPhoto {
  const CapturedPhoto({
    required this.localPath,
    required this.capturedAt,
    this.sizeBytes,
  });

  final String localPath;
  final DateTime capturedAt;
  final int? sizeBytes;
}

/// The resize ladder. Each rung is tried in order; the first one that
/// produces a picked file wins. Mirrors `mobile/lib/photoUpload.ts`
/// exactly - see the library comment.
const List<({int maxDimension, int quality})> _kResizeLadder =
    <({int maxDimension, int quality})>[
  (maxDimension: 1600, quality: 50),
  (maxDimension: 1024, quality: 45),
  (maxDimension: 720, quality: 40),
];

/// Captures one photo and copies it into a durable, feature-owned folder.
///
/// The folder is `inspection_draft_photos/<draftKey>/` under the app's
/// documents directory - deliberately its OWN name, distinct from any
/// folder the shared offline-queue media system uses
/// (`lib/core/database/dao/media_dao.dart`'s own library comment records
/// the exact defect class this avoids: a draft's photos sharing a folder
/// with the generic queue sweep, which then deletes them on the very next
/// sync because a draft is not a queue entry).
///
/// Returns null when the user cancelled the picker - not an error, and
/// callers must not report a failure for it.
final class InspectionPhotoCapture {
  InspectionPhotoCapture({ImagePicker? picker})
      : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  Future<CapturedPhoto?> captureAndStore({
    required String draftKey,
    required String position,
    required PhotoCaptureSource source,
  }) async {
    final ImageSource pickerSource =
        source == PhotoCaptureSource.camera
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
        // A null with no exception means the user cancelled the picker -
        // trying a smaller rung would just show the same cancelled
        // picker again, so stop rather than looping.
        return null;
      } on Object {
        // This rung failed (typically memory pressure on a low-end
        // device, the same failure mode `photoUpload.ts` documents) - the
        // loop tries the next, smaller rung rather than falling back to
        // an unresized original.
        continue;
      }
    }
    if (picked == null) return null;

    final Directory folder = await _draftPhotoFolder(draftKey);
    final DateTime now = DateTime.now().toUtc();
    final String ext = _extensionOf(picked.name);
    final String fileName =
        '${_sanitise(position)}_${now.millisecondsSinceEpoch}$ext';
    final File destination =
        File('${folder.path}${Platform.pathSeparator}$fileName');

    await File(picked.path).copy(destination.path);
    int? sizeBytes;
    try {
      sizeBytes = await destination.length();
    } on Object {
      sizeBytes = null;
    }

    return CapturedPhoto(
      localPath: destination.path,
      capturedAt: now,
      sizeBytes: sizeBytes,
    );
  }

  Future<Directory> _draftPhotoFolder(String draftKey) async {
    final Directory base = await getApplicationDocumentsDirectory();
    final Directory folder = Directory(
      '${base.path}${Platform.pathSeparator}inspection_draft_photos'
      '${Platform.pathSeparator}${_sanitise(draftKey)}',
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
