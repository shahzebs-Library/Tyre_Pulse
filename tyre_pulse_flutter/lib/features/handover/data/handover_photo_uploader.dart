/// Uploads a locally captured handover photo to Supabase Storage and returns
/// its durable private-storage reference.
///
/// Uses the same verified private bucket as inspection evidence
/// (`tyre-photos`), under a `handover/<id>/...` path, so a handover photo lands
/// in a bucket whose authenticated per-member upload policy is already live
/// (`supabase/migrations/20260930120002_storage_photo_write_scope.sql` lists
/// `tyre-photos`). The returned reference is `tp-storage://tyre-photos/<path>`,
/// resolved to a short-lived signed URL at read time by the shared
/// `privateStorageImageUrlProvider`.
library;

import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';

/// The private bucket handover photos live in, shared with inspection evidence.
/// A storage bucket is a distinct namespace this codebase keeps local to the
/// file that needs it, exactly as `inspection_photo_uploader.dart` does.
const String handoverPhotoBucket = 'tyre-photos';

abstract interface class HandoverPhotoUploader {
  /// Uploads the file at [localPath] for handover [handoverId] under an
  /// optional [slot] (for example a damage marker's view), returning a durable
  /// private-storage reference. Throws [SupabaseFailure] on any failure.
  Future<String> upload({
    required String localPath,
    required String handoverId,
    String slot = 'photo',
  });
}

final class SupabaseHandoverPhotoUploader
    with SupabaseGateway
    implements HandoverPhotoUploader {
  SupabaseHandoverPhotoUploader(this._client);

  final SupabaseClient _client;

  @override
  Future<String> upload({
    required String localPath,
    required String handoverId,
    String slot = 'photo',
  }) {
    return guard<String>(() async {
      final File file = File(localPath);
      final String ext = _extensionOf(localPath);
      final String safeSlot = slot.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
      final String path = 'handover/$handoverId/'
          '${safeSlot}_${DateTime.now().millisecondsSinceEpoch}$ext';

      await _client.storage
          .from(handoverPhotoBucket)
          .upload(path, file, fileOptions: const FileOptions(upsert: true));

      return 'tp-storage://$handoverPhotoBucket/$path';
    });
  }

  static String _extensionOf(String path) {
    final int dot = path.lastIndexOf('.');
    if (dot < 0) return '.jpg';
    final String ext = path.substring(dot).toLowerCase();
    const Set<String> allowed = <String>{'.jpg', '.jpeg', '.png', '.webp'};
    return allowed.contains(ext) ? ext : '.jpg';
  }
}
