import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/features/admin/admin_providers.dart';
import 'package:tyre_pulse/features/admin/data/admin_repository.dart';
import 'package:tyre_pulse/features/admin/domain/admin_models.dart';

const AccessState superAdmin = AccessState(
  role: UserRole.known(RoleId.admin),
  isSuperAdmin: true,
);
const AccessState plainAdmin = AccessState(role: UserRole.known(RoleId.admin));
const AccessState reporter = AccessState(role: UserRole.known(RoleId.reporter));

final class FakeAdminRepository implements AdminRepository {
  FakeAdminRepository({
    this.users = const <AdminUser>[],
    this.sites = const <AdminSite>[],
    Map<ModuleKey, AdminMobileGrant>? grants,
  }) : grants = grants ?? <ModuleKey, AdminMobileGrant>{};

  List<AdminUser> users;
  List<AdminSite> sites;
  Map<ModuleKey, AdminMobileGrant> grants;
  Exception? usersError;
  Exception? countError;
  Exception? aiError;
  String aiAnswer = 'Rotate steer tyres every 20,000 km.';
  int pendingInspections = 3;
  final List<String> calls = <String>[];
  final List<List<AdminChatMessage>> aiConversations =
      <List<AdminChatMessage>>[];

  @override
  String? get currentUserId => 'me';

  Future<int> _count(int value) async {
    if (countError != null) throw countError!;
    return value;
  }

  @override
  Future<int> countPendingInspectionApprovals() => _count(pendingInspections);
  @override
  Future<int> countPendingChecklistApprovals() => _count(2);
  @override
  Future<int> countPendingSignups() async => 4;
  @override
  Future<int> countLockedUsers() async => 1;

  @override
  Future<List<AdminUser>> listUsers() async {
    if (usersError != null) throw usersError!;
    return users;
  }

  @override
  Future<void> runUserAction({
    required String userId,
    required AdminUserAction action,
    String? reason,
    String? role,
  }) async {
    calls.add('user:$userId:${action.wire}:${reason ?? '-'}:${role ?? '-'}');
  }

  @override
  Future<Map<ModuleKey, AdminMobileGrant>> listMobileGrants(
    String userId,
  ) async =>
      Map<ModuleKey, AdminMobileGrant>.of(grants);

  @override
  Future<void> setMobileGrant({
    required String userId,
    required ModuleKey module,
    required AdminGrantEffect effect,
  }) async {
    calls.add('set:$userId:${module.wireKey}:${effect.name}');
    grants[module] = AdminMobileGrant(
      id: 'new-${module.wireKey}',
      module: module,
      effect: effect,
    );
  }

  @override
  Future<void> clearMobileGrant(String grantId) async {
    calls.add('clear:$grantId');
    grants.removeWhere((ModuleKey _, AdminMobileGrant g) => g.id == grantId);
  }

  @override
  Future<List<AdminSite>> listSites() async => sites;

  @override
  Future<void> updateSite({
    required String siteId,
    required String? region,
    required bool active,
  }) async {
    calls.add('site:$siteId:${region ?? '-'}:$active');
  }

  @override
  Future<String> askAi(List<AdminChatMessage> conversation) async {
    aiConversations.add(conversation);
    if (aiError != null) throw aiError!;
    return aiAnswer;
  }
}

Widget _app({required Widget child, GoRouter? router}) {
  if (router != null) {
    return MaterialApp.router(
      debugShowCheckedModeBanner: false,
      theme: TpTheme.light,
      locale: const Locale('en'),
      supportedLocales: TpLocalizations.supportedLocales,
      localizationsDelegates: TpLocalizations.delegates,
      routerConfig: router,
    );
  }
  return MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: TpTheme.light,
    locale: const Locale('en'),
    supportedLocales: TpLocalizations.supportedLocales,
    localizationsDelegates: TpLocalizations.delegates,
    home: child,
  );
}

Future<void> pumpAdmin(
  WidgetTester tester,
  Widget screen, {
  required FakeAdminRepository repository,
  AccessState access = superAdmin,
  GoRouter? router,
}) async {
  await tester.binding.setSurfaceSize(const Size(390, 844));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        adminRepositoryProvider.overrideWithValue(repository),
        accessStateProvider.overrideWithValue(access),
      ],
      child: _app(child: screen, router: router),
    ),
  );
  await tester.pumpAndSettle();
}

const AdminUser alice = AdminUser(
  id: 'u-alice',
  fullName: 'Alice Noor',
  username: 'alice',
  role: 'Tyre Man',
  site: 'NHC',
  approved: false,
  locked: false,
);
const AdminUser bilal = AdminUser(
  id: 'u-bilal',
  fullName: 'Bilal Khan',
  username: 'bilal',
  role: 'Manager',
  site: 'DIRIYAH',
  approved: true,
  locked: false,
);
