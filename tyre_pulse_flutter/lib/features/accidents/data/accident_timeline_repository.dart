/// Online reads and writes for the M1 "Case timeline & notifications"
/// workspace.
///
/// Reads FOUR ledgers plus the dispatch leg and the accident's GPS fix, each
/// guarded on its own: a ledger that does not exist on this database yet
/// (42P01 / 42703 / PGRST204) is reported by name as "not provisioned", and
/// the feed is still built from the ledgers that do. Communications are the
/// primary ledger, so a real read failure there is surfaced to the screen
/// instead of quietly rendering an empty timeline.
///
/// NOTE: a parallel author owns `accident_sla_repository.dart`. It was not on
/// disk when this file was written, so SLA rows are read here through the
/// same guarded pattern and shaped into [AccidentSlaRow]. Swap
/// [AccidentTimelineRemote.slaInstances] for that repository once it lands.
library;

import 'package:flutter/foundation.dart' show immutable;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_handover_gating.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_timeline_feed.dart';

final accidentTimelineRepositoryProvider =
    Provider<AccidentTimelineRepository>(
  (ref) => AccidentTimelineRepository(
    SupabaseAccidentTimelineRemote(ref.watch(supabaseClientProvider)),
  ),
);

/// Ledger names used in [AccidentTimelineData.unavailable] and
/// [AccidentTimelineData.failed].
abstract final class TimelineLedger {
  static const String communications = 'communications';
  static const String evidence = 'evidence';
  static const String sla = 'sla';
  static const String dispatch = 'dispatch';
  static const String gps = 'gps';
}

abstract interface class AccidentTimelineRemote {
  Future<List<Map<String, Object?>>> communications(String accidentId);
  Future<List<Map<String, Object?>>> evidence(String accidentId);
  Future<List<Map<String, Object?>>> slaInstances(String accidentId);
  Future<Map<String, Object?>?> latestDispatch(String accidentId);

  /// `latitude`, `longitude` from the accident row.
  Future<Map<String, Object?>?> accidentPosition(String accidentId);
  Future<Map<String, Object?>> insertCommunication(Map<String, Object?> row);
  String? currentUserId();
}

final class SupabaseAccidentTimelineRemote implements AccidentTimelineRemote {
  const SupabaseAccidentTimelineRemote(this._client);
  final SupabaseClient _client;

  static List<Map<String, Object?>> _rows(List<Map<String, dynamic>> rows) =>
      rows
          .map((Map<String, dynamic> r) => Map<String, Object?>.from(r))
          .toList(growable: false);

  @override
  Future<List<Map<String, Object?>>> communications(String accidentId) async =>
      _rows(
        await _client
            .from(SupabaseTables.accidentCaseCommunications)
            .select(
              'id,channel,direction,subject,body,from_party,to_party,'
              'external_party_type,attachments,workstream_key,occurred_at,'
              'author_name,created_at',
            )
            .eq('accident_id', accidentId)
            .order('occurred_at', ascending: false)
            .order('id', ascending: false)
            .limit(500),
      );

  @override
  Future<List<Map<String, Object?>>> evidence(String accidentId) async =>
      _rows(
        await _client
            .from(SupabaseTables.accidentEvidence)
            .select(
              'id,workstream_key,requirement_key,kind,file_name,mandatory,'
              'verification_status,uploaded_at,created_at',
            )
            .eq('accident_id', accidentId)
            .order('created_at', ascending: false)
            .order('id', ascending: false)
            .limit(500),
      );

  @override
  Future<List<Map<String, Object?>>> slaInstances(String accidentId) async =>
      _rows(
        await _client
            .from(SupabaseTables.accidentSlaInstances)
            .select(
              'id,sla_key,name,workstream_key,team,start_at,due_at,'
              'warning_at,state,completed_at',
            )
            .eq('accident_id', accidentId)
            .order('start_at', ascending: false)
            .order('id', ascending: false)
            .limit(100),
      );

