/// What a Store Keeper sees on one stock item's card: its shared identity
/// (company catalogue entry, brand, part numbers, barcodes, photos) and
/// where it sits in the store (every bin and the quantity there).
///
/// Server objects (`supabase/migrations/20261122100000_inv_physical_inventory_master.sql`):
/// `material_canonical` (company SKU, brand), `material_variants` (brand +
/// part number, proposed or active), `material_aliases` (barcodes and other
/// numbers), `material_canonical_items` (the ERP item -> catalogue link),
/// `physical_inventory_photos` (photos on a catalogue entry or variant) and
/// `stock_records` (the balance per bin). Everything here is read only: every
/// change goes through the governed `inv_*` proposal RPCs, so a new part
/// number or brand is visible to the whole company and approved by a second
/// person. Pure, for tests.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/core/storage/private_storage_reference_resolver.dart';

/// The bucket material photos live in (`physical_inventory_photos`
/// storage_bucket CHECK).
const String storeItemPhotoBucket = 'tyre-photos';

/// The storage path for a photo added from the item card. Mirrors the web
/// (`src/lib/inventory/physicalInventory.js` photoPath with no session):
/// always under the company folder, which `inv_pi_photo_attach` checks.
String storeItemPhotoPath(String orgId, String clientUuid) =>
    'physical_inventory/$orgId/material/$clientUuid.jpg';

String? _text(Object? v) {
  final String s = '${v ?? ''}'.trim();
  return s.isEmpty || s == 'null' ? null : s;
}

num _num(Object? v) {
  if (v is num) return v;
  return num.tryParse('${v ?? ''}') ?? 0;
}

Map<String, Object?>? _map(Object? v) =>
    v is Map ? Map<String, Object?>.from(v) : null;

/// The company catalogue entry (replacement group / company SKU).
@immutable
final class StoreCatalogueEntry {
  const StoreCatalogueEntry({
    required this.id,
    required this.description,
    required this.status,
    this.companySku,
    this.brand,
    this.manufacturer,
    this.category,
  });

  factory StoreCatalogueEntry.fromJson(Map<String, Object?> j) =>
      StoreCatalogueEntry(
        id: '${j['id'] ?? ''}',
        description: _text(j['description']) ?? '',
        status: _text(j['status']) ?? 'proposed',
        companySku: _text(j['company_sku']),
        brand: _text(j['brand']),
        manufacturer: _text(j['manufacturer']),
        category: _text(j['category']),
      );

  final String id;
  final String description;
  final String status;
  final String? companySku;
  final String? brand;
  final String? manufacturer;
  final String? category;

  bool get pending => status == 'proposed';
}

/// One bin (location) holding this item and the quantity there.
@immutable
final class StoreItemBin {
  const StoreItemBin({
    required this.stockId,
    required this.quantity,
    this.reserved = 0,
    this.site,
    this.locationCode,
    this.locationName,
    this.condition,
  });

  factory StoreItemBin.fromJson(Map<String, Object?> j) {
    final Map<String, Object?>? loc = _map(j['location']);
    return StoreItemBin(
      stockId: '${j['id'] ?? ''}',
      quantity: _num(j['stock_qty'] ?? j['qty_on_hand']),
      reserved: _num(j['qty_reserved']),
      site: _text(j['site']),
      locationCode: _text(loc?['code']),
      locationName: _text(loc?['name']),
      condition: _text(j['condition']),
    );
  }

  final String stockId;
  final num quantity;
  final num reserved;
  final String? site;
  final String? locationCode;
  final String? locationName;
  final String? condition;

  num get available {
    final num free = quantity - reserved;
    return free < 0 ? 0 : free;
  }
}

/// A brand + part number for this item (a `material_variants` row).
@immutable
final class StorePartNumber {
  const StorePartNumber({
    required this.id,
    required this.status,
    this.brand,
    this.manufacturer,
    this.partNumber,
    this.classification = 'unknown',
  });

  factory StorePartNumber.fromJson(Map<String, Object?> j) => StorePartNumber(
        id: '${j['id'] ?? ''}',
        status: _text(j['status']) ?? 'proposed',
        brand: _text(j['brand']),
        manufacturer: _text(j['manufacturer']),
        partNumber: _text(j['part_number']),
        classification: _text(j['part_classification']) ?? 'unknown',
      );

  final String id;
  final String status;
  final String? brand;
  final String? manufacturer;
  final String? partNumber;
  final String classification;

  bool get verified => status == 'active';
}

/// A barcode or another number (`material_aliases`).
@immutable
final class StoreItemReference {
  const StoreItemReference({
    required this.type,
    required this.value,
    this.verified = false,
    this.refStatus = 'active',
  });

  factory StoreItemReference.fromJson(Map<String, Object?> j) =>
      StoreItemReference(
        type: _text(j['alias_type']) ?? 'alternative',
        value: _text(j['value']) ?? '',
        verified: j['verified'] == true,
        refStatus: _text(j['ref_status']) ?? 'active',
      );

