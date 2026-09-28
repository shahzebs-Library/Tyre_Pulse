/// Data access for the administration console.
///
/// Every call is one of three things that already exist (AGENTS.md rule 3),
/// each verified live on 2026-09-28:
///
/// - PostgREST on `profiles`, `sites`, `user_access_grants`, `inspections`
///   and `checklist_submissions`;
/// - the RPCs `admin_mobile_user_action(uuid,text,text,text)` (V319; super
///   admin only server-side), `set_user_access_grant(...)` and
///   `revoke_user_access_grant(uuid)`;
/// - the `chat-ai` edge function.
///
/// Administration writes are ONLINE ONLY by design: each one depends on the
/// current server state (last-admin guard, self-action guard, grant rows) and
/// artifact 06 forbids blindly queueing a decision of that kind.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/features/admin/domain/admin_models.dart';

abstract interface class AdminRepository {
  /// The signed-in user's id, so the screens can hide actions the server would
  /// refuse on your own account anyway.
  String? get currentUserId;

  Future<int> countPendingInspectionApprovals();
  Future<int> countPendingChecklistApprovals();
  Future<int> countPendingSignups();
  Future<int> countLockedUsers();

  Future<List<AdminUser>> listUsers();

  Future<void> runUserAction({
    required String userId,
    required AdminUserAction action,
    String? reason,
    String? role,
  });

  Future<Map<ModuleKey, AdminMobileGrant>> listMobileGrants(String userId);

  Future<void> setMobileGrant({
    required String userId,
    required ModuleKey module,
    required AdminGrantEffect effect,
  });

  Future<void> clearMobileGrant(String grantId);

  Future<List<AdminSite>> listSites();

  Future<void> updateSite({
    required String siteId,
    required String? region,
    required bool active,
  });

  /// Sends the conversation to `chat-ai` and returns the answer text.
  ///
  /// Throws [AdminAiException] when the service refuses or returns nothing.
  Future<String> askAi(List<AdminChatMessage> conversation);
}

/// The profile columns the console reads. Verified against
/// `information_schema.columns` for `public.profiles`.
const String _userColumns =
    'id,full_name,username,employee_id,email,role,site,country,approved,'
    'locked,is_super_admin,created_at,pending_reason';

const String _siteColumns =
    'id,name,country,region,city,site_code,site_type,active';

/// How many earlier messages are sent back to the model. Bounds token cost.
const int kAdminAiHistoryLimit = 12;

const String _aiSystemPrompt =
    'You are the Tyre Pulse fleet assistant for an administrator. Answer '
    'concisely about tyre and fleet management practice. You are not given '
    'live fleet records in this chat, so never state a fleet figure, count or '
    'cost as fact; say that the figure should be checked in the app instead.';

