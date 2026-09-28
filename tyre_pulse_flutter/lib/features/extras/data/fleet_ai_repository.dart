/// Data access for the Fleet AI screen: exact grounding counts and the
/// `chat-ai` edge function (the only edge function the mobile app invokes,
/// [SupabaseFunctions.chatAi]).
///
/// Request shape mirrors `mobile/app/(app)/ai/index.tsx`:
/// `{system, messages, max_tokens}` in, `{content}` out; a non-2xx carries
/// `{error}` and a status the screen maps to honest copy (403 AI switched off,
/// 402 budget spent, 429 rate limited).
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/extras/domain/fleet_ai.dart';

/// Boundary the screen talks to.
abstract interface class FleetAiRepository {
  /// Reads the grounding counts. Never throws: each count that fails is null.
  Future<FleetAiSnapshot> loadSnapshot({String? country, DateTime? now});

  /// Asks the assistant. Throws [FleetAiFailure].
  Future<String> ask({
    required String system,
    required List<Map<String, String>> messages,
  });
}

/// Production implementation.
final class SupabaseFleetAiRepository implements FleetAiRepository {
  SupabaseFleetAiRepository(this._client);

  final SupabaseClient _client;

  static const Duration _countTimeout = Duration(seconds: 12);
  static const Duration _askTimeout = Duration(seconds: 60);

  @override
  Future<FleetAiSnapshot> loadSnapshot({String? country, DateTime? now}) async {
    final DateTime today = now ?? DateTime.now();
    final String since = _isoDate(today.subtract(const Duration(days: 30)));
    final String? countryFilter = _countryFilter(country);

    Future<int?> count(
      String table,
      PostgrestFilterBuilder<int> Function(PostgrestFilterBuilder<int>) narrow,
    ) async {
      try {
        PostgrestFilterBuilder<int> query =
            narrow(_client.from(table).count(CountOption.exact));
        if (countryFilter != null) query = query.or(countryFilter);
        return await query.timeout(_countTimeout);
      } on Object {
        // Reported as unavailable, never as zero.
        return null;
      }
    }

    final List<int?> results = await Future.wait(<Future<int?>>[
      count(SupabaseTables.vehicleFleet, (q) => q),
      count(SupabaseTables.tyreRecords, (q) => q.eq('risk_level', 'Critical')),
      count(SupabaseTables.tyreRecords, (q) => q.eq('risk_level', 'High')),
      count(SupabaseTables.correctiveActions, (q) => q.eq('status', 'Open')),
      count(SupabaseTables.accidents, (q) => q.gte('incident_date', since)),
    ]);
    return FleetAiSnapshot(
      vehicles: results[0],
      criticalTyres: results[1],
      highRiskTyres: results[2],
      openCorrectiveActions: results[3],
      accidentsLast30Days: results[4],
    );
  }

  @override
  Future<String> ask({
    required String system,
    required List<Map<String, String>> messages,
  }) async {
    final FunctionResponse response;
    try {
      response = await _client.functions.invoke(
        SupabaseFunctions.chatAi,
        body: <String, Object?>{
          'system': system,
          'messages': messages,
          'max_tokens': 1200,
          'agent': 'fleet_ai',
          'source': 'mobile',
        },
      ).timeout(_askTimeout);
    } on FunctionException catch (error) {
      throw FleetAiFailure(fleetAiFailureForStatus(error.status));
    } on Object catch (error) {
      throw FleetAiFailure(
        _looksOffline(error)
            ? FleetAiFailureKind.offline
            : FleetAiFailureKind.unavailable,
      );
    }
    final Object? data = response.data;
    final Object? content = data is Map ? data['content'] : null;
    if (content is! String || content.trim().isEmpty) {
      throw const FleetAiFailure(FleetAiFailureKind.unavailable);
    }
    return content.trim();
  }

  static bool _looksOffline(Object error) {
    final String text = error.toString().toLowerCase();
    return text.contains('socketexception') ||
        text.contains('clientexception') ||
        text.contains('failed host lookup') ||
        text.contains('connection');
  }

  static String _isoDate(DateTime value) =>
      '${value.year.toString().padLeft(4, '0')}-'
      '${value.month.toString().padLeft(2, '0')}-'
      '${value.day.toString().padLeft(2, '0')}';

  /// Null-safe country filter: a country-less row is visible to everyone in
  /// the SQL, so a strict `.eq` would hide it (PROJECT_MEMORY, 55,606 job
  /// cards). Null means no client-side filter; RLS scopes the read.
  static String? _countryFilter(String? country) {
    final String value = (country ?? '').trim();
    if (value.isEmpty || value.contains(',') || value.contains(')')) {
      return null;
    }
    return 'country.is.null,country.eq.$value';
  }
}
