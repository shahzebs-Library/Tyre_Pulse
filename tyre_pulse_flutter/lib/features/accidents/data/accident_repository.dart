library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/accidents/data/accident_dto.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';

const String accidentWorkstreamColumns =
    'id,workstream_key,status,required,team,owner_role,progress_pct,'
    'not_applicable,na_reason,notes,updated_at';

abstract interface class AccidentRemoteSource {
  Future<List<Map<String, dynamic>>> listPage({
    required int from,
    required int to,
    required String? country,
    String? reporterId,
  });
  Future<Map<String, dynamic>?> byId(String id);
  Future<List<Map<String, dynamic>>> workstreams({
    required String accidentId,
    required String? country,
  });
}

final class SupabaseAccidentRemoteSource
    with SupabaseGateway
    implements AccidentRemoteSource {
  SupabaseAccidentRemoteSource(this._client);
  final SupabaseClient _client;

  @override
  Future<List<Map<String, dynamic>>> listPage({
    required int from,
    required int to,
    required String? country,
    String? reporterId,
  }) =>
      guard(() async {
        var query = _client.from(SupabaseTables.accidents).select();
        if (reporterId != null && reporterId.trim().isNotEmpty) {
          query = query.eq('reported_by', reporterId);
        }
        if (country != null && country.trim().isNotEmpty) {
          query = query.or('country.eq.$country,country.is.null');
        }
        return await query
            .order('created_at', ascending: false)
            .order('id')
            .range(from, to);
      });

  @override
  Future<Map<String, dynamic>?> byId(String id) => guard(
        () => _client
            .from(SupabaseTables.accidents)
            .select()
            .eq('id', id)
            .maybeSingle(),
      );

  @override
  Future<List<Map<String, dynamic>>> workstreams({
    required String accidentId,
    required String? country,
  }) =>
      guard(() async {
        var query = _client
            .from(SupabaseTables.accidentCaseWorkstreams)
            .select(accidentWorkstreamColumns)
            .eq('accident_id', accidentId);
        if (country != null && country.trim().isNotEmpty) {
          query = query.or('country.eq.$country,country.is.null');
        }
        return await query.limit(50);
      });
}

abstract interface class AccidentRepository {
  Future<AccidentListPage> list({
    required int offset,
    required int pageSize,
    String? country,
    String? reporterId,
  });
  Future<AccidentRecord?> byId(String id);
  Future<AccidentCaseSnapshot?> caseById(String id, {String? country});
}

final class SupabaseAccidentRepository implements AccidentRepository {
  SupabaseAccidentRepository(this._source);
  final AccidentRemoteSource _source;

  @override
  Future<AccidentListPage> list({
    required int offset,
    required int pageSize,
    String? country,
    String? reporterId,
  }) async {
    final int safeSize = pageSize.clamp(1, 100);
    final List<Map<String, dynamic>> rows = await _source.listPage(
      from: offset,
      to: offset + safeSize,
      country: country,
      reporterId: reporterId,
    );
    final bool hasMore = rows.length > safeSize;
    final Iterable<Map<String, dynamic>> page =
        hasMore ? rows.take(safeSize) : rows;
    return AccidentListPage(
      items: List<AccidentRecord>.unmodifiable(
        page.map((Map<String, dynamic> row) => AccidentDto(row).toDomain()),
      ),
      hasMore: hasMore,
    );
  }

  @override
  Future<AccidentRecord?> byId(String id) async {
    if (id.trim().isEmpty) return null;
    final Map<String, dynamic>? row = await _source.byId(id);
    return row == null ? null : AccidentDto(row).toDomain();
  }

  @override
  Future<AccidentCaseSnapshot?> caseById(
    String id, {
    String? country,
  }) async {
    final AccidentRecord? accident = await byId(id);
    if (accident == null) return null;
    try {
      final List<Map<String, dynamic>> rows = await _source.workstreams(
        accidentId: id,
        country: country,
      );
      final List<AccidentWorkstream> workstreams = rows
          .map(
            (Map<String, dynamic> row) => AccidentWorkstreamDto(row).toDomain(),
          )
          .toList(growable: false)
        ..sort((AccidentWorkstream a, AccidentWorkstream b) {
          final int ai = accidentWorkstreamOrder.indexOf(a.key);
          final int bi = accidentWorkstreamOrder.indexOf(b.key);
          return (ai < 0 ? 99 : ai).compareTo(bi < 0 ? 99 : bi);
        });
      return AccidentCaseSnapshot(
        accident: accident,
        provisioned: true,
        workstreams: List<AccidentWorkstream>.unmodifiable(workstreams),
      );
    } on SupabaseFailure catch (failure) {
      if (failure.isSchemaMismatch) {
        return AccidentCaseSnapshot(accident: accident, provisioned: false);
      }
      rethrow;
    }
  }
}
