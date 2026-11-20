library;

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show FutureProviderFamily;
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/features/inventory/data/count_draft_store.dart';
import 'package:tyre_pulse/features/inventory/data/count_finisher.dart';
import 'package:tyre_pulse/features/inventory/data/count_photo_capture.dart';
import 'package:tyre_pulse/features/inventory/data/count_submitter.dart';
import 'package:tyre_pulse/features/inventory/data/inventory_audit_repository.dart';
import 'package:tyre_pulse/features/inventory/data/inventory_transfer_repository.dart';
import 'package:tyre_pulse/features/inventory/domain/count_models.dart';
import 'package:tyre_pulse/features/inventory/domain/transfer_models.dart';
import 'package:uuid/uuid.dart';

final Provider<InventoryAuditRepository> inventoryAuditRepositoryProvider =
    Provider<InventoryAuditRepository>(
  (Ref ref) => SupabaseInventoryAuditRepository(
    ref.watch(supabaseClientProvider),
  ),
);

final Provider<InventoryTransferRepository>
    inventoryTransferRepositoryProvider = Provider<InventoryTransferRepository>(
  (Ref ref) => SupabaseInventoryTransferRepository(
    ref.watch(supabaseClientProvider),
  ),
);

final Provider<CountDraftStore> countDraftStoreProvider =
    Provider<CountDraftStore>(
  (Ref ref) => CountDraftStore(ref.watch(secureStoreProvider)),
);

final Provider<CountPhotoCapture> countPhotoCaptureProvider =
    Provider<CountPhotoCapture>((Ref ref) => CountPhotoCapture());

final Provider<CountSubmitter> countSubmitterProvider =
    Provider<CountSubmitter>(
  (Ref ref) => CountSubmitter(
    repository: ref.watch(inventoryAuditRepositoryProvider),
    drafts: ref.watch(countDraftStoreProvider),
    discardPhotos: CountPhotoCapture.discardUploaded,
  ),
);

/// True when the device reports any network. Overridden in tests.
final Provider<Future<bool> Function()> inventoryOnlineCheckProvider =
    Provider<Future<bool> Function()>(
  (Ref ref) => () async {
    final List<ConnectivityResult> results =
        await Connectivity().checkConnectivity();
    return results.any((ConnectivityResult r) => r != ConnectivityResult.none);
  },
);

final Provider<CountFinisher> countFinisherProvider = Provider<CountFinisher>(
  (Ref ref) => CountFinisher(
    repository: ref.watch(inventoryAuditRepositoryProvider),
    isOnline: ref.watch(inventoryOnlineCheckProvider),
  ),
);

/// Mints client ids for count lines and idempotency keys.
final Provider<String Function()> inventoryIdFactoryProvider =
    Provider<String Function()>((Ref ref) => () => const Uuid().v4());

/// A stable per-install id sent with every count submission so the server
/// (and an investigator) can tell which handset recorded a line. Stored in
/// the encrypted store; minted once.
final FutureProvider<String> inventoryDeviceIdProvider =
    FutureProvider<String>((Ref ref) async {
  final SecureKeyValueStore store = ref.watch(secureStoreProvider);
  const String slot = 'inventory_device_id_v1';
  final read = await store.read(slot);
  if (read.isOk && (read.value ?? '').isNotEmpty) return read.value!;
  final String id = ref.read(inventoryIdFactoryProvider)();
  if (!read.failed) {
    try {
      await store.write(slot, id);
    } on Object {
      // A device id that could not be saved still identifies this session.
    }
  }
  return id;
});

final FutureProvider<List<InventoryAuditSummary>> myInventoryAuditsProvider =
    FutureProvider<List<InventoryAuditSummary>>(
  (Ref ref) => ref.watch(inventoryAuditRepositoryProvider).myAudits(),
);

final FutureProviderFamily<AuditCounterView, String> auditCounterViewProvider =
    FutureProvider.family<AuditCounterView, String>(
  (Ref ref, String auditId) =>
      ref.watch(inventoryAuditRepositoryProvider).counterView(auditId),
);

final FutureProvider<List<StockTransfer>> stockTransfersProvider =
    FutureProvider<List<StockTransfer>>(
  (Ref ref) => ref.watch(inventoryTransferRepositoryProvider).list(),
);
