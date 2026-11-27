/// Reads a stock item's card (identity, part numbers, barcodes, photos and
/// bins) and sends what a Store Keeper adds to it.
///
/// Reads go through RLS (org, country, site). Every write goes through the
/// SAME governed RPCs the web uses (`src/lib/api/physicalInventory.js`), so
/// web and phone stay one system:
///
/// | Action | RPC | Result |
/// |---|---|---|
/// | Add a part number + brand | `inv_material_variant_propose` | proposed variant, visible company wide, a second person approves |
/// | Add a barcode / other number | `inv_correction_request` (add_reference) | correction waiting for approval |
/// | Correct the brand | `inv_correction_request` (field_update brand) | correction waiting for approval |
/// | Add a photo | Storage upload + `inv_pi_photo_attach` | stored at once (evidence, never deleted) |
/// | Item not in the catalogue | `inv_material_canonical_propose` | proposed entry; a reviewer links the ERP item |
///
/// Moving stock between bins is a transfer (`inv_transfer_dispatch`, the
/// existing Transfers screen); nothing here moves stock.
///
/// Writes are online only: each one depends on what the server holds now
/// (an approved catalogue entry, an open proposal) and the shared command
/// registry is reserved wiring. A connectivity failure is reported as such,
/// never as saved.
library;

import 'dart:typed_data';

import 'package:crypto/crypto.dart' as crypto;
import 'package:flutter/foundation.dart' show immutable;
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';
import 'package:tyre_pulse/features/stock_count/domain/store_item_card.dart';

/// What the signed-in person may do on the card. Mirrors the server gates:
/// `_inv_pi_can_capture()` (count or receive, or an elevated role) for every
/// proposal and photo, `inv_can('transfer')` for moving stock. The server
/// stays the boundary; this only hides buttons that would always refuse.
@immutable
final class StoreItemPermissions {
  const StoreItemPermissions({
    this.canPropose = false,
    this.canTransfer = false,
  });

  final bool canPropose;
  final bool canTransfer;
}

abstract interface class StoreItemRepository {
  Future<StoreItemCard> card(StockItem item);

  /// Every brand already used anywhere in the company, merged and sorted.
  Future<List<String>> brands();

  Future<StoreItemPermissions> permissions();

  /// Thumbnail photo and brand per ERP item id, for the stock list.
  Future<Map<String, StockItemFace>> faces(List<String> itemIds);

  Future<void> addPartNumber({
    required String canonicalId,
    required String brand,
    required String partNumber,
    required String idempotencyKey,
    String? manufacturer,
  });

  Future<void> addReference({
    required String canonicalId,
    required String aliasType,
    required String value,
    required String reason,
    required String idempotencyKey,
  });

  Future<void> correctBrand({
    required String targetKind,
    required String targetId,
    required String brand,
    required String reason,
    required String idempotencyKey,
  });

  Future<void> addPhoto({
    required String orgId,
    required String canonicalId,
    required Uint8List bytes,
    required String clientUuid,
    String? variantId,
  });

  Future<void> proposeCatalogueEntry({
    required StockItem item,
    required String description,
    required String idempotencyKey,
    String? brand,
    String? partNumber,
    String? barcode,
  });
}

/// Duration bounds: a read that gets no answer becomes an offline error, not
/// an endless spinner.
const Duration storeItemReadTimeout = Duration(seconds: 15);
const Duration storeItemWriteTimeout = Duration(seconds: 30);
const Duration storeItemPhotoTimeout = Duration(seconds: 60);

