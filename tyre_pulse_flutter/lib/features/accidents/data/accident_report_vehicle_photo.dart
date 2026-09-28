/// The vehicle picture shown on the accident report's asset cards.
///
/// Order, identical to the web Vehicle 360 page and the fleet screens:
///
/// 1. the asset's OWN uploaded photo: `vehicle_fleet.image_path` in the
///    private `vehicle-photos` bucket (path `<org>/<COUNTRY>/<ASSET>/photo.<ext>`,
///    or a legacy `<ASSET>/photo.<ext>`), served through a short-lived signed
///    URL, never a public one;
/// 2. otherwise the class photo the shared fleet resolver
///    (`vehiclePhotoAsset`) picks from vehicle type plus make and model;
/// 3. otherwise an honest neutral placeholder, never a different vehicle.
///
/// Measured 2026-09-28: 0 of 1,622 fleet rows carry an `image_path`, so the
/// class photo is what renders today. The lookup is one bounded read for the
/// whole fleet (only rows WITH a photo), not one request per result card.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';

/// The private bucket the web uploads vehicle photos into.
const String accidentVehiclePhotoBucket = 'vehicle-photos';

/// Signed-URL lifetime, matching the web (`createSignedUrl(path, 3600)`).
const int accidentVehiclePhotoUrlTtlSeconds = 3600;

/// Upper bound on the photo index read. Photos are rare (0 today); the bound
/// only stops a future bulk upload from turning this into a table scan.
const int accidentVehiclePhotoIndexLimit = 1000;

/// What an asset card should draw.
@immutable
sealed class AccidentVehicleImage {
  const AccidentVehicleImage();
}

/// The asset's own uploaded photo, as a signed URL.
final class AccidentVehicleUploadedPhoto extends AccidentVehicleImage {
  const AccidentVehicleUploadedPhoto(this.url);
  final String url;
}

/// The bundled class photo for the asset's type, make and model.
final class AccidentVehicleClassPhoto extends AccidentVehicleImage {
  const AccidentVehicleClassPhoto(this.assetPath);
  final String assetPath;
}

/// No photo and no matching class: a neutral icon, never a wrong vehicle.
final class AccidentVehiclePlaceholder extends AccidentVehicleImage {
  const AccidentVehiclePlaceholder();
}

/// Applies the order above. Blank inputs count as absent.
AccidentVehicleImage resolveAccidentVehicleImage({
  String? uploadedUrl,
  String? classPhotoAsset,
}) {
  final String url = uploadedUrl?.trim() ?? '';
  if (url.isNotEmpty) return AccidentVehicleUploadedPhoto(url);
  final String art = classPhotoAsset?.trim() ?? '';
  if (art.isNotEmpty) return AccidentVehicleClassPhoto(art);
  return const AccidentVehiclePlaceholder();
}

/// Reads uploaded vehicle photos.
abstract interface class AccidentVehiclePhotoSource {
  /// `vehicle_fleet.id` -> stored `image_path`, for rows that have one.
  Future<Map<String, String>> uploadedPhotoPaths();

  /// A short-lived signed URL for a stored path.
  Future<String> signedUrl(String path);
}

final class SupabaseAccidentVehiclePhotoSource
    implements AccidentVehiclePhotoSource {
  const SupabaseAccidentVehiclePhotoSource(this._client);

  final SupabaseClient _client;

  @override
  Future<Map<String, String>> uploadedPhotoPaths() async {
    final List<Map<String, dynamic>> rows = await _client
        .from(SupabaseTables.vehicleFleet)
        .select('id,image_path')
        .not('image_path', 'is', null)
        .order('id')
        .limit(accidentVehiclePhotoIndexLimit);
    final Map<String, String> paths = <String, String>{};
    for (final Map<String, dynamic> row in rows) {
      final Object? id = row['id'];
      final Object? path = row['image_path'];
      if (id == null || path is! String || path.trim().isEmpty) continue;
      paths[id.toString()] = path.trim();
    }
    return paths;
  }

  @override
  Future<String> signedUrl(String path) => _client.storage
      .from(accidentVehiclePhotoBucket)
      .createSignedUrl(path, accidentVehiclePhotoUrlTtlSeconds);
}

final accidentVehiclePhotoSourceProvider = Provider<AccidentVehiclePhotoSource>(
  (ref) => SupabaseAccidentVehiclePhotoSource(
    ref.watch(supabaseClientProvider),
  ),
);

/// Which fleet rows have an uploaded photo. A failed read (offline, RLS)
/// surfaces as an error state and the card falls back to the class photo,
/// which is the documented second rung, not a swallowed failure.
///
/// Automatic retry is off: the class photo is already on screen, so a retry
/// loop would only spend a field user's data on a cosmetic upgrade.
final accidentVehiclePhotoPathsProvider = FutureProvider<Map<String, String>>(
  (ref) => ref.watch(accidentVehiclePhotoSourceProvider).uploadedPhotoPaths(),
  retry: (int retryCount, Object error) => null,
);

/// The signed URL of one vehicle's uploaded photo, or null when it has none.
final accidentUploadedVehiclePhotoUrlProvider =
    FutureProvider.autoDispose.family<String?, String>(
  (ref, vehicleId) async {
    final Map<String, String> paths =
        await ref.watch(accidentVehiclePhotoPathsProvider.future);
    final String? path = paths[vehicleId];
    if (path == null) return null;
    return ref.watch(accidentVehiclePhotoSourceProvider).signedUrl(path);
  },
  retry: (int retryCount, Object error) => null,
);
