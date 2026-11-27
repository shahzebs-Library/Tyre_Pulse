/// Providers for the physical inventory (discovery) screen.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
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

/// Physical inventory captures (Stock Count Matches / Doesn't match / Count,
/// Add stock, discovery captures) still waiting on THIS phone for the
/// signed-in person, live. They sit in their own encrypted outbox, not in
/// `pending_commands`, so Home's and Profile's "Pending sync" add this in;
/// without it a count saved offline read as "0 pending" (field report
/// 2026-11-27). A storage read failure stays an error (the screen shows "-"),
/// never 0.
final StreamProvider<int> physicalOutboxPendingCountProvider =
    StreamProvider<int>((Ref ref) async* {
  final String? userId =
      ref.watch(workspaceContextProvider.select((ctx) => ctx?.userId));
  if (userId == null) {
    yield 0;
    return;
  }
  final PhysicalCaptureOutbox outbox = ref.watch(physicalCaptureOutboxProvider);
  yield await outbox.pendingCount(userId);
  await for (final void _ in outbox.changes) {
    yield await outbox.pendingCount(userId);
  }
});

final FutureProvider<List<PhysicalSession>> openPhysicalSessionsProvider =
    FutureProvider<List<PhysicalSession>>(
  (Ref ref) => ref.watch(physicalInventoryRepositoryProvider).openSessions(),
);

/// Existing stores for the store picker (never created from the phone).
final FutureProvider<List<InventoryPlace>> physicalStoresProvider =
    FutureProvider<List<InventoryPlace>>(
  (Ref ref) => ref.watch(physicalInventoryRepositoryProvider).stores(),
);
