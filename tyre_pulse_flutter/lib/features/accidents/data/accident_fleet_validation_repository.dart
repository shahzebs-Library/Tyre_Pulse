/// M6 Fleet validation checklist rows (`accident_fleet_validation_items`).
///
/// The table is created by the AUTHORED, NOT YET APPLIED migration
/// `20260916130000_accident_mock_field_parity.sql`. Until it is applied every
/// read returns [AccidentFleetValidationLoad.provisioned] false and the
/// screen shows the checklist from the case record without pretending any
/// row was ticked. Writes are online-only through the signed-in user's RLS.
library;

import 'package:flutter/foundation.dart' show immutable;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/features/accidents/data/accident_case_schema.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';

typedef FleetValidationRead = Future<List<Map<String, dynamic>>> Function(
  String accidentId,
);

/// Upserts one row on (accident_id, item_key) and returns the stored row.
typedef FleetValidationUpsert = Future<Map<String, dynamic>> Function(
  Map<String, Object?> row,
);

final Provider<AccidentFleetValidationRepository>
    accidentFleetValidationRepositoryProvider =
    Provider<AccidentFleetValidationRepository>((Ref ref) {
  final SupabaseClient client = ref.watch(supabaseClientProvider);
  return AccidentFleetValidationRepository(
    read: (String accidentId) => client
        .from(AccidentCaseTables.fleetValidationItems)
        .select(AccidentFleetValidationRepository.columns)
        .eq('accident_id', accidentId),
    upsert: (Map<String, Object?> row) => client
        .from(AccidentCaseTables.fleetValidationItems)
        .upsert(row, onConflict: 'accident_id,item_key')
        .select(AccidentFleetValidationRepository.columns)
        .single(),
  );
});

@immutable
final class AccidentFleetValidationItem {
  const AccidentFleetValidationItem({
    required this.itemKey,
    this.id,
    this.state = 'pending',
    this.countDone,
    this.countRequired,
    this.checkedByName,
    this.checkedAt,
    this.note,
  });

  factory AccidentFleetValidationItem.fromRow(Map<String, dynamic> row) {
    final String state = accidentRowText(row['state'])?.toLowerCase() ?? '';
    return AccidentFleetValidationItem(
      id: accidentRowText(row['id']),
      itemKey: accidentRowText(row['item_key']) ?? '',
      state: checkStates.contains(state) ? state : 'pending',
      countDone: accidentRowNum(row['count_done'])?.toInt(),
      countRequired: accidentRowNum(row['count_required'])?.toInt(),
      checkedByName: accidentRowText(row['checked_by_name']),
      checkedAt: accidentRowDate(row['checked_at']),
      note: accidentRowText(row['note']),
    );
  }

  final String? id;
  final String itemKey;

  /// One of [checkStates].
  final String state;
  final int? countDone;
  final int? countRequired;
  final String? checkedByName;
  final DateTime? checkedAt;
  final String? note;

  bool get isSatisfied => state == 'done' || state == 'not_applicable';

  AccidentFleetValidationItem copyWith({
    String? id,
    String? state,
    int? countDone,
    int? countRequired,
    String? checkedByName,
    DateTime? checkedAt,
    String? note,
  }) =>
      AccidentFleetValidationItem(
        id: id ?? this.id,
        itemKey: itemKey,
        state: state ?? this.state,
        countDone: countDone ?? this.countDone,
        countRequired: countRequired ?? this.countRequired,
        checkedByName: checkedByName ?? this.checkedByName,
        checkedAt: checkedAt ?? this.checkedAt,
        note: note ?? this.note,
      );
}

@immutable
final class AccidentFleetValidationLoad {
  const AccidentFleetValidationLoad({
    required this.provisioned,
    this.items = const <AccidentFleetValidationItem>[],
  });

  final bool provisioned;
  final List<AccidentFleetValidationItem> items;

  AccidentFleetValidationItem? item(String key) {
    for (final AccidentFleetValidationItem row in items) {
      if (row.itemKey == key) return row;
    }
    return null;
  }
}

class AccidentFleetValidationRepository with SupabaseGateway {
  AccidentFleetValidationRepository({
    required FleetValidationRead read,
    required FleetValidationUpsert upsert,
  })  : _read = read,
        _upsert = upsert;

  final FleetValidationRead _read;
  final FleetValidationUpsert _upsert;

  static const String columns = 'id,accident_id,item_key,state,count_done,'
      'count_required,checked_by_name,checked_at,note';

  static bool isKnownItem(String key) {
    for (final VocabItem item in fleetValidationItems) {
      if (item.key == key) return true;
    }
    return false;
  }

  Future<AccidentFleetValidationLoad> list(String accidentId) async {
    final String id = accidentId.trim();
    if (id.isEmpty) throw ArgumentError('An accident id is required');
    try {
      final List<Map<String, dynamic>> rows = await guard(() => _read(id));
      return AccidentFleetValidationLoad(
        provisioned: true,
        items: <AccidentFleetValidationItem>[
          for (final Map<String, dynamic> row in rows)
            AccidentFleetValidationItem.fromRow(row),
        ],
      );
    } on SupabaseFailure catch (failure) {
      if (isMissingSchema(failure)) {
        return const AccidentFleetValidationLoad(provisioned: false);
      }
      rethrow;
    }
  }

  Future<AccidentFleetValidationItem> save({
    required String accidentId,
    required AccidentFleetValidationItem item,
    String? country,
    String? site,
  }) async {
    final String id = accidentId.trim();
    if (id.isEmpty ||
        !isKnownItem(item.itemKey) ||
        !checkStates.contains(item.state)) {
      throw ArgumentError('Invalid fleet validation item');
    }
    return guard(() async {
      final Map<String, dynamic> saved = await _upsert(<String, Object?>{
        'accident_id': id,
        'item_key': item.itemKey,
        'state': item.state,
        'count_done': item.countDone,
        'count_required': item.countRequired,
        'checked_by_name': item.checkedByName,
        'checked_at': item.checkedAt?.toUtc().toIso8601String(),
        'note': item.note,
        if (country != null && country.trim().isNotEmpty)
          'country': country.trim(),
        if (site != null && site.trim().isNotEmpty) 'site': site.trim(),
      });
      return AccidentFleetValidationItem.fromRow(saved);
    });
  }
}
