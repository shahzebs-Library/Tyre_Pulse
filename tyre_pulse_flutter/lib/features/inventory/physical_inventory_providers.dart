/// Providers for the physical inventory (discovery) screen.
library;

import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/features/inventory/data/count_photo_capture.dart';
import 'package:tyre_pulse/features/inventory/data/physical_capture_outbox.dart';
import 'package:tyre_pulse/features/inventory/data/physical_inventory_repository.dart';
import 'package:tyre_pulse/features/inventory/domain/physical_capture.dart';

final Provider<PhysicalInventoryRepository>
    physicalInventoryRepositoryProvider = Provider<PhysicalInventoryRepository>(
  (Ref ref) => SupabasePhysicalInventoryRepository(
    ref.watch(supabaseClientProvider),
  ),
);

Future<Uint8List?> _readFile(String path) async {
  try {
    final File f = File(path);
    if (!f.existsSync()) return null;
    return await f.readAsBytes();
  } on Object {
    return null;
  }
}

final Provider<PhysicalCaptureOutbox> physicalCaptureOutboxProvider =
    Provider<PhysicalCaptureOutbox>(
  (Ref ref) => PhysicalCaptureOutbox(
    ref.watch(secureStoreProvider),
    readBytes: _readFile,
    deleteFile: (String p) => CountPhotoCapture.discardUploaded(<String>[p]),
  ),
);

final FutureProvider<List<PhysicalSession>> openPhysicalSessionsProvider =
    FutureProvider<List<PhysicalSession>>(
  (Ref ref) => ref.watch(physicalInventoryRepositoryProvider).openSessions(),
);