final class SupabaseAdminRepository
    with SupabaseGateway
    implements AdminRepository {
  SupabaseAdminRepository(this._client);

  final SupabaseClient _client;

  @override
  String? get currentUserId => _client.auth.currentUser?.id;

  @override
  Future<int> countPendingInspectionApprovals() => guard<int>(
        () async => await _client
            .from(SupabaseTables.inspections)
            .count(CountOption.exact)
            .eq('approval_status', 'pending_approval'),
      );

  @override
  Future<int> countPendingChecklistApprovals() => guard<int>(
        // Same two rungs the checklist approval queue reads.
        () async => await _client
            .from(SupabaseTables.checklistSubmissions)
            .count(CountOption.exact)
            .or(
              'approval_status.eq.pending,'
              'approval_status.eq.pending_area_manager',
            ),
      );

  @override
  Future<int> countPendingSignups() => guard<int>(
        () async => await _client
            .from(SupabaseTables.profiles)
            .count(CountOption.exact)
            .eq('approved', false)
            .or('locked.is.null,locked.eq.false'),
      );

  @override
  Future<int> countLockedUsers() => guard<int>(
        () async => await _client
            .from(SupabaseTables.profiles)
            .count(CountOption.exact)
            .eq('locked', true),
      );

  @override
  Future<List<AdminUser>> listUsers() => guard<List<AdminUser>>(() async {
        final List<Map<String, dynamic>> rows = await _client
            .from(SupabaseTables.profiles)
            .select(_userColumns)
            .order('full_name')
            .order('id')
            .limit(1000);
        return rows
            .map(adminUserFromRow)
            .where((AdminUser user) => user.id.isNotEmpty)
            .toList(growable: false);
      });

  @override
  Future<void> runUserAction({
    required String userId,
    required AdminUserAction action,
    String? reason,
    String? role,
  }) =>
      guard<void>(() async {
        await _client.rpc<Object?>(
          SupabaseRpcs.adminMobileUserAction,
          params: <String, Object?>{
            'p_user_id': userId,
            'p_action': action.wire,
            'p_reason': _blankToNull(reason),
            'p_role': action == AdminUserAction.setRole ? role : null,
          },
        );
      });

  @override
  Future<Map<ModuleKey, AdminMobileGrant>> listMobileGrants(String userId) =>
      guard<Map<ModuleKey, AdminMobileGrant>>(() async {
        final List<Map<String, dynamic>> rows = await _client
            .from(SupabaseTables.userAccessGrants)
            .select('id,module_key,effect')
            .eq('user_id', userId)
            .like('module_key', '$mobileGrantPrefix%');
        return mobileGrantsFromRows(rows);
      });

  @override
  Future<void> setMobileGrant({
    required String userId,
    required ModuleKey module,
    required AdminGrantEffect effect,
  }) =>
      guard<void>(() async {
        await _client.rpc<Object?>(
          SupabaseRpcs.setUserAccessGrant,
          params: <String, Object?>{
            'p_user_id': userId,
            'p_module_key': mobileGrantKeyFor(module),
            'p_capability': 'view',
            'p_effect': effect.name,
            'p_note': 'mobile',
            'p_expires_at': null,
          },
        );
      });

  @override
  Future<void> clearMobileGrant(String grantId) => guard<void>(() async {
        await _client.rpc<Object?>(
          SupabaseRpcs.revokeUserAccessGrant,
          params: <String, Object?>{'p_id': grantId},
        );
      });

  @override
  Future<List<AdminSite>> listSites() => guard<List<AdminSite>>(() async {
        final List<Map<String, dynamic>> rows = await _client
            .from(SupabaseTables.sites)
            .select(_siteColumns)
            .order('country')
            .order('name')
            .order('id')
            .limit(1000);
        return rows
            .map(adminSiteFromRow)
            .where((AdminSite site) => site.id.isNotEmpty)
            .toList(growable: false);
      });

  @override
  Future<void> updateSite({
    required String siteId,
    required String? region,
    required bool active,
  }) =>
      guard<void>(() async {
        // RLS `sites_write` admits Admin and Manager only; the row filter by id
        // plus `.select('id')` turns a silently-refused update (0 rows) into
        // an explicit failure instead of a false "saved".
        final List<Map<String, dynamic>> updated = await _client
            .from(SupabaseTables.sites)
            .update(<String, Object?>{
              'region': _blankToNull(region),
              'active': active,
            })
            .eq('id', siteId)
            .select('id');
        if (updated.isEmpty) {
          throw const PostgrestException(
            message: 'Site update affected no rows',
            code: '42501',
          );
        }
      });

  @override
  Future<String> askAi(List<AdminChatMessage> conversation) async {
    final List<AdminChatMessage> recent =
        conversation.length > kAdminAiHistoryLimit
            ? conversation.sublist(conversation.length - kAdminAiHistoryLimit)
            : conversation;
    final FunctionResponse response;
    try {
      response = await _client.functions.invoke(
        SupabaseFunctions.chatAi,
        body: <String, Object?>{
          'system': _aiSystemPrompt,
          'messages': <Map<String, String>>[
            for (final AdminChatMessage message in recent)
              <String, String>{
                'role': message.role.name,
                'content': message.content,
              },
          ],
          'agent': 'admin_chat',
          'source': 'mobile',
          'max_tokens': 1200,
        },
      );
    } on FunctionException catch (error) {
      throw AdminAiException(aiFailureForStatus(error.status));
    } on AdminAiException {
      rethrow;
    } on Object catch (error, stack) {
      // Connectivity and anything else: the shared mapper decides the message.
      Error.throwWithStackTrace(classifySupabaseError(error), stack);
    }
    return aiAnswerFrom(response.data);
  }
}

