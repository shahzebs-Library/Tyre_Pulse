/// Encrypted, device-only persistence for an in-progress issue report.
library;

import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';

final Provider<ReportIssueDraftStore> reportIssueDraftStoreProvider =
    Provider<ReportIssueDraftStore>(
  (Ref ref) => ReportIssueDraftStore(ref.watch(secureStoreProvider)),
);

final class ReportIssueDraft {
  const ReportIssueDraft({
    required this.title,
    required this.site,
    required this.assetNo,
    required this.description,
    required this.restriction,
    required this.priority,
    required this.category,
    required this.operation,
    required this.requestWorkOrder,
    required this.photoLocalPaths,
    required this.savedAt,
  });

  factory ReportIssueDraft.fromJson(Map<String, dynamic> json) {
    final Object? paths = json['photoLocalPaths'];
    return ReportIssueDraft(
      title: json['title'] is String ? json['title'] as String : '',
      site: json['site'] is String ? json['site'] as String : '',
      assetNo: json['assetNo'] is String ? json['assetNo'] as String : '',
      description:
          json['description'] is String ? json['description'] as String : '',
      restriction:
          json['restriction'] is String ? json['restriction'] as String : '',
      priority: json['priority'] is String ? json['priority'] as String : '',
      category: json['category'] is String ? json['category'] as String : '',
      operation: json['operation'] is String ? json['operation'] as String : '',
      requestWorkOrder: json['requestWorkOrder'] == true,
      photoLocalPaths: paths is List
          ? paths.whereType<String>().toList(growable: false)
          : const <String>[],
      savedAt: DateTime.tryParse(json['savedAt'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
    );
  }

  final String title;
  final String site;
  final String assetNo;
  final String description;
  final String restriction;
  final String priority;
  final String category;
  final String operation;
  final bool requestWorkOrder;
  final List<String> photoLocalPaths;
  final DateTime savedAt;

  Map<String, Object?> toJson() => <String, Object?>{
        'title': title,
        'site': site,
        'assetNo': assetNo,
        'description': description,
        'restriction': restriction,
        'priority': priority,
        'category': category,
        'operation': operation,
        'requestWorkOrder': requestWorkOrder,
        'photoLocalPaths': photoLocalPaths,
        'savedAt': savedAt.toUtc().toIso8601String(),
      };
}

final class ReportIssueDraftStore {
  const ReportIssueDraftStore(this._store);

  final SecureKeyValueStore _store;

  static const String storageKey = 'tp_report_issue_drafts_v1';

  Future<ReportIssueDraft?> load(String scope) async {
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
      return ReportIssueDraft.fromJson(draft);
    } on FormatException {
      return null;
    }
  }

  Future<void> save(String scope, ReportIssueDraft draft) {
    return _store.updateValue(storageKey, (String? current) {
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

  Future<void> clear(String scope) {
    return _store.updateValue(storageKey, (String? current) {
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
    final Object? decoded = jsonDecode(raw);
    if (decoded is! Map<String, dynamic> ||
        decoded['entries'] is! Map<String, dynamic>) {
      throw const FormatException('Unsupported issue draft envelope.');
    }
    return decoded;
  }
}
