/// Versioned decisions are online-only. Encrypted snapshots and explicitly saved
/// response drafts are owned by the authenticated account and tenant.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/features/driver_workspace/data/driver_workspace_dto.dart';
import 'package:tyre_pulse/features/driver_workspace/domain/driver_workspace.dart';

final Provider<DriverWorkspaceRepository> driverWorkspaceRepositoryProvider =
    Provider<DriverWorkspaceRepository>(
  (Ref ref) => DriverWorkspaceRepository(
    ref.watch(supabaseClientProvider),
    ref.watch(secureStoreProvider),
  ),
);

class DriverWorkspaceRepository {
  DriverWorkspaceRepository(this.client, this.store);
  final SupabaseClient client;
  final SecureKeyValueStore store;

  Future<DriverWorkspaceSnapshot> load(String owner, String? driverId) async {
    final List<String> keys = driverId == null
        ? <String>['drivers']
        : <String>['fines', 'assignments', 'records', 'events', 'work'];
    final String cacheKey = 'cache_${driverId ?? 'roster'}';
    DriverRow result = <String, Object?>{};
    try {
      for (int offset = 0; offset < 10000; offset += 100) {
        final DriverRow page = DriverWorkspaceDto.fromJson(
          await client.rpc(
            'driver_workspace',
            params: <String, Object?>{
              'p_driver_id': driverId,
              'p_offset': offset,
            },
          ),
        ).data;
        if (offset == 0) {
          result = <String, Object?>{
            ...page,
            for (final String key in keys) key: <DriverRow>[],
          };
        }
        for (final String key in keys) {
          (result[key]! as List<DriverRow>)
              .addAll(driverRows(page[key]).take(100));
        }
        if (keys.every((String key) => driverRows(page[key]).length <= 100)) {
          result['truncated'] = false;
          await save(owner, cacheKey, <String, Object?>{
            'saved_at': DateTime.now().toIso8601String(),
            'data': result,
          });
          return DriverWorkspaceDto.fromJson(result).toDomain();
        }
      }
      result['truncated'] = true;
      return DriverWorkspaceDto.fromJson(result).toDomain();
    } on SocketException {
      return _cached(owner, cacheKey);
    } on TimeoutException {
      return _cached(owner, cacheKey);
    }
  }

  Future<DriverWorkspaceSnapshot> _cached(String owner, String key) async {
    final DriverRow? cached = await readSaved(owner, key);
    final DateTime? saved = DateTime.tryParse('${cached?['saved_at'] ?? ''}');
    if (cached == null ||
        saved == null ||
        DateTime.now().difference(saved).inHours >= 24) {
      throw const SocketException(
        'No recent offline workspace. Connect and refresh.',
      );
    }
    return DriverWorkspaceDto.fromJson(cached['data']).toDomain(offline: true);
  }

  Future<void> command(
    String action,
    DriverRow payload,
    String requestId,
  ) async {
    await client.rpc<Object?>(
      'driver_workspace_command',
      params: <String, Object?>{
        'p_action': action,
        'p_payload': payload,
        'p_request_id': requestId,
      },
    );
  }

  Future<List<DriverRow>> options(
    String kind,
    String search,
    int offset,
  ) async =>
      driverRows(
        await client.rpc(
          'driver_workspace_options',
          params: <String, Object?>{
            'p_kind': kind,
            'p_search': search,
            'p_offset': offset,
          },
        ),
      );

  Future<String> signature(String responseId) async {
    final Map<String, dynamic> row = await client
        .from('driver_fine_responses')
        .select('signature')
        .eq('id', responseId)
        .single();
    return row['signature'] as String;
  }

  Future<String> evidenceUrl(String path) =>
      client.storage.from('driver-fine-evidence').createSignedUrl(path, 60);

  Future<void> uploadPhoto(
    DriverRow fine,
    String filePath,
    String kind,
    String requestId,
  ) async {
    final Uint8List bytes = await File(filePath).readAsBytes();
    if (bytes.length > 5 * 1024 * 1024 || bytes.length < 4) {
      throw const FormatException('Choose a photo up to 5 MB.');
    }
    final String extension = bytes[0] == 137 && bytes[1] == 80
        ? 'png'
        : bytes[0] == 255 && bytes[1] == 216
            ? 'jpg'
            : '';
    if (extension.isEmpty) {
      throw const FormatException('Choose a PNG or JPEG image.');
    }
    final String path =
        '${fine['organisation_id']}/${fine['driver_id']}/${fine['id']}/$requestId.$extension';
    try {
      await client.storage.from('driver-fine-evidence').uploadBinary(
            path,
            bytes,
            fileOptions: FileOptions(
              contentType: extension == 'png' ? 'image/png' : 'image/jpeg',
            ),
          );
    } on StorageException catch (e) {
      if (e.statusCode != '409') rethrow;
    }
    await command(
      'attach_evidence',
      <String, Object?>{
        'driver_id': fine['driver_id'],
        'fine_id': fine['id'],
        'object_path': path,
        'file_name': 'evidence.$extension',
        'kind': kind,
      },
      requestId,
    );
  }

  String _slot(String owner, String suffix) {
    if (owner.isEmpty) {
      throw const FormatException('Sign in before opening saved work.');
    }
    return 'driver_workspace_v1_${owner.replaceAll(RegExp(r'[^a-zA-Z0-9_-]'), '_')}_$suffix';
  }

  Future<DriverRow?> readSaved(String owner, String suffix) async {
    final result = await store.read(_slot(owner, suffix));
    if (result.failed) {
      throw StorageReadFailure(
        key: _slot(owner, suffix),
        status: result.status,
      );
    }
    return result.value == null
        ? null
        : Map<String, Object?>.from(jsonDecode(result.value!) as Map);
  }

  Future<void> save(String owner, String suffix, DriverRow data) =>
      store.write(_slot(owner, suffix), jsonEncode(data));
  Future<void> clear(String owner, String suffix) =>
      store.delete(_slot(owner, suffix));
}
