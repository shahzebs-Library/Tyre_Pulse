/// Domain models for the administration console (`/admin/**`).
///
/// Ported from `mobile/app/(app)/admin/*` and `mobile/lib/accessAdmin.ts`.
/// Every field maps to a real column verified against the live schema
/// (2026-09-28): `profiles`, `sites`, `user_access_grants`.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';

/// Where a profile stands, derived from `approved` and `locked`.
///
/// `admin_mobile_user_action('deactivate')` writes `approved = false,
/// locked = true`, so a deactivated account reads as [locked]: it cannot sign
/// in either way, and the lock is the stronger fact.
enum AdminUserStatus { pending, active, locked }

/// The four actions `admin_mobile_user_action(uuid,text,text,text)` accepts.
///
/// The server rejects anything else with 22023 "Unknown action.", so this
/// enum's [wire] values are exactly the RPC's allow-list.
enum AdminUserAction {
  approve('approve'),
  lock('lock'),
  unlock('unlock'),
  deactivate('deactivate'),
  setRole('set_role');

  const AdminUserAction(this.wire);
  final String wire;

  /// The RPC raises 22023 "A reason is required" for these two.
  bool get requiresReason =>
      this == AdminUserAction.deactivate || this == AdminUserAction.setRole;
}

/// One row of `profiles`, as the users console needs it.
@immutable
final class AdminUser {
  const AdminUser({
    required this.id,
    this.fullName,
    this.username,
    this.employeeId,
    this.email,
    this.role,
    this.site,
    this.countries = const <String>[],
    this.approved,
    this.locked,
    this.isSuperAdmin = false,
    this.createdAt,
    this.pendingReason,
  });

  final String id;
  final String? fullName;
  final String? username;
  final String? employeeId;
  final String? email;

  /// `profiles.role` as stored: Title Case, e.g. `Tyre Man`.
  final String? role;
  final String? site;

  /// `profiles.country` is `text[]`, never a scalar.
  final List<String> countries;

  /// Nullable in the schema. A null is not treated as approved.
  final bool? approved;
  final bool? locked;
  final bool isSuperAdmin;
  final DateTime? createdAt;
  final String? pendingReason;

  AdminUserStatus get status {
    if (locked == true) return AdminUserStatus.locked;
    if (approved != true) return AdminUserStatus.pending;
    return AdminUserStatus.active;
  }

  /// Null when the profile carries neither a name nor a username, so the
  /// screen can say so instead of printing a guessed name.
  String? get displayName => _clean(fullName) ?? _clean(username);

  bool matches(String term) {
    final String needle = term.trim().toLowerCase();
    if (needle.isEmpty) return true;
    return <String?>[fullName, username, employeeId, email, role, site]
        .whereType<String>()
        .any((String value) => value.toLowerCase().contains(needle));
  }
}

String? _clean(String? value) {
  final String text = value?.trim() ?? '';
  return text.isEmpty ? null : text;
}

/// One row of `sites`.
@immutable
final class AdminSite {
  const AdminSite({
    required this.id,
    required this.name,
    required this.country,
    this.region,
    this.city,
    this.siteCode,
    this.siteType,
    this.active,
  });

  final String id;
  final String name;
  final String country;
  final String? region;
  final String? city;
  final String? siteCode;
  final String? siteType;

  /// Nullable in the schema; only an explicit `false` is inactive.
  final bool? active;

  bool get isActive => active != false;

  bool matches(String term) {
    final String needle = term.trim().toLowerCase();
    if (needle.isEmpty) return true;
    return <String?>[name, country, region, city, siteCode]
        .whereType<String>()
        .any((String value) => value.toLowerCase().contains(needle));
  }
}

/// The effect stored in `user_access_grants.effect`.
enum AdminGrantEffect { grant, revoke }

/// One stored per-user mobile override, with the row id needed to clear it.
@immutable
final class AdminMobileGrant {
  const AdminMobileGrant({
    required this.id,
    required this.module,
    required this.effect,
  });

  final String id;
  final ModuleKey module;
  final AdminGrantEffect effect;
}

/// Live counts for the console hub. Each is null when its own query failed,
/// so one failing read never turns the other counts into zeros.
@immutable
final class AdminHubCounts {
  const AdminHubCounts({
    this.pendingInspections,
    this.pendingChecklists,
    this.pendingSignups,
    this.lockedUsers,
  });

  final int? pendingInspections;
  final int? pendingChecklists;
  final int? pendingSignups;
  final int? lockedUsers;

  /// Null unless BOTH approval counts were measured.
  int? get pendingApprovals =>
      pendingInspections == null || pendingChecklists == null
          ? null
          : pendingInspections! + pendingChecklists!;
}

/// Who said a chat line.
enum AdminChatRole { user, assistant }

@immutable
final class AdminChatMessage {
  const AdminChatMessage({required this.role, required this.content});

  final AdminChatRole role;
  final String content;
}

/// Why the AI service did not answer, mapped from the `chat-ai` status codes.
enum AdminAiFailure { disabled, budget, rateLimited, empty, unavailable }

/// Thrown by the repository when `chat-ai` does not return an answer.
final class AdminAiException implements Exception {
  const AdminAiException(this.failure);
  final AdminAiFailure failure;

  @override
  String toString() => 'AdminAiException(${failure.name})';
}
