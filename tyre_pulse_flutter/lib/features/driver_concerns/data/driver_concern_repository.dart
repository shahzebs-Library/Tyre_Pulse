/// Driver Concerns: reads (RLS decides what the caller sees) and the RPC
/// writes from `supabase/migrations/20261127191000_driver_concerns.sql`.
///
/// RAISING WORKS OFFLINE. A driver at a remote site may have no signal, so a new
/// concern is written to a small on-device outbox ([DriverConcernOutbox]) with
/// a client uuid and the local photo paths, and sent when the app is online.
/// `driver_concern_raise` is idempotent on that uuid, so a retry after a lost
/// response cannot create a second case. Every OTHER action (sign, approve,
/// withdraw...) is online only: a signature or a decision must be recorded
/// against the case as it is now, never replayed against a case that moved on.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/features/driver_concerns/domain/driver_concern_rules.dart';
import 'package:uuid/uuid.dart';

final Provider<DriverConcernRepository> driverConcernRepositoryProvider =
    Provider<DriverConcernRepository>(
  (Ref ref) =>
      SupabaseDriverConcernRepository(ref.watch(supabaseClientProvider)),
);

/// The request could not reach the server.
final class ConcernOfflineFailure implements Exception {
  const ConcernOfflineFailure();
}

/// Someone else changed the case first (PT409). Reload and try again.
final class ConcernStaleFailure implements Exception {
  const ConcernStaleFailure();
}

/// The server refused, with its plain-language reason.
final class ConcernRefused implements Exception {
  const ConcernRefused(this.message);
  final String message;
  @override
  String toString() => message;
}

/// A concern waiting to be sent.
final class ConcernDraft {
  ConcernDraft({
    required this.category,
    required this.subtype,
    required this.text,
    required this.lang,
    List<String>? localPhotos,
    String? clientUuid,
    DateTime? createdAt,
  })  : localPhotos = localPhotos ?? <String>[],
        clientUuid = clientUuid ?? const Uuid().v4(),
        createdAt = createdAt ?? DateTime.now();

  factory ConcernDraft.fromJson(Map<String, Object?> j) => ConcernDraft(
        category: '${j['category']}',
        subtype: '${j['subtype']}',
        text: '${j['text']}',
        lang: j['lang'] as String?,
        localPhotos: (j['photos'] as List<Object?>? ?? const <Object?>[])
            .whereType<String>()
            .toList(),
        clientUuid: '${j['client_uuid']}',
        createdAt: DateTime.tryParse('${j['created_at']}'),
      );

  final String category;
  final String subtype;
  final String text;
  final String? lang;
  final List<String> localPhotos;
  final String clientUuid;
  final DateTime createdAt;

  Map<String, Object?> toJson() => <String, Object?>{
        'category': category,
        'subtype': subtype,
        'text': text,
        'lang': lang,
        'photos': localPhotos,
        'client_uuid': clientUuid,
        'created_at': createdAt.toIso8601String(),
      };
}

/// On-device outbox for concerns raised without signal.
final class DriverConcernOutbox {
  static const String _key = 'driver_concerns.outbox.v1';

  Future<List<ConcernDraft>> read() async {
    final SharedPreferences p = await SharedPreferences.getInstance();
    final String? raw = p.getString(_key);
    if (raw == null || raw.isEmpty) return <ConcernDraft>[];
    try {
      return (jsonDecode(raw) as List<Object?>)
          .whereType<Map<Object?, Object?>>()
          .map(
            (Map<Object?, Object?> m) =>
                ConcernDraft.fromJson(Map<String, Object?>.from(m)),
          )
          .toList();
    } on FormatException {
      return <ConcernDraft>[];
    }
  }

  Future<void> _write(List<ConcernDraft> drafts) async {
    final SharedPreferences p = await SharedPreferences.getInstance();
    await p.setString(
      _key,
      jsonEncode(drafts.map((ConcernDraft d) => d.toJson()).toList()),
    );
  }

  Future<void> add(ConcernDraft d) async {
    final List<ConcernDraft> all = await read();
    if (all.any((ConcernDraft x) => x.clientUuid == d.clientUuid)) return;
    await _write(<ConcernDraft>[...all, d]);
  }

  Future<void> remove(String clientUuid) async {
    final List<ConcernDraft> all = await read();
    await _write(
      all.where((ConcernDraft x) => x.clientUuid != clientUuid).toList(),
    );
  }
}

abstract interface class DriverConcernRepository {
  Future<List<DriverConcern>> list();
  Future<ConcernDetail> get(String id);

  /// Sends now, or keeps it in the outbox and returns null when offline.
  Future<String?> raise(ConcernDraft draft);

  /// Sends everything waiting in the outbox; returns how many were sent.
  Future<int> flushOutbox();
  Future<List<ConcernDraft>> pending();

  Future<void> command(
    String id,
    String action, {
    Map<String, Object?> payload,
    int? expectedVersion,
  });

  /// Machine translation, stored on the case. Null when unavailable.
  Future<String?> translate(
    String id,
    String source,
    String text,
    String targetLang,
  );

  Future<String?> signedPhotoUrl(String path);
}

final class SupabaseDriverConcernRepository implements DriverConcernRepository {
  SupabaseDriverConcernRepository(this._client, {DriverConcernOutbox? outbox})
      : _outbox = outbox ?? DriverConcernOutbox();

  final SupabaseClient _client;
  final DriverConcernOutbox _outbox;

  static const String bucket = 'driver-concerns';

  Future<T> _call<T>(Future<T> Function() run) async {
    try {
      return await run().timeout(const Duration(seconds: 25));
    } on SocketException {
      throw const ConcernOfflineFailure();
    } on TimeoutException {
      throw const ConcernOfflineFailure();
    } on PostgrestException catch (e) {
      if (e.code == 'PT409') throw const ConcernStaleFailure();
      throw ConcernRefused(e.message);
    }
  }