  final String type;
  final String value;
  final bool verified;
  final String refStatus;

  bool get historical => refStatus == 'historical';
}

/// A proposal the person or a colleague sent and nobody has decided yet.
@immutable
final class StorePendingChange {
  const StorePendingChange({required this.topic, required this.newValue});

  factory StorePendingChange.fromJson(Map<String, Object?> j) {
    final Map<String, Object?> nv = _map(j['new_value']) ?? <String, Object?>{};
    final String? value = _text(nv['value']) ??
        _text(nv['brand']) ??
        _text(nv['part_number']) ??
        (nv.isEmpty ? null : nv.values.map((Object? v) => '$v').join(', '));
    return StorePendingChange(
      topic: _text(j['topic']) ?? 'reference',
      newValue: value ?? '',
    );
  }

  final String topic;
  final String newValue;
}

@immutable
final class StoreItemCard {
  const StoreItemCard({
    required this.stockId,
    required this.name,
    required this.bins,
    this.itemId,
    this.itemCode,
    this.itemBrand,
    this.itemCategory,
    this.itemBarcode,
    this.uom,
    this.catalogue,
    this.linkedVariantId,
    this.partNumbers = const <StorePartNumber>[],
    this.references = const <StoreItemReference>[],
    this.photos = const <String>[],
    this.pendingChanges = const <StorePendingChange>[],
  });

  final String stockId;
  final String name;
  final String? itemId;
  final String? itemCode;
  final String? itemBrand;
  final String? itemCategory;
  final String? itemBarcode;
  final String? uom;

  /// Null when the ERP item is not linked to a company catalogue entry.
  final StoreCatalogueEntry? catalogue;
  final String? linkedVariantId;
  final List<StoreItemBin> bins;
  final List<StorePartNumber> partNumbers;
  final List<StoreItemReference> references;

  /// `tp-storage://tyre-photos/<path>` references, newest first.
  final List<String> photos;
  final List<StorePendingChange> pendingChanges;

  bool get linked => catalogue != null;

  /// The brand to show: the catalogue's, else the linked part number's, else
  /// the ERP item's.
  String? get brand {
    final String? c = catalogue?.brand;
    if (c != null) return c;
    for (final StorePartNumber p in partNumbers) {
      if (p.id == linkedVariantId && p.brand != null) return p.brand;
    }
    return itemBrand;
  }

  String? get category => catalogue?.category ?? itemCategory;

  num get totalQuantity =>
      bins.fold<num>(0, (num s, StoreItemBin b) => s + b.quantity);
  num get totalReserved =>
      bins.fold<num>(0, (num s, StoreItemBin b) => s + b.reserved);
  num get totalAvailable =>
      bins.fold<num>(0, (num s, StoreItemBin b) => s + b.available);

  /// Barcodes first (the ERP item's own one included), then other numbers.
  List<StoreItemReference> get barcodes => <StoreItemReference>[
        if (itemBarcode != null &&
            !references.any(
              (StoreItemReference r) =>
                  r.type == 'barcode' && r.value == itemBarcode,
            ))
          StoreItemReference(
            type: 'barcode',
            value: itemBarcode!,
            verified: true,
          ),
        ...references.where((StoreItemReference r) => r.type == 'barcode'),
      ];

  List<StoreItemReference> get otherNumbers => references
      .where((StoreItemReference r) => r.type != 'barcode')
      .toList(growable: false);
}

/// Turns a `physical_inventory_photos.storage_path` into the private storage
/// reference the image resolver signs.
String storeItemPhotoRef(String storagePath) =>
    '$privateStorageReferencePrefix$storeItemPhotoBucket/$storagePath';

/// Case-insensitive merge of brand names from several sources, keeping the
/// first spelling seen, sorted alphabetically.
List<String> mergeBrands(Iterable<Iterable<String?>> sources) {
  final Map<String, String> byKey = <String, String>{};
  for (final Iterable<String?> source in sources) {
    for (final String? raw in source) {
      final String? v = _text(raw);
      if (v == null) continue;
      byKey.putIfAbsent(v.toLowerCase(), () => v);
    }
  }
  final List<String> out = byKey.values.toList()
    ..sort((String a, String b) => a.toLowerCase().compareTo(b.toLowerCase()));
  return out;
}

/// Brands whose name contains [query] (case-insensitive), the whole list for
/// a blank query.
List<String> filterBrands(List<String> brands, String query) {
  final String q = query.trim().toLowerCase();
  if (q.isEmpty) return brands;
  return brands
      .where((String b) => b.toLowerCase().contains(q))
      .toList(growable: false);
}

/// The thumbnail and brand line for one ERP item on the stock list.
@immutable
final class StockItemFace {
  const StockItemFace({this.photo, this.brand});
  final String? photo;
  final String? brand;
}
