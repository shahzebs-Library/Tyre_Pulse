/// Uploads a locally captured tyre-position photo to Supabase Storage and
/// returns its durable private-storage reference.
///
/// Path convention and bucket name (`tyre-photos`,
/// `inspections/<id>/<position>_<timestamp>.<ext>`) are transcribed
/// verbatim from `mobile/lib/photoUpload.ts`'s `uploadInspectionPhoto`, so
/// an inspection photo uploaded from either platform lands in the same
/// place under the same naming scheme.
library;

import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';

/// The bucket production's inspection photos live in. Not part of
/// `SupabaseTables` - that registry is table and RPC names; a storage
/// bucket is a distinct PostgREST-adjacent namespace this codebase has not
/// catalogued yet, so the literal is kept local to the one file that
/// needs it, exactly as `tyre_lookup_repository.dart` keeps its own
/// column-list constant local rather than inventing a shared registry
/// entry for a single caller.
const String inspectionPhotoBucket = 'tyre-photos';

abstract interface class InspectionPhotoUploader {
  /// Uploads the file at [localPath], for inspection [inspectionId] and
  /// tyre [position], and returns a durable private-storage reference. Throws
  /// [SupabaseFailure] on any failure.
  Future<String> upload({
    required String localPath,
    required String inspectionId,
    required String position,
  });
}

final class SupabaseInspectionPhotoUploader
    with SupabaseGateway
    implements InspectionPhotoUploader {
  SupabaseInspectionPhotoUploader(this._client);

  final SupabaseClient _client;

  @override
  Future<String> upload({
    required String localPath,
    required String inspectionId,
    required String position,
  }) {
    return guard<String>(() async {
      final File file = File(localPath);
      final String ext = _extensionOf(localPath);
      final String safePosition = position.replaceAll(
        RegExp(r'[^A-Za-z0-9_-]'),
        '_',
      );
      final String path = 'inspections/$inspectionId/'
          '${safePosition}_${DateTime.now().millisecondsSinceEpoch}$ext';

      await _client.storage
          .from(inspectionPhotoBucket)
          .upload(path, file, fileOptions: const FileOptions(upsert: true));

      return 'tp-storage://$inspectionPhotoBucket/$path';
    });
  }

  static String _extensionOf(String path) {
    final int dot = path.lastIndexOf('.');
    if (dot < 0) return '.jpg';
    final String ext = path.substring(dot).toLowerCase();
    const Set<String> allowed = <String>{'.jpg', '.jpeg', '.png'};
    return allowed.contains(ext) ? ext : '.jpg';
  }
}
