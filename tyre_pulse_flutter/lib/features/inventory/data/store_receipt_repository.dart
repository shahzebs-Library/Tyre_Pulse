/// Store keeper phone receipts: reads the open lines and writes only through
/// `inv_store_receipt_submit` / `inv_store_receipt_cancel`.
///
/// Online only, like job card issue: the open quantity and the site scope are
/// live server facts. The screen keeps one client_uuid per distinct request,
/// so Send after a timeout repeats the same request and never records twice.
library;

import 'dart:typed_data';

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/features/inventory/data/inventory_backend.dart';
import 'package:tyre_pulse/features/inventory/domain/store_receipt.dart';

abstract final class StoreReceiptRpcs {
  static const String openLines = 'inv_store_receipt_open_lines';
  static const String submit = 'inv_store_receipt_submit';
  static const String cancel = 'inv_store_receipt_cancel';
}

/// The server's answer to a recorded receipt.
final class StoreReceiptOutcome {
  const StoreReceiptOutcome({
    required this.id,
    required this.status,
    this.replayed = false,
  });

  factory StoreReceiptOutcome.fromJson(Object? value) {
    final Map<String, dynamic> m =
        value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
    return StoreReceiptOutcome(
      id: m['id']?.toString() ?? '',
      status: m['status']?.toString() ?? 'pending',
      replayed: m['replayed'] == true,
    );
  }

  final String id;
  final String status;
  final bool replayed;
}

abstract interface class StoreReceiptRepository {
  Future<StoreReceiptBoard> board({String? search});

  Future<StoreReceiptOutcome> submit(
    StoreReceiptDraft draft, {
    required String clientUuid,
  });

  Future<void> cancel(String requestId);

  /// Uploads a delivery-note photo to [path]. An object already there (an
  /// earlier attempt) counts as uploaded.
  Future<void> uploadPhoto(String path, Uint8List bytes);
}

final class SupabaseStoreReceiptRepository
    with SupabaseGateway
    implements StoreReceiptRepository {
  SupabaseStoreReceiptRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<StoreReceiptBoard> board({String? search}) =>
      guard<StoreReceiptBoard>(() async {
        final Object? r = await _client.rpc<Object?>(
          StoreReceiptRpcs.openLines,
          params: <String, Object?>{
            'p_payload': <String, Object?>{
              if ((search ?? '').trim().isNotEmpty) 'search': search!.trim(),
            },
          },
        );
        return StoreReceiptBoard.fromJson(r);
      });

  @override
  Future<StoreReceiptOutcome> submit(
    StoreReceiptDraft draft, {
    required String clientUuid,
  }) =>
      guard<StoreReceiptOutcome>(() async {
        final Object? r = await _client.rpc<Object?>(
          StoreReceiptRpcs.submit,
          params: <String, Object?>{'p_payload': draft.toPayload(clientUuid)},
        );
        return StoreReceiptOutcome.fromJson(r);
      });

  @override
  Future<void> cancel(String requestId) => guard<void>(() async {
        await _client.rpc<Object?>(
          StoreReceiptRpcs.cancel,
          params: <String, Object?>{
            'p_payload': <String, Object?>{'request_id': requestId},
          },
        );
      });

  @override
  Future<void> uploadPhoto(String path, Uint8List bytes) =>
      guard<void>(() async {
        try {
          await _client.storage.from(inventoryPhotoBucket).uploadBinary(
                path,
                bytes,
                fileOptions: const FileOptions(
                  contentType: 'image/jpeg',
                  upsert: false,
                ),
              );
        } on StorageException catch (e) {
          final String m = e.message.toLowerCase();
          if (e.statusCode == '409' ||
              m.contains('already exists') ||
              m.contains('duplicate')) {
            return;
          }
          rethrow;
        }
      });
}