  @override
  Future<List<DriverConcern>> list() => _call(() async {
        final List<dynamic> rows = await _client
            .from('driver_concerns')
            .select()
            .order('created_at', ascending: false)
            .limit(200);
        return rows
            .whereType<Map<String, dynamic>>()
            .map(DriverConcern.fromJson)
            .toList(growable: false);
      });

  @override
  Future<ConcernDetail> get(String id) => _call(() async {
        final Object? data = await _client.rpc<Object?>(
          'driver_concern_get',
          params: <String, Object?>{'p_id': id},
        );
        return ConcernDetail.fromJson(
          Map<String, Object?>.from(data as Map? ?? const {}),
        );
      });

  Future<String?> _orgId() async {
    final String? uid = _client.auth.currentUser?.id;
    if (uid == null) return null;
    final Map<String, dynamic>? row = await _client
        .from('profiles')
        .select('org_id')
        .eq('id', uid)
        .maybeSingle();
    return row?['org_id'] as String?;
  }

  Future<String> _send(ConcernDraft d) async {
    final List<String> paths = <String>[];
    if (d.localPhotos.isNotEmpty) {
      final String? org = await _orgId();
      final String? uid = _client.auth.currentUser?.id;
      if (org == null || uid == null) {
        throw const ConcernRefused('Not signed in');
      }
      for (int i = 0; i < d.localPhotos.length && i < 6; i++) {
        final File f = File(d.localPhotos[i]);
        if (!f.existsSync()) {
          continue; // honest: a photo the phone lost is not sent
        }
        final String path = concernPhotoPath(org, uid, d.clientUuid, i);
        await _client.storage.from(bucket).upload(
              path,
              f,
              fileOptions:
                  const FileOptions(upsert: true, contentType: 'image/jpeg'),
            );
        paths.add(path);
      }
    }
    final Object? res = await _client.rpc<Object?>(
      'driver_concern_raise',
      params: <String, Object?>{
        'p_category': d.category,
        'p_subtype': d.subtype,
        'p_text': d.text,
        'p_lang': d.lang,
        'p_photos': paths,
        'p_client_uuid': d.clientUuid,
      },
    );
    final Map<String, Object?> out =
        Map<String, Object?>.from(res as Map? ?? const {});
    return '${out['case_no'] ?? ''}';
  }

  @override
  Future<String?> raise(ConcernDraft draft) async {
    try {
      return await _call(() => _send(draft));
    } on ConcernOfflineFailure {
      await _outbox.add(draft);
      return null;
    } on StorageException {
      await _outbox.add(draft);
      return null;
    }
  }

  @override
  Future<int> flushOutbox() async {
    int sent = 0;
    for (final ConcernDraft d in await _outbox.read()) {
      try {
        await _call(() => _send(d));
        await _outbox.remove(d.clientUuid);
        sent++;
      } on ConcernOfflineFailure {
        break; // still offline: try the rest next time
      } on StorageException {
        break; // photo upload failed: keep it and try again later
      } on ConcernRefused {
        // A permanent refusal stays in the outbox so it is never lost silently;
        // the list shows it as waiting.
      }
    }
    return sent;
  }

  @override
  Future<List<ConcernDraft>> pending() => _outbox.read();

  @override
  Future<void> command(
    String id,
    String action, {
    Map<String, Object?> payload = const <String, Object?>{},
    int? expectedVersion,
  }) =>
      _call(
        () => _client.rpc<Object?>(
          'driver_concern_command',
          params: <String, Object?>{
            'p_id': id,
            'p_action': action,
            'p_payload': payload,
            'p_expected_version': expectedVersion,
          },
        ),
      );

  @override
  Future<String?> translate(
    String id,
    String source,
    String text,
    String targetLang,
  ) async {
    if (!concernLanguages.contains(targetLang) || text.trim().isEmpty) {
      return null;
    }
    try {
      final FunctionResponse res = await _client.functions.invoke(
        'chat-ai',
        body: <String, Object?>{
          'system':
              'You translate short workplace messages. Reply with JSON only: {"detected":"<iso code>","text":"<translation>"}. Use one of: en, ar, ur, hi, bn, ps, ne, tl for detected. Keep names, numbers and dates unchanged.',
          'user': 'Translate into $targetLang:\n$text',
          'max_tokens': 800,
        },
      ).timeout(const Duration(seconds: 30));
      final Object? data = res.data;
      if (data is! Map) return null;
      final String raw = '${data['content'] ?? ''}';
      final int a = raw.indexOf('{');
      final int b = raw.lastIndexOf('}');
      if (a < 0 || b <= a) return null;
      final Map<String, Object?> parsed =
          Map<String, Object?>.from(jsonDecode(raw.substring(a, b + 1)) as Map);
      final String? translated = parsed['text'] as String?;
      if (translated == null || translated.isEmpty) return null;
      final String? detected = concernLanguages.contains(parsed['detected'])
          ? parsed['detected'] as String?
          : null;
      await _client.rpc<Object?>(
        'driver_concern_add_translation',
        params: <String, Object?>{
          'p_id': id,
          'p_source': source,
          'p_source_id': '',
          'p_target_lang': targetLang,
          'p_text': translated,
          'p_model': '${data['model'] ?? 'claude-haiku-4-5'}',
          'p_detected_lang': detected,
        },
      );
      return translated;
    } on Object {
      return null;
    }
  }

  @override
  Future<String?> signedPhotoUrl(String path) async {
    try {
      return await _client.storage.from(bucket).createSignedUrl(path, 300);
    } on Object {
      return null;
    }
  }
}
