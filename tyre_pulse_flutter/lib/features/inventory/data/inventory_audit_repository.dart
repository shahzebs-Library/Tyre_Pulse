/// Reads the counter's blind view of audits and submits count lines.
///
/// Online calls only. Offline work is kept by [CountDraftStore] and sent
/// when the counter (or the screen on reconnect) submits again; every line is
/// idempotent on its `client_uuid`, so a retry after a timeout cannot double a
/// count. A queued background submit needs the reserved command registry and
/// is delivered as a patch (`docs/inventory_reserved_patch.md`).
library;

import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/features/inventory/data/inventory_backend.dart';
import 'package:tyre_pulse/features/inventory/domain/count_models.dart';
import 'package:tyre_pulse/features/inventory/domain/count_session.dart';

abstract interface class InventoryAuditRepository {
  /// Audits assigned to the signed-in user.
  Future<List<InventoryAuditSummary>> myAudits();

  /// The blind counter view of one audit (no expected quantities).
  Future<AuditCounterView> counterView(String auditId);

  /// Sends [lines] (each idempotent on `client_uuid`).
  Future<CountSubmitResult> submit({
    required String auditId,
    required List<CountLine> lines,
    required String deviceId,
  });

  /// Ends counting on [auditId]. Online only: whether counting may end
  /// depends on the audit's CURRENT status, so it is never queued. The
  /// server replays the stored answer for a repeated [idempotencyKey].
  Future<Object?> completeCounting({
    required String auditId,
    required String idempotencyKey,
  });

  /// Uploads one local photo for a count line and returns its reference.
  Future<String> uploadPhoto({
    required String auditId,
    required String clientUuid,
    required String localPath,
  });
}

/// The `inv_count_submit` arguments: `{p_payload: {audit_id, device_id,
/// lines}}`. Exposed so the shape is pinned by a test.
Map<String, Object?> countSubmitParams({
  required String auditId,
  required String deviceId,
  required List<CountLine> lines,
}) =>
    <String, Object?>{
      'p_payload': <String, Object?>{
        'audit_id': auditId,
        'device_id': deviceId,
        'lines': <Map<String, Object?>>[
          for (final CountLine l in lines) l.toSubmitJson(),
        ],
      },
    };

/// The `inv_audit_complete_counting` arguments: `{p_payload: {audit_id,
/// idempotency_key}}` - the exact shape the web sends (its `rpcWrite` merges
/// `idempotency_key` into the payload). Exposed so a test pins it.
Map<String, Object?> completeCountingParams({
  required String auditId,
  required String idempotencyKey,
}) =>
    <String, Object?>{
      'p_payload': <String, Object?>{
        'audit_id': auditId,
        'idempotency_key': idempotencyKey,
      },
    };

final class SupabaseInventoryAuditRepository
    with SupabaseGateway
    implements InventoryAuditRepository {
  SupabaseInventoryAuditRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<List<InventoryAuditSummary>> myAudits() {
    return guard<List<InventoryAuditSummary>>(() async {
      final Object? raw = await _client.rpc<Object?>(
        InventoryRpcs.auditCounterView,
        params: const <String, Object?>{'p_audit_id': null},
      );
      final Object? stripped = stripExpectedKeys(raw);
      final Object? audits = stripped is Map ? stripped['audits'] : stripped;
      return <InventoryAuditSummary>[
        if (audits is List)
          for (final Object? row in audits)
            if (row is Map)
              InventoryAuditSummary.fromJson(Map<String, Object?>.from(row)),
      ].where((InventoryAuditSummary a) => a.id.isNotEmpty).toList(
            growable: false,
          );
    });
  }

  @override
  Future<AuditCounterView> counterView(String auditId) {
    return guard<AuditCounterView>(() async {
      final Object? raw = await _client.rpc<Object?>(
        InventoryRpcs.auditCounterView,
        params: <String, Object?>{'p_audit_id': auditId},
      );
      if (raw is! Map) {
        throw const FormatException('counter view is not an object');
      }
      return AuditCounterView.fromJson(Map<String, Object?>.from(raw));
    });
  }

  @override
  Future<CountSubmitResult> submit({
    required String auditId,
    required List<CountLine> lines,
    required String deviceId,
  }) {
    return guard<CountSubmitResult>(() async {
      final Object? raw = await _client.rpc<Object?>(
        InventoryRpcs.countSubmit,
        // DB contract (docs/inventory/10 section 3): ONE p_payload argument.
        // Its outer idempotency key is optional for this call only: every
        // line is idempotent on its own client_uuid, so an offline replay
        // resends lines, never a call.
        params: countSubmitParams(
          auditId: auditId,
          deviceId: deviceId,
          lines: lines,
        ),
      );
      return CountSubmitResult.fromJson(raw);
    });
  }

  @override
  Future<Object?> completeCounting({
    required String auditId,
    required String idempotencyKey,
  }) =>
      guard<Object?>(
        () => _client.rpc<Object?>(
          InventoryRpcs.auditCompleteCounting,
          params: completeCountingParams(
            auditId: auditId,
            idempotencyKey: idempotencyKey,
          ),
        ),
      );

  @override
  Future<String> uploadPhoto({
    required String auditId,
    required String clientUuid,
    required String localPath,
  }) {
    return guard<String>(() async {
      final String name = localPath.split(Platform.pathSeparator).last;
      final String path = 'inventory_count/$auditId/$clientUuid/$name';
      await _client.storage.from(inventoryPhotoBucket).upload(
            path,
            File(localPath),
            fileOptions: const FileOptions(upsert: true),
          );
      return 'tp-storage://$inventoryPhotoBucket/$path';
    });
  }
}
