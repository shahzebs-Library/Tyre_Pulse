import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';

/// Vehicle Handover is a Flutter-only module with a two-stage sign-off. Who may
/// reach the handover queue on the phone:
///
/// - the field roles who capture a handover (its ModuleDef.defaultRoles), and
/// - the two sign-off roles, Fleet Supervisor and Fleet Incharge, opened in via
///   flutterRoleDefaultExtensions so they can sign.
///
/// Everyone else is denied. This is reach to the QUEUE only; who may actually
/// press Approve is re-decided by the server RPC `decide_handover_approval`.
void main() {
  AccessState as(String dbRole) =>
      AccessState(role: UserRole.fromDatabase(dbRole));

  bool reaches(String dbRole) =>
      canAccessModule(module: ModuleKey.handover, access: as(dbRole));

  group('Vehicle Handover access', () {
    test('is a Flutter-only module', () {
      expect(flutterOnlyModules, contains(ModuleKey.handover));
    });

    test('the field capture roles reach it by role default', () {
      for (final String role in <String>[
        'Manager',
        'Director',
        'Inspector',
        'Driver',
        'Tyre Man',
      ]) {
        expect(reaches(role), isTrue, reason: role);
      }
    });

    test('both sign-off roles reach it through the Flutter extension', () {
      // Neither is in any ModuleDef.defaultRoles; the extension is their path.
      expect(reaches('Fleet Supervisor'), isTrue);
      expect(reaches('Fleet Incharge'), isTrue);

      for (final ModuleDef def in ModuleRegistry.all) {
        expect(def.defaultRoles, isNot(contains(RoleId.fleetSupervisor)));
        expect(def.defaultRoles, isNot(contains(RoleId.fleetIncharge)));
      }
      expect(
        flutterRoleDefaultExtensions[ModuleKey.handover],
        <RoleId>{RoleId.fleetSupervisor, RoleId.fleetIncharge},
      );
    });

    test('non-signer roles are denied', () {
      for (final String role in <String>[
        'Reporter',
        'Tyre Data Collector',
        'Store Keeper',
      ]) {
        expect(reaches(role), isFalse, reason: role);
      }
    });

    test('a per-user revoke removes it from one signer', () {
      final AccessState revoked = AccessState(
        role: UserRole.fromDatabase('Fleet Supervisor'),
        grants: const <ModuleKey, GrantEffect>{
          ModuleKey.handover: GrantEffect.revoke,
        },
      );
      expect(
        canAccessModule(module: ModuleKey.handover, access: revoked),
        isFalse,
      );
    });
  });
}
