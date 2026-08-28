library;

import 'dart:io';

import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';

enum RcaPhotoSource { camera, gallery }

final class RcaPhotoCapture {
  RcaPhotoCapture({ImagePicker? picker}) : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;
  static const int maxPhotos = 6;

  Future<String?> captureAndStore({
    required String sessionKey,
    required int index,
    required RcaPhotoSource source,
  }) async {
    final XFile? file = await _picker.pickImage(
      source: source == RcaPhotoSource.camera
          ? ImageSource.camera
          : ImageSource.gallery,
      maxWidth: 1600,
      maxHeight: 1600,
      imageQuality: 50,
    );
    if (file == null) return null;
    final Directory base = await getApplicationDocumentsDirectory();
    final Directory folder = Directory(
      '${base.path}${Platform.pathSeparator}rca_draft_photos'
      '${Platform.pathSeparator}${sessionKey.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_')}',
    );
    await folder.create(recursive: true);
    final String path = '${folder.path}${Platform.pathSeparator}rca_${index}_'
        '${DateTime.now().toUtc().millisecondsSinceEpoch}.jpg';
    await File(file.path).copy(path);
    return path;
  }
}
