/// Physical inventory on the phone: sessions, company-wide search, captures
/// and their photos. Server objects: the DRAFT migration
/// `supabase/pending_migrations/20261122100000_inv_physical_inventory_master.sql`.
/// Until the owner applies it every call fails with a schema mismatch, which
/// the screen renders as "not set up yet" (never an empty list).
library;

import 'dart:typed_data';

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/features/inventory/data/inventory_backend.dart';
import 'package:tyre_pulse/features/inventory/domain/physical_capture.dart';

abstract final class PhysicalInventoryRpcs {
  static const String sessionStart = 'inv_pi_session_start';
  static const String capture = 'inv_pi_capture';
  static const String photoAttach = 'inv_pi_photo_attach';
  static const String search = 'inv_material_search';
  static const String sessions = 'physical_inventory_sessions';
}

abstract interface class PhysicalInventoryRepository {
  Future<List<PhysicalSession>> openSessions();

  Future<PhysicalSession> startSession({
    required String idempotencyKey,
    required String country,
    required String site,
    String? locationId,
  });

  Future<List<MaterialPick>> search(String query);

  /// Records one capture; replays return the same row. Returns
  /// `{id, temp_ref, identification_status}`.
  Future<Map<String, Object?>> capture(Map<String, Object?> payload);

  /// Uploads [bytes] to [path] in the private bucket. An object already at
  /// [path] (an earlier attempt that uploaded but did not attach) counts as
  /// uploaded.
  Future<void> upload(String path, Uint8List bytes);

  Future<void> attachPhoto(Map<String, Object?> payload);
}

final class SupabasePhysicalInventoryRepository
    with SupabaseGateway
    implements PhysicalInventoryRepository {
  SupabasePhysicalInventoryRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<List<PhysicalSession>> openSessions() =>
      guard<List<PhysicalSession>>(() async {
        final List<Map<String, dynamic>> rows = await _client
            .from(PhysicalInventoryRpcs.sessions)
            .select(
              'id, reference, country, site, location_id, status, started_at',
            )
            .eq('status', 'open')
            .order('started_at', ascending: false)
            .order('id')
            .limit(50);
        return rows
            .map((Map<String, dynamic> r) => PhysicalSession.fromJson(r))
            .toList(growable: false);
      });

  @override
  Future<PhysicalSession> startSession({
    required String idempotencyKey,
    required String country,
    required String site,
    String? locationId,
  }) =>
      guard<PhysicalSession>(() async {
        final Object? r = await _client.rpc<Object?>(
          PhysicalInventoryRpcs.sessionStart,
          params: <String, Object?>{
            'p_payload': <String, Object?>{
              'idempotency_key': idempotencyKey,
              'country': country,
              'site': site,
              'location_id': locationId,
            },
          },
        );
        final Map<Object?, Object?> m =
            r is Map ? r : const <Object?, Object?>{};
        return PhysicalSession(
          id: '${m['id'] ?? ''}',
          reference: '${m['reference'] ?? ''}',
          site: site.toUpperCase(),
          status: 'open',
          country: country,
          locationId: locationId,
        );
      });

  @override
  Future<List<MaterialPick>> search(String query) =>
      guard<List<MaterialPick>>(() async {
        final Object? r = await _client.rpc<Object?>(
          PhysicalInventoryRpcs.search,
          params: <String, Object?>{
            'p_payload': <String, Object?>{'query': query, 'limit': 20},
          },
        );
        return MaterialPick.fromSearch(r);
      });

  @override
  Future<Map<String, Object?>> capture(Map<String, Object?> payload) =>
      guard<Map<String, Object?>>(() async {
        final Object? r = await _client.rpc<Object?>(
          PhysicalInventoryRpcs.capture,
          params: <String, Object?>{'p_payload': payload},
        );
        return r is Map
            ? Map<String, Object?>.from(r)
            : const <String, Object?>{};
      });

  @override
  Future<void> upload(String path, Uint8List bytes) => guard<void>(() async {
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

  @override
  Future<void> attachPhoto(Map<String, Object?> payload) =>
      guard<void>(() async {
        await _client.rpc<Object?>(
          PhysicalInventoryRpcs.photoAttach,
          params: <String, Object?>{'p_payload': payload},
        );
      });
}
