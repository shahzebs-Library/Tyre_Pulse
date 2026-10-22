/// Remote workforce assignments backed by verified Supabase tables.
///
/// Status transitions are online-only: the database checks current state and
/// permissions. Offline replay needs an approved command-registry extension.
library;

import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

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

class WorkforceAssignmentsRepository {
  const WorkforceAssignmentsRepository(this._client);

  final SupabaseClient _client;

  Future<WorkforceAssignmentSnapshot> listMine() async {
    final userId = _client.auth.currentUser?.id;
    if (userId == null) throw StateError('Not signed in');
    const storage = FlutterSecureStorage();
    // The encrypted cache is identity-scoped to prevent account crossover.
    final cacheKey = 'workforce_assignments_v1_$userId';
    try {
      final rows = await _client
          .from('workforce_assignments')
          .select('id,title,instructions,site,status,priority,due_at')
          .eq('assigned_to', userId)
          .order('created_at', ascending: false)
          .limit(100);
      await storage.write(key: cacheKey, value: jsonEncode(rows));
      return WorkforceAssignmentSnapshot(
        items: (rows as List<dynamic>)
            .map(
              (row) => WorkforceAssignment.fromJson(
                Map<String, dynamic>.from(row as Map),
              ),
            )
            .toList(growable: false),
        offline: false,
      );
    } catch (_) {
      final saved = await storage.read(key: cacheKey);
      if (saved == null) rethrow;
      final decoded = jsonDecode(saved) as List<dynamic>;
      return WorkforceAssignmentSnapshot(
        items: decoded
            .map(
              (row) => WorkforceAssignment.fromJson(
                Map<String, dynamic>.from(row as Map),
              ),
            )
            .toList(growable: false),
        offline: true,
      );
    }
  }

  Future<void> advance(WorkforceAssignment item) async {
    final next = item.nextAction;
    if (next == null) {
      throw StateError('No available transition for this assignment');
    }
    final userId = _client.auth.currentUser?.id;
    if (userId == null) throw StateError('Not signed in');
    final changed = await _client
        .from('workforce_assignments')
        .update({'status': next})
        .eq('id', item.id)
        .eq('assigned_to', userId)
        .eq('status', item.status)
        .select('id');
    if (changed.isEmpty) {
      throw StateError('Assignment changed or permission denied. Refresh.');
    }
  }
}