/// Maps the documented `chat-ai` error statuses.
AdminAiFailure aiFailureForStatus(int status) => switch (status) {
      403 => AdminAiFailure.disabled,
      402 => AdminAiFailure.budget,
      429 => AdminAiFailure.rateLimited,
      _ => AdminAiFailure.unavailable,
    };

/// Reads `{content}` from a 2xx `chat-ai` body. A `{error}` body or an empty
/// answer is never shown as if the model had replied.
String aiAnswerFrom(Object? data) {
  if (data is Map) {
    if (data['error'] != null) {
      throw const AdminAiException(AdminAiFailure.unavailable);
    }
    final String content = data['content']?.toString().trim() ?? '';
    if (content.isNotEmpty) return content;
  }
  throw const AdminAiException(AdminAiFailure.empty);
}

AdminUser adminUserFromRow(Map<String, dynamic> row) => AdminUser(
      id: _text(row['id']) ?? '',
      fullName: _text(row['full_name']),
      username: _text(row['username']),
      employeeId: _text(row['employee_id']),
      email: _text(row['email']),
      role: _text(row['role']),
      site: _text(row['site']),
      countries: _stringList(row['country']),
      approved: row['approved'] is bool ? row['approved'] as bool : null,
      locked: row['locked'] is bool ? row['locked'] as bool : null,
      isSuperAdmin: row['is_super_admin'] == true,
      createdAt: DateTime.tryParse(_text(row['created_at']) ?? ''),
      pendingReason: _text(row['pending_reason']),
    );

AdminSite adminSiteFromRow(Map<String, dynamic> row) => AdminSite(
      id: _text(row['id']) ?? '',
      name: _text(row['name']) ?? '',
      country: _text(row['country']) ?? '',
      region: _text(row['region']),
      city: _text(row['city']),
      siteCode: _text(row['site_code']),
      siteType: _text(row['site_type']),
      active: row['active'] is bool ? row['active'] as bool : null,
    );

/// Keeps only `mobile:` rows for a module this build knows. An unknown key or
/// effect is dropped, never guessed onto a neighbouring module.
Map<ModuleKey, AdminMobileGrant> mobileGrantsFromRows(
  List<Map<String, dynamic>> rows,
) {
  final Map<ModuleKey, AdminMobileGrant> grants =
      <ModuleKey, AdminMobileGrant>{};
  for (final Map<String, dynamic> row in rows) {
    final String? id = _text(row['id']);
    final ModuleKey? module =
        moduleKeyFromMobileGrantKey(_text(row['module_key']) ?? '');
    final AdminGrantEffect? effect = switch (_text(row['effect'])) {
      'grant' => AdminGrantEffect.grant,
      'revoke' => AdminGrantEffect.revoke,
      _ => null,
    };
    if (id == null || module == null || effect == null) continue;
    final AdminMobileGrant? existing = grants[module];
    // Revoke wins at every reader, so show the revoke when both rows exist.
    if (existing != null && existing.effect == AdminGrantEffect.revoke) {
      continue;
    }
    grants[module] = AdminMobileGrant(id: id, module: module, effect: effect);
  }
  return grants;
}

String? _text(Object? value) {
  final String text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}

String? _blankToNull(String? value) => _text(value);

List<String> _stringList(Object? raw) {
  if (raw is List) {
    return raw.map(_text).whereType<String>().toList(growable: false);
  }
  final String? single = _text(raw);
  return single == null ? const <String>[] : <String>[single];
}
