/// Providers for the physical inventory (discovery) screen.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/features/inventory/data/physical_capture_outbox.dart';
import 'package:tyre_pulse/features/inventory/data/physical_inventory_repository.dart';
import 'package:tyre_pulse/features/inventory/data/physical_outbox_runner.dart';
import 'package:tyre_pulse/features/inventory/domain/physical_capture.dart';

final Provider<PhysicalInventoryRepository>
    physicalInventoryRepositoryProvider = Provider<PhysicalInventoryRepository>(
  (Ref ref) => SupabasePhysicalInventoryRepository(
    ref.watch(supabaseClientProvider),
  ),
);

final Provider<PhysicalCaptureOutbox> physicalCaptureOutboxProvider =
    Provider<PhysicalCaptureOutbox>(
  (Ref ref) => buildDevicePhysicalOutbox(ref.watch(secureStoreProvider)),
);

final FutureProvider<List<PhysicalSession>> openPhysicalSessionsProvider =
    FutureProvider<List<PhysicalSession>>(
  (Ref ref) => ref.watch(physicalInventoryRepositoryProvider).openSessions(),
);

/// Existing stores for the store picker (never created from the phone).
final FutureProvider<List<InventoryPlace>> physicalStoresProvider =
    FutureProvider<List<InventoryPlace>>(
  (Ref ref) => ref.watch(physicalInventoryRepositoryProvider).stores(),
);
