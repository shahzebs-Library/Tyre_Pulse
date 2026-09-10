import 'package:tyre_pulse/core/workspace/workspace_context.dart';

enum AdminUserAction { approve, lock, unlock, deactivate, setRole }

extension AdminUserActionWire on AdminUserAction {
  String get wireName => this == AdminUserAction.setRole ? 'set_role' : name;
  bool get requiresReason =>
      this == AdminUserAction.deactivate || this == AdminUserAction.setRole;
}

final class AdminUser {
  const AdminUser({
    required this.profile,
    required this.username,
  });

  final WorkspaceProfile profile;
  final String username;
  String get id => profile.userId;
  String get displayName => profile.fullName ?? username;

  Set<AdminUserAction> allowedActions(WorkspaceContext actor) {
    final superAdmin = actor.effectivePermissions.isSuperAdmin;
    if (!superAdmin && !actor.role.isAdministrator) return {};
    if (!superAdmin &&
        (actor.tenantId == null || actor.tenantId != profile.tenantId)) {
      return {};
    }
    if (!superAdmin && profile.isSuperAdmin) return {};
    final ownAccount = actor.userId == id;
    final privileged = profile.role.isAdministrator || profile.isSuperAdmin;
    return {
      if (!profile.isApproved) AdminUserAction.approve,
      if (profile.isLocked) AdminUserAction.unlock,
      if (!ownAccount && (superAdmin || !privileged)) ...{
        if (!profile.isLocked) AdminUserAction.lock,
        if (profile.isApproved || !profile.isLocked) AdminUserAction.deactivate,
        AdminUserAction.setRole,
      },
    };
  }
}
