import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/module_access_resolver_impl.dart';
import 'package:tyre_pulse/app/router/route_access.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';

/// Fleet Supervisor is a real custom role held by three people. It files the
/// accident report on the phone, so the phone must map it and admit it.
void main() {
  final UserRole fleetSupervisor = UserRole.fromDatabase('Fleet Supervisor');
  final AccessState access = AccessState(role: fleetSupervisor);

  test('the stored Title Case name maps to a known role, never unknown', () {
    expect(fleetSupervisor.isKnown, isTrue);
    expect(fleetSupervisor.id, RoleId.fleetSupervisor);
    expect(fleetSupervisor.id, isNot(RoleId.reporter));
    expect(knownUnmappedDatabaseRoles, isNot(contains('Fleet Supervisor')));
  });

  test('reaches the accident report and the register by role default', () {
    for (final ModuleKey module in <ModuleKey>[
      ModuleKey.reportAccident,
      ModuleKey.accidents,
    ]) {
      final AccessDecision decision =
          resolveModuleAccess(module: module, access: access);
      expect(decision.isAllowed, isTrue, reason: module.wireKey);
      expect(decision.reason, AccessReason.roleDefault);
    }
  });

  test('gains nothing else: other modules stay closed', () {
    // Workshop Status mirrors the server seed, which lists Fleet Supervisor
    // among its managers.
    expect(
      allowedModulesFor(access),
      <ModuleKey>{
        ModuleKey.reportAccident,
        ModuleKey.accidents,
        ModuleKey.workshopStatus,
      },
    );
  });

  test('a per-user revoke still removes the report from one person', () {
    final AccessState revoked = AccessState(
      role: fleetSupervisor,
      grants: const <ModuleKey, GrantEffect>{
        ModuleKey.reportAccident: GrantEffect.revoke,
      },
    );
    expect(
      canAccessModule(module: ModuleKey.reportAccident, access: revoked),
      isFalse,
    );
  });

  test('the phone parity lists are untouched (drift guard stays honest)', () {
    for (final ModuleDef def in ModuleRegistry.all) {
      expect(def.defaultRoles, isNot(contains(RoleId.fleetSupervisor)));
    }
  });

  test('the router opens the accident report route for a Fleet Supervisor', () {
    final RealModuleAccessResolver resolver = RealModuleAccessResolver(
      access,
      AdminRevokePrecedence.serverAppUserCan,
    );
    expect(
      resolver.decide(TpRouteGuards.forRouteId(TpRouteId.accidentReport)),
      isA<ModuleAccessAllowed>(),
    );
    expect(
      resolver.decide(TpRouteGuards.forRouteId(TpRouteId.accidentDashboard)),
      isA<ModuleAccessAllowed>(),
    );
  });
}
