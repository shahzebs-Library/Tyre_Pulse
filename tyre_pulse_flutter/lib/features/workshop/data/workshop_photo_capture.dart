/// Captures an optional workshop photo (Report Problem / Request Parts) and
/// copies it into this feature's own folder.
///
/// A close mirror of `features/washing/data/wash_photo_capture.dart` (itself
/// a mirror of the inspection/checklist/meter-log capture classes - see
/// their library comments for the full reasoning, which carries over):
/// `image_picker` only, with the same three-rung resize/quality ladder that
/// mirrors `mobile/lib/photoUpload.ts` `prepareForUpload`, so a photo is
/// already compressed before it is ever uploaded. The folder name
/// (`workshop_photos/`) is distinct from every other feature's.
///
/// Exposed through the [WorkshopPhotoPicker] interface so the screen can be
/// widget-tested without a platform picker.
///
/// # UNVERIFIED against real source
///
/// Same caveat as the files this mirrors: `image_picker`'s named-parameter
/// surface is written against its long-stable public API.
library;

import 'dart:io';

import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';

enum WorkshopPhotoSource { camera, gallery }

abstract interface class WorkshopPhotoPicker {
  /// Returns the durable local path of one captured, compressed photo, or
  /// `null` when the user cancelled (not an error).
  Future<String?> capture(WorkshopPhotoSource source);

  /// Removes a local copy once it is no longer needed (uploaded, or
  /// discarded by the technician). Never throws.
  Future<void> discard(String localPath);
}

const List<({int maxDimension, int quality})> _kResizeLadder =
    <({int maxDimension, int quality})>[
  (maxDimension: 1600, quality: 50),
  (maxDimension: 1024, quality: 45),
  (maxDimension: 720, quality: 40),
];

final class ImagePickerWorkshopPhotoPicker implements WorkshopPhotoPicker {
  ImagePickerWorkshopPhotoPicker({ImagePicker? picker})
      : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  @override
  Future<String?> capture(WorkshopPhotoSource source) async {
    final ImageSource pickerSource = source == WorkshopPhotoSource.camera
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

    final Directory base = await getApplicationDocumentsDirectory();
    final Directory folder = Directory(
      '${base.path}${Platform.pathSeparator}workshop_photos',
    );
    if (!folder.existsSync()) await folder.create(recursive: true);
    final String ext = workshopPhotoExtension(picked.name);
    final File destination = File(
      '${folder.path}${Platform.pathSeparator}'
      'workshop_${DateTime.now().toUtc().millisecondsSinceEpoch}$ext',
    );
    await File(picked.path).copy(destination.path);
    return destination.path;
  }

  @override
  Future<void> discard(String localPath) async {
    try {
      final File f = File(localPath);
      if (f.existsSync()) await f.delete();
    } on Object {
      // A leftover file is residue, not a failure worth surfacing.
    }
  }
}

/// `.jpg` / `.jpeg` / `.png` / `.heic` kept, anything else becomes `.jpg`
/// (mobile `ALLOWED_EXTS`, lower-cased).
String workshopPhotoExtension(String fileName) {
  final int dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot == fileName.length - 1) return '.jpg';
  final String ext = fileName.substring(dot).toLowerCase();
  const Set<String> allowed = <String>{'.jpg', '.jpeg', '.png', '.heic'};
  return allowed.contains(ext) ? ext : '.jpg';
}