final class SupabaseStoreItemRepository
    with SupabaseGateway
    implements StoreItemRepository {
  SupabaseStoreItemRepository(this._client);

  final SupabaseClient _client;

  Future<List<Map<String, dynamic>>> _rows(
    PostgrestTransformBuilder<List<Map<String, dynamic>>> q,
  ) async =>
      q;

  @override
  Future<StoreItemCard> card(StockItem item) => guard<StoreItemCard>(
        () async {
          final String? itemId = item.itemId;
          if (itemId == null || itemId.isEmpty) {
            return StoreItemCard(
              stockId: item.id,
              name: item.description ?? '',
              itemCode: item.itemCode,
              uom: item.uom,
              bins: <StoreItemBin>[_binOf(item)],
            );
          }
          final List<Object?> first =
              await Future.wait<Object?>(<Future<Object?>>[
            _rows(
              _client
                  .from('stock_records')
                  .select(
                    'id,site,stock_qty,qty_reserved,condition,'
                    'location:inventory_locations(code,name)',
                  )
                  .eq('item_id', itemId)
                  .order('site')
                  .order('id')
                  .limit(100),
            ),
            _rows(
              _client
                  .from('material_master')
                  .select('id,item_code,item_name,brand,category,barcode')
                  .eq('id', itemId)
                  .limit(1),
            ),
            _rows(
              _client
                  .from('material_canonical_items')
                  .select('canonical_id,variant_id')
                  .eq('item_id', itemId)
                  .limit(1),
            ),
          ]);
          final List<Map<String, dynamic>> stockRows =
              first[0]! as List<Map<String, dynamic>>;
          final List<Map<String, dynamic>> masterRows =
              first[1]! as List<Map<String, dynamic>>;
          final List<Map<String, dynamic>> linkRows =
              first[2]! as List<Map<String, dynamic>>;
          final Map<String, dynamic>? master =
              masterRows.isEmpty ? null : masterRows.first;
          final List<StoreItemBin> bins = stockRows.isEmpty
              ? <StoreItemBin>[_binOf(item)]
              : stockRows
                  .map((Map<String, dynamic> r) => StoreItemBin.fromJson(r))
                  .toList(growable: false);
          final String? canonicalId = linkRows.isEmpty
              ? null
              : linkRows.first['canonical_id'] as String?;
          final String? linkedVariant =
              linkRows.isEmpty ? null : linkRows.first['variant_id'] as String?;

          StoreCatalogueEntry? catalogue;
          List<StorePartNumber> parts = const <StorePartNumber>[];
          List<StoreItemReference> refs = const <StoreItemReference>[];
          List<String> photos = const <String>[];
          List<StorePendingChange> pending = const <StorePendingChange>[];
          if (canonicalId == null) {
            refs = (await _rows(
              _client
                  .from('material_aliases')
                  .select('alias_type,value,verified,ref_status')
                  .eq('item_id', itemId)
                  .limit(50),
            ))
                .map((Map<String, dynamic> r) => StoreItemReference.fromJson(r))
                .toList(growable: false);
          } else {
            final List<Object?> second =
                await Future.wait<Object?>(<Future<Object?>>[
              _rows(
                _client
                    .from('material_canonical')
                    .select(
                      'id,company_sku,description,category,brand,manufacturer,'
                      'status',
                    )
                    .eq('id', canonicalId)
                    .limit(1),
              ),
              _rows(
                _client
                    .from('material_variants')
                    .select(
                      'id,brand,manufacturer,part_number,part_classification,'
                      'status',
                    )
                    .eq('canonical_id', canonicalId)
                    .inFilter('status', <String>['proposed', 'active'])
                    .order('proposed_at')
                    .order('id')
                    .limit(50),
              ),
              _rows(
                _client
                    .from('material_correction_requests')
                    .select('topic,new_value')
                    .eq('target_id', canonicalId)
                    .eq('status', 'submitted')
                    .order('requested_at', ascending: false)
                    .limit(20),
              ),
            ]);
            final List<Map<String, dynamic>> can =
                second[0]! as List<Map<String, dynamic>>;
            catalogue =
                can.isEmpty ? null : StoreCatalogueEntry.fromJson(can.first);
            parts = (second[1]! as List<Map<String, dynamic>>)
                .map((Map<String, dynamic> r) => StorePartNumber.fromJson(r))
                .toList(growable: false);
            pending = (second[2]! as List<Map<String, dynamic>>)
                .map((Map<String, dynamic> r) => StorePendingChange.fromJson(r))
                .toList(growable: false);
            final List<String> variantIds = <String>[
              for (final StorePartNumber p in parts)
                if (p.id.isNotEmpty) p.id,
            ];
            final String owners = <String>[
              'canonical_id.eq.$canonicalId',
              'item_id.eq.$itemId',
              if (variantIds.isNotEmpty)
                'variant_id.in.(${variantIds.join(',')})',
            ].join(',');
            final String photoOwners = <String>[
              'canonical_id.eq.$canonicalId',
              if (variantIds.isNotEmpty)
                'variant_id.in.(${variantIds.join(',')})',
            ].join(',');
            final List<Object?> third =
                await Future.wait<Object?>(<Future<Object?>>[
              _rows(
                _client
                    .from('material_aliases')
                    .select('alias_type,value,verified,ref_status')
                    .or(owners)
                    .order('alias_type')
                    .order('value')
                    .limit(100),
              ),
              _rows(
                _client
                    .from('physical_inventory_photos')
                    .select('storage_path')
                    .or(photoOwners)
                    .order('uploaded_at', ascending: false)
                    .limit(12),
              ),
            ]);
            refs = (third[0]! as List<Map<String, dynamic>>)
                .map((Map<String, dynamic> r) => StoreItemReference.fromJson(r))
                .where((StoreItemReference r) => r.value.isNotEmpty)
                .toList(growable: false);
            photos = <String>[
              for (final Map<String, dynamic> r
                  in third[1]! as List<Map<String, dynamic>>)
                if ('${r['storage_path'] ?? ''}'.isNotEmpty)
                  storeItemPhotoRef('${r['storage_path']}'),
            ];
          }
          return StoreItemCard(
            stockId: item.id,
            name: (master?['item_name'] as String?)?.trim().isNotEmpty == true
                ? master!['item_name'] as String
                : (catalogue?.description ?? item.description ?? ''),
            itemId: itemId,
            itemCode: (master?['item_code'] as String?) ?? item.itemCode,
            itemBrand: master?['brand'] as String?,
            itemCategory: master?['category'] as String?,
            itemBarcode: (master?['barcode'] as String?)?.trim().isEmpty == true
                ? null
                : master?['barcode'] as String?,
            uom: item.uom,
            catalogue: catalogue,
            linkedVariantId: linkedVariant,
            bins: bins,
            partNumbers: parts,
            references: refs,
            photos: photos,
            pendingChanges: pending,
          );
        },
        timeout: storeItemReadTimeout,
      );

  static StoreItemBin _binOf(StockItem item) => StoreItemBin(
        stockId: item.id,
        quantity: item.quantity,
        reserved: item.reserved ?? 0,
        site: item.site,
        locationCode: item.locationCode,
        condition: item.condition,
      );

  @override
  Future<List<String>> brands() => guard<List<String>>(
        () async {
          Future<List<String?>> col(String table, String column) async {
            try {
              final List<Map<String, dynamic>> rows = await _client
                  .from(table)
                  .select(column)
                  .not(column, 'is', null)
                  .order(column)
                  .limit(1000);
              return <String?>[
                for (final Map<String, dynamic> r in rows) r[column] as String?,
              ];
            } on PostgrestException {
              // One source the person cannot read (RLS / not set up) must
              // not hide the brands every other source knows.
              return const <String?>[];
            }
          }

          final List<List<String?>> all = await Future.wait(
            <Future<List<String?>>>[
              col('material_variants', 'brand'),
              col('material_canonical', 'brand'),
              col('material_master', 'brand'),
              col('brand_aliases', 'canonical'),
            ],
          );
          return mergeBrands(all);
        },
        timeout: storeItemReadTimeout,
      );

  @override
  Future<StoreItemPermissions> permissions() => guard<StoreItemPermissions>(
        () async {
          Future<bool> can(String cap) async {
            final Object? r = await _client.rpc<Object?>(
              'inv_can',
              params: <String, Object?>{'p_cap': cap},
            );
            return r == true;
          }

          final List<bool> caps = await Future.wait(<Future<bool>>[
            can('count'),
            can('receive'),
            can('transfer'),
          ]);
          return StoreItemPermissions(
            canPropose: caps[0] || caps[1],
            canTransfer: caps[2],
          );
        },
        timeout: storeItemReadTimeout,
      );

  @override
  Future<Map<String, StockItemFace>> faces(List<String> itemIds) async {
    // An `in` filter carries every id in the URL; a big register would build
    // a request URL proxies refuse. Read in bounded chunks and merge.
    final List<String> ids = itemIds.toSet().toList()..sort();
    if (ids.length <= _facesChunk) return _facesChunked(ids);
    final Map<String, StockItemFace> out = <String, StockItemFace>{};
    for (int i = 0; i < ids.length; i += _facesChunk) {
      final int end =
          i + _facesChunk > ids.length ? ids.length : i + _facesChunk;
      out.addAll(await _facesChunked(ids.sublist(i, end)));
    }
    return out;
  }

  static const int _facesChunk = 120;

  Future<Map<String, StockItemFace>> _facesChunked(List<String> itemIds) =>
      guard<Map<String, StockItemFace>>(
        () async {
          final List<String> ids = itemIds.toSet().toList()..sort();
          if (ids.isEmpty) return const <String, StockItemFace>{};
          final List<Object?> first =
              await Future.wait<Object?>(<Future<Object?>>[
            _rows(
              _client
                  .from('material_canonical_items')
                  .select(
                    'item_id,canonical_id,variant_id,'
                    'canonical:material_canonical(brand)',
                  )
                  .inFilter('item_id', ids)
                  .limit(ids.length),
            ),
            _rows(
              _client
                  .from('material_master')
                  .select('id,brand')
                  .inFilter('id', ids)
                  .limit(ids.length),
            ),
          ]);
          final Map<String, String> canonicalOf = <String, String>{};
          final Map<String, String> variantOf = <String, String>{};
          final Map<String, String?> canonicalBrand = <String, String?>{};
          for (final Map<String, dynamic> r
              in first[0]! as List<Map<String, dynamic>>) {
            final String? item = r['item_id'] as String?;
            final String? can = r['canonical_id'] as String?;
            if (item == null || can == null) continue;
            canonicalOf[item] = can;
            final String? variant = r['variant_id'] as String?;
            if (variant != null) variantOf[item] = variant;
            final Object? c = r['canonical'];
            canonicalBrand[can] = c is Map ? c['brand'] as String? : null;
          }
          final Map<String, String?> masterBrand = <String, String?>{
            for (final Map<String, dynamic> r
                in first[1]! as List<Map<String, dynamic>>)
              '${r['id']}': r['brand'] as String?,
          };
          final Map<String, String> photoOf = <String, String>{};
          if (canonicalOf.isNotEmpty) {
            final List<Map<String, dynamic>> photos = await _client
                .from('physical_inventory_photos')
                .select('canonical_id,storage_path')
                .inFilter('canonical_id', canonicalOf.values.toSet().toList())
                .order('uploaded_at', ascending: false)
                .limit(300);
            for (final Map<String, dynamic> p in photos) {
              final String? can = p['canonical_id'] as String?;
              final String path = '${p['storage_path'] ?? ''}';
              if (can != null && path.isNotEmpty) {
                photoOf.putIfAbsent(can, () => storeItemPhotoRef(path));
              }
            }
          }
          // Part numbers: the variant an item is linked to, else the
          // catalogue item's first active one (genuine / OES first).
          final Map<String, Map<String, dynamic>> variantById =
              <String, Map<String, dynamic>>{};
          final Map<String, Map<String, dynamic>> bestOfCanonical =
              <String, Map<String, dynamic>>{};
          // The newest genuine / not genuine mark from a count, per stock
          // line (entered_refs.stock_id) and per item.
          final Map<String, Map<String, bool>> markByStock =
              <String, Map<String, bool>>{};
          final Map<String, bool> markByItem = <String, bool>{};
          final List<Object?> second =
              await Future.wait<Object?>(<Future<Object?>>[
            if (canonicalOf.isEmpty)
              Future<List<Map<String, dynamic>>>.value(
                const <Map<String, dynamic>>[],
              )
            else
              _rows(
                _client
                    .from('material_variants')
                    .select(
                      'id,canonical_id,brand,part_number,'
                      'part_classification,status',
                    )
                    .inFilter(
                      'canonical_id',
                      canonicalOf.values.toSet().toList(),
                    )
                    .inFilter(
                  'status',
                  <String>['active', 'proposed'],
                ).limit(600),
              ),
            _rows(
              _client
                  .from('physical_inventory_captures')
                  .select('item_id,genuine,entered_refs,captured_at')
                  .inFilter('item_id', ids)
                  .not('genuine', 'is', null)
                  .order('captured_at', ascending: false)
                  .limit(600),
            ),
          ]);
          int rank(Map<String, dynamic> v) {
            final int st = v['status'] == 'active' ? 0 : 10;
            return st +
                switch ('${v['part_classification']}') {
                  'genuine' => 0,
                  'oes' => 1,
                  'aftermarket' => 2,
                  _ => 3,
                };
          }

          for (final Map<String, dynamic> v
              in second[0]! as List<Map<String, dynamic>>) {
            if ((v['part_number'] as String? ?? '').trim().isEmpty) continue;
            variantById['${v['id']}'] = v;
            final String can = '${v['canonical_id']}';
            final Map<String, dynamic>? best = bestOfCanonical[can];
            if (best == null || rank(v) < rank(best)) bestOfCanonical[can] = v;
          }
          for (final Map<String, dynamic> c
              in second[1]! as List<Map<String, dynamic>>) {
            final String? item = c['item_id'] as String?;
            final Object? g = c['genuine'];
            if (item == null || g is! bool) continue;
            markByItem.putIfAbsent(item, () => g);
            final Object? refs = c['entered_refs'];
            final Object? stock = refs is Map ? refs['stock_id'] : null;
            if (stock is String && stock.isNotEmpty) {
              (markByStock[item] ??= <String, bool>{})
                  .putIfAbsent(stock, () => g);
            }
          }
          String? clean(String? s) =>
              (s ?? '').trim().isEmpty ? null : s!.trim();
          return <String, StockItemFace>{
            for (final String id in ids)
              id: () {
                final Map<String, dynamic>? v = variantById[variantOf[id]] ??
                    bestOfCanonical[canonicalOf[id]];
                return StockItemFace(
                  photo:
                      canonicalOf[id] == null ? null : photoOf[canonicalOf[id]],
                  brand: clean(canonicalBrand[canonicalOf[id]]) ??
                      clean(masterBrand[id]),
                  partNumber: clean(v?['part_number'] as String?),
                  partBrand: clean(v?['brand'] as String?),
                  classification: v?['part_classification'] as String?,
                  genuineByStock: markByStock[id] ?? const <String, bool>{},
                  genuineMark: markByItem[id],
                );
              }(),
          };
        },
        timeout: storeItemReadTimeout,
      );

  Future<Object?> _rpc(String fn, Map<String, Object?> payload) =>
      _client.rpc<Object?>(fn, params: <String, Object?>{'p_payload': payload});

  String? _blank(String? v) {
    final String s = (v ?? '').trim();
    return s.isEmpty ? null : s;
  }

  @override
  Future<void> addPartNumber({
    required String canonicalId,
    required String brand,
    required String partNumber,
    required String idempotencyKey,
    String? manufacturer,
  }) =>
      guard<void>(
        () async {
          await _rpc('inv_material_variant_propose', <String, Object?>{
            'idempotency_key': idempotencyKey,
            'canonical_id': canonicalId,
            'brand': brand.trim(),
            'manufacturer': _blank(manufacturer),
            'part_number': partNumber.trim(),
            'part_classification': 'unknown',
          });
        },
        timeout: storeItemWriteTimeout,
      );

  @override
  Future<void> addReference({
    required String canonicalId,
    required String aliasType,
    required String value,
    required String reason,
    required String idempotencyKey,
  }) =>
      guard<void>(
        () async {
          await _rpc('inv_correction_request', <String, Object?>{
            'idempotency_key': idempotencyKey,
            'target_kind': 'canonical',
            'target_id': canonicalId,
            'action': 'add_reference',
            'topic': 'reference',
            'new_value': <String, Object?>{
              'alias_type': aliasType,
              'value': value.trim(),
            },
            'reason': reason.trim(),
          });
        },
        timeout: storeItemWriteTimeout,
      );

  @override
  Future<void> correctBrand({
    required String targetKind,
    required String targetId,
    required String brand,
    required String reason,
    required String idempotencyKey,
  }) =>
      guard<void>(
        () async {
          await _rpc('inv_correction_request', <String, Object?>{
            'idempotency_key': idempotencyKey,
            'target_kind': targetKind,
            'target_id': targetId,
            'action': 'field_update',
            'topic': 'brand',
            'new_value': <String, Object?>{'brand': brand.trim()},
            'reason': reason.trim(),
          });
        },
        timeout: storeItemWriteTimeout,
      );

  @override
  Future<void> addPhoto({
    required String orgId,
    required String canonicalId,
    required Uint8List bytes,
    required String clientUuid,
    String? variantId,
  }) =>
      guard<void>(
        () async {
          final String path = storeItemPhotoPath(orgId, clientUuid);
          try {
            await _client.storage.from(storeItemPhotoBucket).uploadBinary(
                  path,
                  bytes,
                  fileOptions: const FileOptions(
                    contentType: 'image/jpeg',
                    upsert: false,
                  ),
                );
          } on StorageException catch (e) {
            final String m = e.message.toLowerCase();
            // An earlier attempt that uploaded but did not attach.
            if (!(e.statusCode == '409' ||
                m.contains('already exists') ||
                m.contains('duplicate'))) {
              rethrow;
            }
          }
          await _client.rpc<Object?>(
            'inv_pi_photo_attach',
            params: <String, Object?>{
              'p_payload': <String, Object?>{
                'client_uuid': clientUuid,
                if (variantId == null) 'canonical_id': canonicalId,
                if (variantId != null) 'variant_id': variantId,
                'storage_path': path,
                'photo_role': 'item',
                'purpose': 'identification',
                'sha256': crypto.sha256.convert(bytes).toString(),
                'byte_size': bytes.length,
              },
            },
          );
        },
        timeout: storeItemPhotoTimeout,
      );

  @override
  Future<void> proposeCatalogueEntry({
    required StockItem item,
    required String description,
    required String idempotencyKey,
    String? brand,
    String? partNumber,
    String? barcode,
  }) =>
      guard<void>(
        () async {
          final String? pn = _blank(partNumber);
          final String? bc = _blank(barcode);
          await _rpc('inv_material_canonical_propose', <String, Object?>{
            'idempotency_key': idempotencyKey,
            'description': description.trim(),
            'company_sku': _blank(item.itemCode),
            'brand': _blank(brand),
            'base_uom': _blank(item.uom),
            'site': _blank(item.site),
            'references': <Map<String, Object?>>[
              if (pn != null)
                <String, Object?>{
                  'alias_type': 'oem',
                  'value': pn,
                  'brand': _blank(brand),
                  'source': 'phone',
                },
              if (bc != null)
                <String, Object?>{
                  'alias_type': 'barcode',
                  'value': bc,
                  'source': 'phone',
                },
            ],
            'refs': <String, Object?>{
              if (_blank(item.itemCode) != null) 'erp_sku': item.itemCode,
              if (pn != null) 'part_number': pn,
              if (bc != null) 'barcode': bc,
            },
          });
        },
        timeout: storeItemWriteTimeout,
      );
}
