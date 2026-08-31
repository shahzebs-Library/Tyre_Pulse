/// Encrypted, device-only persistence for one in-progress accident report per
/// user/workspace scope.
library;

import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_report_intake.dart';

final Provider<AccidentReportDraftStore> accidentReportDraftStoreProvider =
    Provider<AccidentReportDraftStore>(
  (Ref ref) => AccidentReportDraftStore(ref.watch(secureStoreProvider)),
);

final class AccidentReportDraftStore {
  const AccidentReportDraftStore(this._store);

  final SecureKeyValueStore _store;

  static const String storageKey = 'tp_accident_report_drafts_v1';

  static String scopeKey({
    required String workspaceId,
    required String userId,
    String? country,
  }) =>
      <String>[
        workspaceId.trim(),
        country?.trim() ?? '',
        userId.trim(),
      ].join('|');

  Future<AccidentReportIntakeDraft?> load(String scope) async {
    final read = await _store.read(storageKey);
    if (read.failed) {
      throw StorageReadFailure(key: storageKey, status: read.status);
    }
    final String? raw = read.value;
    if (raw == null || raw.trim().isEmpty) return null;
    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) return null;
      final Object? entries = decoded['entries'];
      if (entries is! Map<String, dynamic>) return null;
      final Object? draft = entries[scope];
      if (draft is! Map<String, dynamic>) return null;
      return AccidentReportIntakeDraft.fromJson(draft);
    } on FormatException {
      return null;
    }
  }

  Future<void> save(
    String scope,
    AccidentReportIntakeDraft draft,
  ) async {
    await _store.updateValue(storageKey, (String? current) {
      final Map<String, dynamic> envelope = _decodeEnvelope(current);
      final Map<String, dynamic> entries =
          Map<String, dynamic>.of(envelope['entries'] as Map<String, dynamic>);
      entries[scope] = draft.toJson();
      return jsonEncode(<String, Object?>{
        'version': 1,
        'entries': entries,
      });
    });
  }

  Future<void> clear(String scope) async {
    await _store.updateValue(storageKey, (String? current) {
      final Map<String, dynamic> envelope = _decodeEnvelope(current);
      final Map<String, dynamic> entries =
          Map<String, dynamic>.of(envelope['entries'] as Map<String, dynamic>)
            ..remove(scope);
      if (entries.isEmpty) return null;
      return jsonEncode(<String, Object?>{
        'version': 1,
        'entries': entries,
      });
    });
  }

  Map<String, dynamic> _decodeEnvelope(String? raw) {
    if (raw == null || raw.trim().isEmpty) {
      return <String, dynamic>{'entries': <String, dynamic>{}};
    }
    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic> ||
          decoded['entries'] is! Map<String, dynamic>) {
        throw const FormatException('Invalid accident draft envelope.');
      }
      return decoded;
    } on FormatException {
      // A value with an unknown shape must not be silently overwritten. The
      // secure store's update guard protects read failures; this protects a
      // successfully-read but incompatible version just as conservatively.
      throw const FormatException(
        'The saved accident draft uses an unsupported format.',
      );
    }
  }
}