  @override
  Future<Map<String, Object?>?> latestDispatch(String accidentId) async {
    final Map<String, dynamic>? row = await _client
        .from(SupabaseTables.accidentDispatches)
        .select()
        .eq('accident_id', accidentId)
        .order('created_at', ascending: false)
        .order('id', ascending: false)
        .limit(1)
        .maybeSingle();
    return row == null ? null : Map<String, Object?>.from(row);
  }

  @override
  Future<Map<String, Object?>?> accidentPosition(String accidentId) async {
    final Map<String, dynamic>? row = await _client
        .from(SupabaseTables.accidents)
        .select('latitude,longitude')
        .eq('id', accidentId)
        .maybeSingle();
    return row == null ? null : Map<String, Object?>.from(row);
  }

  @override
  Future<Map<String, Object?>> insertCommunication(
    Map<String, Object?> row,
  ) async {
    final Map<String, dynamic> saved = await _client
        .from(SupabaseTables.accidentCaseCommunications)
        .insert(row)
        .select()
        .single();
    return Map<String, Object?>.from(saved);
  }

  @override
  String? currentUserId() => _client.auth.currentUser?.id;
}

@immutable
final class AccidentTimelineData {
  const AccidentTimelineData({
    this.communications = const <AccidentCommunication>[],
    this.evidence = const <AccidentEvidenceRow>[],
    this.slas = const <AccidentSlaRow>[],
    this.dispatch,
    this.gps,
    this.unavailable = const <String>{},
    this.failed = const <String>{},
  });

  final List<AccidentCommunication> communications;
  final List<AccidentEvidenceRow> evidence;
  final List<AccidentSlaRow> slas;
  final AccidentDispatch? dispatch;
  final String? gps;

  /// Ledgers the database does not have yet ([TimelineLedger] names).
  final Set<String> unavailable;

  /// Ledgers whose read failed for a non-schema reason.
  final Set<String> failed;
}

class AccidentTimelineRepository with SupabaseGateway {
  AccidentTimelineRepository(this._remote, {DateTime Function()? clock})
      : _clock = clock ?? DateTime.now;

  final AccidentTimelineRemote _remote;
  final DateTime Function() _clock;

  Future<AccidentTimelineData> load(String accidentId) async {
    if (accidentId.trim().isEmpty) {
      throw ArgumentError('An accident id is required');
    }
    final Set<String> unavailable = <String>{};
    final Set<String> failed = <String>{};

    // Primary ledger: a genuine failure propagates.
    List<AccidentCommunication> communications =
        const <AccidentCommunication>[];
    try {
      final List<Map<String, Object?>> rows =
          await guard(() => _remote.communications(accidentId));
      communications = rows.map(AccidentCommunication.fromRow).toList();
    } on SupabaseFailure catch (failure) {
      if (!failure.isSchemaMismatch) rethrow;
      unavailable.add(TimelineLedger.communications);
    }

    Future<List<Map<String, Object?>>> secondary(
      String ledger,
      Future<List<Map<String, Object?>>> Function() read,
    ) async {
      try {
        return await guard(read);
      } on SupabaseFailure catch (failure) {
        (failure.isSchemaMismatch ? unavailable : failed).add(ledger);
        return const <Map<String, Object?>>[];
      }
    }

    final List<AccidentEvidenceRow> evidence =
        (await secondary(
      TimelineLedger.evidence,
      () => _remote.evidence(accidentId),
    ))
            .map(AccidentEvidenceRow.fromRow)
            .toList();
    final List<AccidentSlaRow> slas =
        (await secondary(
      TimelineLedger.sla,
      () => _remote.slaInstances(accidentId),
    ))
            .map(AccidentSlaRow.fromRow)
            .toList();

    AccidentDispatch? dispatch;
    try {
      final Map<String, Object?>? row =
          await guard(() => _remote.latestDispatch(accidentId));
      dispatch = row == null ? null : AccidentDispatch.fromRow(row);
    } on SupabaseFailure catch (failure) {
      (failure.isSchemaMismatch ? unavailable : failed)
          .add(TimelineLedger.dispatch);
    }

    String? gps;
    try {
      final Map<String, Object?>? row =
          await guard(() => _remote.accidentPosition(accidentId));
      gps = _gps(row);
    } on SupabaseFailure catch (failure) {
      (failure.isSchemaMismatch ? unavailable : failed).add(TimelineLedger.gps);
    }

    return AccidentTimelineData(
      communications: communications,
      evidence: evidence,
      slas: slas,
      dispatch: dispatch,
      gps: gps,
      unavailable: unavailable,
      failed: failed,
    );
  }

