/// Uploads workshop evidence photos and returns their permanent
/// `tp-storage://` references.
///
/// Port of `mobile/lib/photoUpload.ts` `uploadModulePhoto(uri, 'workshop', i)`
/// + `mobile/lib/workshopApi.ts` `resolveWorkshopPhotos` (READ-ONLY
/// reference): bucket `tyre-photos`, path
/// `modules/workshop/<first 8 of user id>/<ms>_<index>_<rand>.<ext>`,
/// no upsert - so a photo from either platform lands in the same place.
///
/// # Why the upload happens at record time, not through the queue
///
/// `tech_activity_events` has no photos column; the refs are folded into
/// `note` (see `workshop_evidence.dart`). The shared offline queue can only
/// substitute uploaded media into a command whose spec declares it
/// (`requiresMediaReady`), and `WORKSHOP_EVENT`'s spec does not - changing
/// that is an edit to `command_registry.dart` / `sync_engine.dart`, which
/// AGENTS.md reserves for a human. So this mirrors mobile exactly: upload
/// now; a photo that cannot upload (offline, error) is DROPPED from the
/// result and the event still records with its text note. The caller is
/// told how many were dropped so it can say so honestly - the EVENT is
/// never lost, only the photo.
library;

import 'dart:io';
import 'dart:math' as math;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';

/// Same bucket as `inspection_photo_uploader.dart` / mobile `photoUpload.ts`.
const String workshopPhotoBucket = 'tyre-photos';

abstract interface class WorkshopPhotoUploader {
  /// Uploads [localPath] and returns its `tp-storage://` reference. Throws on
  /// any failure.
  Future<String> upload({
    required String localPath,
    required String userId,
    required int index,
  });
}

/// Builds the storage object path, mirroring mobile `uploadModulePhoto`.
String workshopPhotoObjectPath({
  required String userId,
  required String localPath,
  required int index,
  required int epochMs,
  required String rand,
}) {
  final String uid =
      userId.isEmpty ? 'anon' : userId.substring(0, math.min(8, userId.length));
  final String lower = localPath.toLowerCase();
  // HEIC/HEIF are stored as jpg, exactly as mobile maps them.
  final String ext = lower.endsWith('.png') ? 'png' : 'jpg';
  return 'modules/workshop/$uid/${epochMs}_${index}_$rand.$ext';
}

final class SupabaseWorkshopPhotoUploader
    with SupabaseGateway
    implements WorkshopPhotoUploader {
  SupabaseWorkshopPhotoUploader(this._client);

  final SupabaseClient _client;
  static final math.Random _random = math.Random();

  @override
  Future<String> upload({
    required String localPath,
    required String userId,
    required int index,
  }) {
    return guard<String>(() async {
      final String rand = _random.nextInt(0x7fffffff).toRadixString(36);
      final String path = workshopPhotoObjectPath(
        userId: userId,
        localPath: localPath,
        index: index,
        epochMs: DateTime.now().millisecondsSinceEpoch,
        rand: rand.substring(0, math.min(4, rand.length)),
      );
      await _client.storage.from(workshopPhotoBucket).upload(
            path,
            File(localPath),
            fileOptions: FileOptions(
              upsert: false,
              contentType: path.endsWith('.png') ? 'image/png' : 'image/jpeg',
            ),
          );
      return 'tp-storage://$workshopPhotoBucket/$path';
    });
  }
}

/// The outcome of resolving a set of local photos.
final class WorkshopPhotoResolution {
  const WorkshopPhotoResolution({
    required this.refs,
    required this.dropped,
    this.uploadedLocalPaths = const <String>[],
  });

  /// Permanent references, in the original order.
  final List<String> refs;

  /// How many local photos could not be uploaded and were dropped.
  final int dropped;

  /// Local files the server confirmed - the only ones safe to delete.
  final List<String> uploadedLocalPaths;
}

/// Mirrors mobile `resolveWorkshopPhotos`: already-permanent refs pass
/// through; each local path is uploaded; a failure drops only that photo.
/// Never throws.
Future<WorkshopPhotoResolution> resolveWorkshopPhotos({
  required WorkshopPhotoUploader uploader,
  required List<String> photos,
  required String userId,
}) async {
  final List<String> refs = <String>[];
  final List<String> uploaded = <String>[];
  int dropped = 0;
  for (int i = 0; i < photos.length; i++) {
    final String p = photos[i].trim();
    if (p.isEmpty) continue;
    if (p.startsWith('tp-storage://') ||
        p.startsWith('http://') ||
        p.startsWith('https://')) {
      refs.add(p);
      continue;
    }
    try {
      refs.add(await uploader.upload(localPath: p, userId: userId, index: i));
      uploaded.add(p);
    } on Object {
      dropped++;
    }
  }
  return WorkshopPhotoResolution(
    refs: refs,
    dropped: dropped,
    uploadedLocalPaths: uploaded,
  );
}
