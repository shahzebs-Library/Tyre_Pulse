/// Riverpod wiring for the Store item card (photo, bins, part numbers,
/// barcodes) and the stock list's thumbnail + brand line.
library;

import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/features/stock_count/data/store_item_repository.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';
import 'package:tyre_pulse/features/stock_count/domain/store_item_card.dart';

final Provider<StoreItemRepository> storeItemRepositoryProvider =
    Provider<StoreItemRepository>(
  (Ref ref) => SupabaseStoreItemRepository(ref.watch(supabaseClientProvider)),
);

/// The card for one stock line. Keyed by the line itself; the screen keeps
/// one instance, and `ref.invalidate` re-reads after an action.
final storeItemCardProvider =
    FutureProvider.autoDispose.family<StoreItemCard, StockItem>(
  (Ref ref, StockItem item) =>
      ref.watch(storeItemRepositoryProvider).card(item),
);

/// Every brand known to the company, for the searchable picker.
final FutureProvider<List<String>> storeBrandsProvider =
    FutureProvider<List<String>>(
  (Ref ref) => ref.watch(storeItemRepositoryProvider).brands(),
);

/// What the person may do on the card. An administrator (or super admin)
/// always may; otherwise the server's `inv_can` answers. A failed read hides
/// the actions (they would need the network anyway).
final storeItemPermissionsProvider =
    FutureProvider.autoDispose<StoreItemPermissions>((Ref ref) async {
  final AccessState access = ref.watch(accessStateProvider);
  if (access.isSuperAdmin || access.role.isAdministrator) {
    return const StoreItemPermissions(canPropose: true, canTransfer: true);
  }
  try {
    return await ref.watch(storeItemRepositoryProvider).permissions();
  } on Object {
    return const StoreItemPermissions();
  }
});

/// The key for [stockItemFacesProvider]: the distinct ERP item ids of
/// [items], sorted and joined, so the same list asks once.
String stockFacesKey(Iterable<StockItem> items) {
  final List<String> ids = <String>{
    for (final StockItem i in items)
      if ((i.itemId ?? '').isNotEmpty) i.itemId!,
  }.toList()
    ..sort();
  return ids.join(',');
}

/// Thumbnail photo and brand per ERP item id (keyed by [stockFacesKey]).
/// Three queries for the whole list, never one per row.
final stockItemFacesProvider =
    FutureProvider.autoDispose.family<Map<String, StockItemFace>, String>(
  (Ref ref, String key) {
    if (key.isEmpty) {
      return Future<Map<String, StockItemFace>>.value(
        const <String, StockItemFace>{},
      );
    }
    return ref.watch(storeItemRepositoryProvider).faces(key.split(','));
  },
);

/// Picks one photo for the card (camera or gallery), compressed on the way
/// out like the count photos. Null when the person cancelled. A provider so
/// tests can hand in bytes without a camera.
final Provider<Future<Uint8List?> Function({required bool camera})>
    storeItemPhotoPickerProvider =
    Provider<Future<Uint8List?> Function({required bool camera})>(
  (Ref ref) => ({required bool camera}) async {
    final XFile? picked = await ImagePicker().pickImage(
      source: camera ? ImageSource.camera : ImageSource.gallery,
      maxWidth: 1600,
      maxHeight: 1600,
      imageQuality: 60,
    );
    if (picked == null) return null;
    return picked.readAsBytes();
  },
);