  /// "Add timeline note": an internal comment on the case ledger.
  Future<AccidentCommunication> addNote({
    required String accidentId,
    required String body,
    String? authorName,
    String? workstreamKey,
    String? country,
    String? site,
  }) async {
    if (accidentId.trim().isEmpty || body.trim().isEmpty) {
      throw ArgumentError('An accident id and a note are required');
    }
    return _insert(
      accidentId: accidentId,
      channel: 'comment',
      direction: 'internal',
      body: body,
      authorName: authorName,
      workstreamKey: workstreamKey,
      country: country,
      site: site,
    );
  }

  /// "Notify participants": LOGS an outbound in-app notification on the case
  /// ledger addressed to the named groups. It does not itself deliver
  /// anything - delivery is the server's notification engine - and the
  /// widget says so.
  Future<AccidentCommunication> notifyParticipants({
    required String accidentId,
    required String subject,
    required String body,
    required List<String> toGroups,
    String? authorName,
    String? country,
    String? site,
  }) async {
    if (accidentId.trim().isEmpty ||
        subject.trim().isEmpty ||
        toGroups.isEmpty) {
      throw ArgumentError(
        'An accident id, subject and recipients are required',
      );
    }
    return _insert(
      accidentId: accidentId,
      channel: 'in_app',
      direction: 'outbound',
      subject: subject,
      body: body,
      toParty: toGroups.map((String g) => g.trim()).join(', '),
      authorName: authorName,
      country: country,
      site: site,
    );
  }

  Future<AccidentCommunication> _insert({
    required String accidentId,
    required String channel,
    required String direction,
    String? subject,
    String? body,
    String? toParty,
    String? authorName,
    String? workstreamKey,
    String? country,
    String? site,
  }) =>
      guard(() async {
        final String? actor = _remote.currentUserId();
        if (actor == null || actor.isEmpty) {
          throw const AppError.authentication();
        }
        final Map<String, Object?> saved =
            await _remote.insertCommunication(<String, Object?>{
          'accident_id': accidentId.trim(),
          'country': _clean(country),
          'site': _clean(site),
          'channel': channel,
          'direction': direction,
          'subject': _clean(subject),
          'body': _clean(body),
          'from_party': _clean(authorName),
          'to_party': _clean(toParty),
          'workstream_key': _clean(workstreamKey),
          'occurred_at': _clock().toUtc().toIso8601String(),
          'author_id': actor,
          'author_name': _clean(authorName),
        });
        final AccidentCommunication row = AccidentCommunication.fromRow(saved);
        if (row.id.isEmpty) {
          throw StateError('The server did not confirm the entry');
        }
        return row;
      });

  static String? _gps(Map<String, Object?>? row) {
    if (row == null) return null;
    final num? lat = _num(row['latitude']);
    final num? lng = _num(row['longitude']);
    if (lat == null || lng == null) return null;
    return '${lat.toStringAsFixed(5)}, ${lng.toStringAsFixed(5)}';
  }

  static num? _num(Object? value) {
    if (value is num) return value;
    if (value is String) return num.tryParse(value.trim());
    return null;
  }

  static String? _clean(String? value) {
    final String text = value?.trim() ?? '';
    return text.isEmpty ? null : text;
  }
}
