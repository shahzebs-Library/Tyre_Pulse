import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/admin/data/admin_access_repository.dart';
import 'package:tyre_pulse/features/admin/data/admin_sites_repository.dart';
import 'package:tyre_pulse/features/admin/data/admin_users_repository.dart';
import 'package:tyre_pulse/features/admin/domain/admin_user.dart';

final adminUsersAllowedProvider = Provider<bool>((ref) {
  final access = ref.watch(accessStateProvider);
  return ref.watch(canAccessModuleProvider(ModuleKey.users)) &&
      (access.isSuperAdmin || access.role.isAdministrator);
});

final adminSitesRepositoryProvider = Provider(
  (ref) => AdminSitesRepository(
    SupabaseAdminSitesSource(ref.watch(supabaseClientProvider)),
  ),
);

final adminSitesPageProvider = FutureProvider.autoDispose
    .family<List<AdminSite>, int>((ref, offset) async {
  final workspace = ref.watch(workspaceContextProvider);
  ref.watch(accessStateProvider);
  if (workspace == null) return [];
  return ref.watch(adminSitesRepositoryProvider).page(workspace, offset);
});

final adminUsersRepositoryProvider = Provider(
  (ref) => AdminUsersRepository(
    SupabaseAdminUsersSource(ref.watch(supabaseClientProvider)),
  ),
);

final adminAccessRepositoryProvider = Provider(
  (ref) => AdminAccessRepository(
    SupabaseAdminAccessSource(ref.watch(supabaseClientProvider)),
  ),
);

final adminAccessGrantsProvider = FutureProvider.autoDispose
    .family<List<MobileAccessGrant>, String>((ref, userId) {
  final superAdmin = ref.watch(accessStateProvider).isSuperAdmin;
  ref.watch(workspaceContextProvider);
  return ref
      .watch(adminAccessRepositoryProvider)
      .read(userId, superAdmin: superAdmin);
});

final adminUsersPageProvider =
    FutureProvider.autoDispose.family<List<AdminUser>, int>(
  (ref, offset) async {
    final workspace = ref.watch(workspaceContextProvider);
    if (!ref.watch(adminUsersAllowedProvider) || workspace == null) return [];
    return ref.watch(adminUsersRepositoryProvider).page(workspace, offset);
  },
);
