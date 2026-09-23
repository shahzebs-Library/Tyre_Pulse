/// The narrow table/storage surface the mock M4/M5 repositories need.
///
/// One Supabase adapter, two repositories, one in-memory fake in tests. Every
/// table name comes from [SupabaseTables]; nothing here types a string into
/// `.from(...)`. Evidence uploads follow the production `accident-photos`
/// bucket's `accidents/<owner>/<file>` object path exactly as the queued
/// media uploader writes it, so an online upload from a workspace lands
/// beside the phone's own offline evidence.
library;

import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';

const String accidentCaseEvidenceBucket = 'accident-photos';

abstract interface class AccidentCaseRows {
  /// Rows of [table] matching every `column = value` in [eq], newest first
  /// by [orderBy].
  Future<List<Map<String, dynamic>>> select(
    String table,
    Map<String, Object> eq, {
    String orderBy = 'created_at',
    bool ascending = false,
    int limit = 200,
  });

  Future<Map<String, dynamic>> insert(String table, Map<String, Object?> row);

  Future<Map<String, dynamic>> update(
    String table,
    String id,
    Map<String, Object?> patch,
  );

  /// Uploads one local file to the private evidence bucket and returns the
  /// opaque `tp-storage://` reference the database stores.
  Future<String> uploadEvidence({
    required String localPath,
    required String fileName,
  });

  String? currentUserId();
}

final class SupabaseAccidentCaseRows implements AccidentCaseRows {
  SupabaseAccidentCaseRows(this._client);

  final SupabaseClient _client;

  @override
  Future<List<Map<String, dynamic>>> select(
    String table,
    Map<String, Object> eq, {
    String orderBy = 'created_at',
    bool ascending = false,
    int limit = 200,
  }) =>
      _client
          .from(table)
          .select()
          .match(eq)
          .order(orderBy, ascending: ascending)
          .limit(limit);

  @override
  Future<Map<String, dynamic>> insert(
    String table,
    Map<String, Object?> row,
  ) =>
      _client.from(table).insert(row).select().single();

  @override
  Future<Map<String, dynamic>> update(
    String table,
    String id,
    Map<String, Object?> patch,
  ) =>
      _client.from(table).update(patch).eq('id', id).select().single();

  @override
  Future<String> uploadEvidence({
    required String localPath,
    required String fileName,
  }) async {
    final String remotePath = accidentEvidenceObjectPath(
      fileName: fileName,
      userId: currentUserId(),
    );
    await _client.storage.from(accidentCaseEvidenceBucket).upload(
          remotePath,
          File(localPath),
          fileOptions: FileOptions(
            upsert: false,
            contentType: _contentType(fileName),
          ),
        );
    return 'tp-storage://$accidentCaseEvidenceBucket/$remotePath';
  }

  @override
  String? currentUserId() => _client.auth.currentUser?.id;
}

/// Mirrors `storageObjectPath` in `lib/core/sync/supabase_command_pusher.dart`
/// for the accident bucket (that helper is `@visibleForTesting`, so it is
/// restated here rather than imported): `accidents/<first 8 of owner>/<file>`.
String accidentEvidenceObjectPath({
  required String fileName,
  required String? userId,
}) {
  final String name = fileName.trim();
  if (name.isEmpty ||
      name == '.' ||
      name == '..' ||
      name.contains('/') ||
      name.contains('\\')) {
    throw ArgumentError.value(fileName, 'fileName', 'must be one basename');
  }
  final String owner = userId?.trim() ?? '';
  if (owner.isEmpty) {
    throw StateError(
      'Accident evidence cannot be uploaded without an authenticated owner.',
    );
  }
  final String segment = owner.length <= 8 ? owner : owner.substring(0, 8);
  return 'accidents/$segment/$name';
}

String? _contentType(String fileName) {
  final String lower = fileName.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return null;
}

final accidentCaseRowsProvider = Provider<AccidentCaseRows>(
  (ref) => SupabaseAccidentCaseRows(ref.watch(supabaseClientProvider)),
);

String basenameOf(String path) {
  final int slash = path.lastIndexOf(RegExp(r'[\\/]'));
  return slash < 0 ? path : path.substring(slash + 1);
}
