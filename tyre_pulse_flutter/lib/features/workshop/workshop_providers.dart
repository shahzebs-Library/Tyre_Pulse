/// Riverpod wiring for the Workshop Live Control technician screen.
///
/// Mirrors `features/washing/washing_providers.dart`: the
/// [QueuedCommandRepository] is declared per feature, over the one shared
/// `pending_commands` queue.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_gps_source.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_gps_fix.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_photo_capture.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_photo_uploader.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_repository.dart';
import 'package:tyre_pulse/features/workshop/domain/workshop_evidence.dart';

final Provider<QueuedCommandRepository>
    workshopQueuedCommandRepositoryProvider =
    Provider<QueuedCommandRepository>((ref) {
  final AppDatabase db = ref.watch(appDatabaseProvider);
  return QueuedCommandRepository(db.queueDao);
});

final Provider<WorkshopRepository> workshopRepositoryProvider =
    Provider<WorkshopRepository>(
  (ref) => SupabaseWorkshopRepository(
    ref.watch(supabaseClientProvider),
    ref.watch(workshopQueuedCommandRepositoryProvider),
  ),
);

/// Optional evidence photo capture (Report Problem / Request Parts).
final Provider<WorkshopPhotoPicker> workshopPhotoPickerProvider =
    Provider<WorkshopPhotoPicker>((ref) => ImagePickerWorkshopPhotoPicker());

final Provider<WorkshopPhotoUploader> workshopPhotoUploaderProvider =
    Provider<WorkshopPhotoUploader>(
  (ref) => SupabaseWorkshopPhotoUploader(ref.watch(supabaseClientProvider)),
);

/// Best-effort GPS, reusing the inspection feature's `geolocator` source
/// (the Flutter twin of mobile `captureInspectionLocation`, which the
/// mobile workshop screen also reuses). Never throws; a refusal or timeout
/// resolves to null.
final Provider<WorkshopLocator> workshopLocatorProvider =
    Provider<WorkshopLocator>((ref) {
  final InspectionGpsSource source = InspectionGpsSource();
  return () async {
    final GpsCaptureResult result = await source.captureFix();
    final InspectionGpsFix? fix = result.fix;
    if (result.status != InspectionGpsStatus.captured || fix == null) {
      return null;
    }
    return WorkshopGpsReading.tryCreate(fix.latitude, fix.longitude);
  };
});
