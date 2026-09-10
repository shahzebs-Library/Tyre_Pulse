import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/admin/admin_providers.dart';
import 'package:tyre_pulse/features/admin/data/admin_users_repository.dart';
import 'package:tyre_pulse/features/admin/domain/admin_user.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_users_screen.dart';

WorkspaceContext _actor({bool superAdmin = false}) => WorkspaceContext(
      userId: 'actor',
      tenantId: 'org-a',
      role: const UserRole.known(RoleId.admin),
      effectivePermissions: AccessState(
        role: const UserRole.known(RoleId.admin),
        isSuperAdmin: superAdmin,
      ),
      countryScope: CountryScope.none,
      siteScope: SiteScope.none,
    );

AdminUser _target({
  String id = 'target',
  String org = 'org-a',
  String role = 'Driver',
  bool superAdmin = false,
}) =>
    AdminUserDto({
      'id': id,
      'org_id': org,
      'username': 'driver-1',
      'role': role,
      'country': ['Saudi Arabia', 'United Arab Emirates'],
      'sites': <String>[],
      'approved': true,
      'locked': false,
      'is_super_admin': superAdmin,
    }).toDomain();

class _Source implements AdminUsersSource {
  String? org;
  int? offset;
  Map<String, Object?>? params;
  Object? result = {'success': true};

  @override
  Future<List<Map<String, dynamic>>> page(String? orgId, int from) async {
    org = orgId;
    offset = from;
    return [];
  }

  @override
  Future<Object?> action(Map<String, Object?> values) async {
    params = values;
    return result;
  }
}

void main() {
  testWidgets('deactivation requires confirmation and a reason before sending',
      (tester) async {
    final source = _Source();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          workspaceContextProvider.overrideWithValue(_actor()),
          adminUsersAllowedProvider.overrideWithValue(true),
          adminUsersRepositoryProvider
              .overrideWithValue(AdminUsersRepository(source)),
          adminUsersPageProvider(0).overrideWith((ref) async => [_target()]),
        ],
        child: const MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: AdminUsersScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Deactivate'));
    await tester.pumpAndSettle();
    expect(source.params, isNull);
    await tester.tap(find.text('Deactivate').last);
    await tester.pumpAndSettle();
    expect(find.text('A reason is required.'), findsOneWidget);
    expect(source.params, isNull);
    await tester.enterText(find.byType(TextFormField), 'Employment ended');
    await tester.tap(find.text('Deactivate').last);
    await tester.pumpAndSettle();
    expect(source.params?['p_action'], 'deactivate');
    expect(source.params?['p_reason'], 'Employment ended');
    expect(find.text('Change confirmed by the server.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('ordinary admin reads only their organisation, with pagination',
      () async {
    final source = _Source();
    await AdminUsersRepository(source).page(_actor(), 50);
    expect(source.org, 'org-a');
    expect(source.offset, 50);
  });

  test('superadmin can read the RLS-visible cross-organisation roster',
      () async {
    final source = _Source();
    await AdminUsersRepository(source).page(_actor(superAdmin: true), 0);
    expect(source.org, isNull);
  });

  test('country array is retained by the existing profile mapper', () {
    expect(
      _target().profile.countryScope,
      CountryScope.fromJson(['Saudi Arabia', 'United Arab Emirates']),
    );
  });

  test('self, privileged and other organisation actions are gated', () {
    expect(_target(id: 'actor').allowedActions(_actor()), isEmpty);
    expect(_target(org: 'org-b').allowedActions(_actor()), isEmpty);
    expect(_target(superAdmin: true).allowedActions(_actor()), isEmpty);
    expect(_target(role: 'Admin').allowedActions(_actor()), isEmpty);
    expect(
      _target(role: 'Admin').allowedActions(_actor(superAdmin: true)),
      contains(AdminUserAction.setRole),
    );
  });

  test('deactivation requires a reason before calling the backend', () async {
    final source = _Source();
    final repository = AdminUsersRepository(source);
    expect(
      () => repository.act(
        _actor(),
        _target(),
        AdminUserAction.deactivate,
        reason: '  ',
      ),
      throwsA(anything),
    );
    expect(source.params, isNull);
  });

  test('audited action sends exact RPC parameters', () async {
    final source = _Source();
    await AdminUsersRepository(source).act(
      _actor(),
      _target(),
      AdminUserAction.deactivate,
      reason: ' No longer employed ',
    );
    expect(source.params, {
      'p_user_id': 'target',
      'p_action': 'deactivate',
      'p_reason': 'No longer employed',
      'p_role': null,
    });
  });

  test('ordinary admin cannot promote someone to admin', () {
    final source = _Source();
    expect(
      () => AdminUsersRepository(source).act(
        _actor(),
        _target(),
        AdminUserAction.setRole,
        reason: 'Promotion',
        role: RoleId.admin,
      ),
      throwsA(anything),
    );
    expect(source.params, isNull);
  });

  test('unconfirmed backend response is never presented as saved', () async {
    final source = _Source()..result = {'success': false};
    await expectLater(
      AdminUsersRepository(source)
          .act(_actor(), _target(), AdminUserAction.lock, reason: 'Review'),
      throwsA(anything),
    );
  });
}
