/// Remote workforce assignments backed by verified Supabase tables.
///
/// Status transitions are online-only: the database checks current state and
/// permissions. Offline replay needs an approved command-registry extension.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignment_cache.dart';

class WorkforceAssignment {
  factory WorkforceAssignment.fromJson(Map<String, dynamic> json) {
    return WorkforceAssignment(
      id: json['id'] as String,
      title: json['title'] as String,
      status: json['status'] as String,
      priority: json['priority'] as String? ?? 'normal',
      site: json['site'] as String?,
      instructions: json['instructions'] as String?,
      dueAt: json['due_at'] == null
          ? null
          : DateTime.parse(json['due_at'] as String),
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
  });

  final String id;
  final String title;
  final String status;
  final String priority;
  final String? site;
  final String? instructions;
  final DateTime? dueAt;

  String? get nextAction => switch (status) {
        'assigned' => 'acknowledged',
        'acknowledged' => 'in_progress',
        'in_progress' => 'submitted',
        'blocked' => 'in_progress',
        _ => null,
      };
}

class WorkforceAssignmentSnapshot {
  const WorkforceAssignmentSnapshot({
    required this.items,
    required this.offline,
  });
  final List<WorkforceAssignment> items;
  final bool offline;
}

/// Why a status change did not take effect. Drives the message the person
/// sees; it never carries raw database text.
enum WorkforceTransitionFailure {
  /// The server refused the move (not a valid step, or the work is closed).
  rejected,

  /// The row changed under us or is no longer ours; refresh before retrying.
  conflict,

  /// The account is not allowed to make this change.
  denied,

  /// The request never reached the server.
  network,
}

/// Raised by [WorkforceAssignmentsSource.advance] with a typed [failure].
class WorkforceTransitionException implements Exception {
  const WorkforceTransitionException(this.failure);

  final WorkforceTransitionFailure failure;

  /// A retry can succeed without any other action only when nothing reached
  /// the server. Everything else needs a refresh first.
  bool get retryableAsIs => failure == WorkforceTransitionFailure.network;

  @override
  String toString() => 'WorkforceTransitionException(${failure.name})';
}

/// Maps whatever the client threw into a [WorkforceTransitionFailure].
///
/// The SQL guard raises plain exceptions (SQLSTATE P0001) for an invalid or
/// closed transition, row-level security answers 42501, and an update that
/// matched no row (a stale status) is reported by the caller as a conflict.
WorkforceTransitionFailure classifyWorkforceTransitionError(Object error) {
  if (error is WorkforceTransitionException) return error.failure;
  if (error is PostgrestException) {
    final String code = error.code ?? '';
    if (code == '42501') return WorkforceTransitionFailure.denied;
    if (code == 'P0001' || code == '23514') {
      return WorkforceTransitionFailure.rejected;
    }
    if (code.isEmpty) return WorkforceTransitionFailure.network;
    return WorkforceTransitionFailure.rejected;
  }
  return WorkforceTransitionFailure.network;
}

/// What the assignments panel needs; the Supabase implementation below is the
/// production one and tests substitute a fake.
abstract interface class WorkforceAssignmentsSource {
  Future<WorkforceAssignmentSnapshot> listMine();

  /// Moves [item] to its next status. Throws [WorkforceTransitionException].
  Future<void> advance(WorkforceAssignment item);
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

  @override
  Future<WorkforceAssignmentSnapshot> listMine() async {
    final userId = _client.auth.currentUser?.id;
    if (userId == null) throw StateError('Not signed in');
    try {
      final rows = await _client
          .from('workforce_assignments')
          .select('id,title,instructions,site,status,priority,due_at')
          .eq('assigned_to', userId)
          .order('created_at', ascending: false)
          .limit(100);
      final list = rows as List<dynamic>;
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

  @override
  Future<void> advance(WorkforceAssignment item) async {
    final next = item.nextAction;
    if (next == null) {
      throw const WorkforceTransitionException(
        WorkforceTransitionFailure.rejected,
      );
    }
    final userId = _client.auth.currentUser?.id;
    if (userId == null) {
      throw const WorkforceTransitionException(
        WorkforceTransitionFailure.denied,
      );
    }
    final List<dynamic> changed;
    try {
      changed = await _client
          .from('workforce_assignments')
          .update({'status': next})
          .eq('id', item.id)
          .eq('assigned_to', userId)
          .eq('status', item.status)
          .select('id');
    } catch (error) {
      throw WorkforceTransitionException(
        classifyWorkforceTransitionError(error),
      );
    }
    if (changed.isEmpty) {
      throw const WorkforceTransitionException(
        WorkforceTransitionFailure.conflict,
      );
    }
  }
}
