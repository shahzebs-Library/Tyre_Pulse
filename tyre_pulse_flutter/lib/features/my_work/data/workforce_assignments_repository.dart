/// Remote workforce assignments backed by verified Supabase tables.
///
/// Reads only. Every status change goes through the audited RPC
/// `workforce_assignment_transition`, delivered by the durable offline queue in
/// `workforce_sync_engine.dart`. A direct `UPDATE ... SET status` is refused by
/// the server since `20261109160000_workforce_operations_core.sql`
/// (`workforce_assignment_guard`: "Status changes must go through the audited
/// transition"), so this repository deliberately has no write path for it.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignment_cache.dart';

/// The operational record kinds an assignment can require, from the CHECK on
/// `workforce_assignments.operational_record_table` (20261109160000).
const Set<String> workforceOperationalRecordTables = <String>{
  'tyre_records',
  'tyre_service_events',
  'work_orders',
  'inspections',
};

String? _text(Object? value) {
  if (value is! String) return null;
  final String trimmed = value.trim();
  return trimmed.isEmpty ? null : trimmed;
}

class WorkforceAssignment {
  /// Tolerant of every column added after the first release: a row read from
  /// an older server, or from a cache written by an older build, simply lacks
  /// those keys and they read as `null`. A wrongly typed value also reads as
  /// `null` instead of failing the whole list.
  factory WorkforceAssignment.fromJson(Map<String, dynamic> json) {
    final String? recordTable = _text(json['operational_record_table']);
    final Object? due = json['due_at'];
    return WorkforceAssignment(
      id: json['id'] as String,
      title: json['title'] as String,
      status: json['status'] as String,
      priority: _text(json['priority']) ?? 'normal',
      site: _text(json['site']),
      instructions: _text(json['instructions']),
      dueAt: due is String ? DateTime.tryParse(due) : null,
      organisationId: _text(json['organisation_id']),
      assetNo: _text(json['asset_no']),
      tyreSerial: _text(json['tyre_serial']),
      tyrePosition: _text(json['tyre_position']),
      operationalRecordTable:
          workforceOperationalRecordTables.contains(recordTable)
              ? recordTable
              : null,
      operationalRecordId: _text(json['operational_record_id']),
    );
  }

  const WorkforceAssignment({
    required this.id,
    required this.title,
    required this.status,
    required this.priority,
    this.site,
    this.instructions,
    this.dueAt,
    this.organisationId,
    this.assetNo,
    this.tyreSerial,
    this.tyrePosition,
    this.operationalRecordTable,
    this.operationalRecordId,
  });

  final String id;
  final String title;
  final String status;
  final String priority;
  final String? site;
  final String? instructions;
  final DateTime? dueAt;

  /// Needed to build the evidence storage path `<org>/assignments/<id>/...`.
  final String? organisationId;

  final String? assetNo;
  final String? tyreSerial;
  final String? tyrePosition;

  /// The record type this work must be linked to before it can be verified
  /// (`tyre_records`, `work_orders`...), or `null` when none is required.
  final String? operationalRecordTable;

  /// The linked record, once a manager (or the link function) has set it.
  final String? operationalRecordId;

  /// The work needs a linked record that is not linked yet.
  bool get needsOperationalRecord =>
      operationalRecordTable != null && operationalRecordId == null;
}

class WorkforceAssignmentSnapshot {
  const WorkforceAssignmentSnapshot({
    required this.items,
    required this.offline,
  });
  final List<WorkforceAssignment> items;
  final bool offline;
}

/// What the assignments panel needs; the Supabase implementation below is the
/// production one and tests substitute a fake.
abstract interface class WorkforceAssignmentsSource {
  Future<WorkforceAssignmentSnapshot> listMine();
}

/// Columns every server since 20261022095000 carries.
const String workforceAssignmentBaseColumns =
    'id,organisation_id,title,instructions,site,status,priority,due_at';

/// Base columns plus the operations-core columns (20261109160000).
const String workforceAssignmentExtendedColumns =
    '$workforceAssignmentBaseColumns,asset_no,tyre_serial,tyre_position,'
    'operational_record_table,operational_record_id';

const Set<String> _missingSchemaCodes = <String>{
  '42703', // undefined_column
  'PGRST204', // column not in the schema cache
};

/// True when PostgREST refused the read because a column does not exist yet
/// (a server that predates 20261109160000).
bool isWorkforceMissingColumn(Object error) {
  if (error is! PostgrestException) return false;
  return _missingSchemaCodes.contains((error.code ?? '').trim().toUpperCase());
}

class WorkforceAssignmentsRepository implements WorkforceAssignmentsSource {
  const WorkforceAssignmentsRepository(this._client, this._cache);

  final SupabaseClient _client;
  final WorkforceAssignmentCache _cache;

  static List<WorkforceAssignment> _parse(List<dynamic> rows) => rows
      .map(
        (row) => WorkforceAssignment.fromJson(
          Map<String, dynamic>.from(row as Map),
        ),
      )
      .toList(growable: false);

  Future<List<dynamic>> _select(String userId, String columns) async {
    final rows = await _client
        .from('workforce_assignments')
        .select(columns)
        .eq('assigned_to', userId)
        .order('created_at', ascending: false)
        .limit(100);
    return rows as List<dynamic>;
  }

  @override
  Future<WorkforceAssignmentSnapshot> listMine() async {
    final userId = _client.auth.currentUser?.id;
    if (userId == null) throw StateError('Not signed in');
    try {
      List<dynamic> list;
      try {
        list = await _select(userId, workforceAssignmentExtendedColumns);
      } on PostgrestException catch (error) {
        // An older server: PostgREST fails the whole request on an unknown
        // column, so read the original columns instead of showing nothing.
        if (!isWorkforceMissingColumn(error)) rethrow;
        list = await _select(userId, workforceAssignmentBaseColumns);
      }
      await _cache.save(
        userId: userId,
        rows: <Map<String, Object?>>[
          for (final row in list) Map<String, Object?>.from(row as Map),
        ],
      );
      return WorkforceAssignmentSnapshot(items: _parse(list), offline: false);
    } catch (_) {
      final saved = await _cache.load(userId);
      if (saved == null) rethrow;
      return WorkforceAssignmentSnapshot(
        items: _parse(saved),
        offline: true,
      );
    }
  }
}
