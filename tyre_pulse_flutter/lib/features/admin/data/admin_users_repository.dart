import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/features/admin/domain/admin_user.dart';

/// Verified against profiles and V319's live RPC on 2026-09-07.
/// Administration is online-only: server checks and audit must finish first.
abstract interface class AdminUsersSource {
  Future<List<Map<String, dynamic>>> page(String? orgId, int offset);
  Future<Object?> action(Map<String, Object?> params);
}

final class SupabaseAdminUsersSource implements AdminUsersSource {
  SupabaseAdminUsersSource(this.client);
  final SupabaseClient client;

  @override
  Future<List<Map<String, dynamic>>> page(String? orgId, int offset) {
    var query = client.from(SupabaseTables.profiles).select(
          'id,full_name,username,role,site,country,sites,org_id,'
          'organisation_id,approved,locked,is_super_admin,employee_id',
        );
    if (orgId != null) query = query.eq('org_id', orgId);
    return query.order('approved').order('id').range(offset, offset + 49);
  }

  @override
  Future<Object?> action(Map<String, Object?> params) =>
      client.rpc('admin_mobile_user_action', params: params);
}

final class AdminUserDto {
  AdminUserDto(this.row);
  final Map<String, dynamic> row;
  AdminUser toDomain() => AdminUser(
        profile: WorkspaceProfile.fromRow(row),
        username: row['username'] as String? ?? row['id'] as String,
      );
}

class AdminUsersRepository with SupabaseGateway {
  AdminUsersRepository(this.source);
  final AdminUsersSource source;

  void _requireAdmin(WorkspaceContext workspace) {
    if (!canAccessModule(
      module: ModuleKey.users,
      access: workspace.effectivePermissions,
    )) {
      throw const AppError(
        kind: AppErrorKind.authorization,
        message: 'User management access is required.',
      );
    }
    if (!workspace.effectivePermissions.isSuperAdmin &&
        (!workspace.role.isAdministrator || workspace.tenantId == null)) {
      throw const AppError(
        kind: AppErrorKind.authorization,
        message: 'Administrator access is required.',
      );
    }
  }

  Future<List<AdminUser>> page(WorkspaceContext workspace, int offset) {
    _requireAdmin(workspace);
    return guard(
      () async => (await source.page(
        workspace.effectivePermissions.isSuperAdmin ? null : workspace.tenantId,
        offset,
      ))
          .map((row) => AdminUserDto(row).toDomain())
          .toList(),
    );
  }

  Future<void> act(
    WorkspaceContext workspace,
    AdminUser target,
    AdminUserAction action, {
    required String reason,
    RoleId? role,
  }) {
    _requireAdmin(workspace);
    if (!target.allowedActions(workspace).contains(action)) {
      throw const AppError(
        kind: AppErrorKind.authorization,
        message: 'This action is not allowed for this account.',
      );
    }
    if (action.requiresReason && reason.trim().isEmpty) {
      throw const AppError(
        kind: AppErrorKind.validation,
        message: 'A reason is required.',
      );
    }
    if (action == AdminUserAction.setRole &&
        (role == null ||
            !role.isBuiltIn ||
            (role == RoleId.admin &&
                !workspace.effectivePermissions.isSuperAdmin))) {
      throw const AppError(
        kind: AppErrorKind.validation,
        message: 'Choose an available role.',
      );
    }
    return guard(() async {
      final result = await source.action({
        'p_user_id': target.id,
        'p_action': action.wireName,
        'p_reason': reason.trim().isEmpty ? null : reason.trim(),
        'p_role': role?.databaseName,
      });
      if (result is! Map || result['success'] != true) {
        throw const AppError(
          kind: AppErrorKind.server,
          message: 'The server did not confirm this change.',
        );
      }
    });
  }
}
