import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';

/// The role matrix rows the web Access Manager holds for the roles testers
/// use, as returned by `get_user_module_permissions` when called AS a tester
/// (verified by impersonation on 2026-09-29). Sub-module keys are included
/// because the RPC returns them and they must be ignored, not misread.
void main() {
  Set<ModuleKey> reach(String role, Map<String, Object?> matrix) =>
      allowedModulesFor(
        AccessState.fromRaw(
          role: UserRole.fromDatabase(role),
          grantsRaw: const <String, Object?>{},
          roleMatrixRaw: matrix,
        ),
      );

  test('Fleet Supervisor reaches every module its role matrix enables', () {
    final Set<ModuleKey> allowed = reach('Fleet Supervisor', <String, Object?>{
      'mobile:scan': true,
      'mobile:meter': true,
      'mobile:tasks': true,
      'mobile:inspect': true,
      'mobile:washing': true,
      'mobile:workshop': true,
      'mobile:accidents': true,
      'mobile:checklists': true,
      'mobile:fleet_master': true,
      'mobile:reportAccident': true,
      'mobile:accidents:builder': false,
      'mobile:fleet_master:assets': false,
      'mobile:fleet_master:drivers': false,
      'mobile:work_orders:register': false,
      // Web scope rows never reach the phone.
      'accidents': true,
      'dashboard': true,
    });
    expect(allowed, <ModuleKey>{
      ModuleKey.inspect,
      ModuleKey.scan,
      ModuleKey.checklists,
      ModuleKey.meter,
      ModuleKey.washing,
      ModuleKey.vehicles,
      ModuleKey.accidents,
      ModuleKey.reportAccident,
      ModuleKey.tasks,
      ModuleKey.workshop,
    });
  });

  test('with no matrix at all Fleet Supervisor keeps its role default', () {
    expect(reach('Fleet Supervisor', const <String, Object?>{}), <ModuleKey>{
      ModuleKey.accidents,
      ModuleKey.reportAccident,
    });
  });

  test('a role the app has no token for still honours its matrix rows', () {
    // Store Keeper is held by real people and has no phone token. The matrix
    // is the only thing that should open anything for it.
    final Set<ModuleKey> allowed = reach('Store Keeper', <String, Object?>{
      'mobile:stock': true,
      'mobile:stockManage': true,
      'mobile:tasks': true,
    });
    expect(allowed, <ModuleKey>{
      ModuleKey.stock,
      ModuleKey.stockManage,
      ModuleKey.tasks,
    });
  });

  test('a matrix row turned off beats the role default', () {
    final Set<ModuleKey> allowed = reach('Tyre Man', <String, Object?>{
      'mobile:checklists': false,
      'mobile:meter': false,
    });
    expect(allowed, isNot(contains(ModuleKey.checklists)));
    expect(allowed, isNot(contains(ModuleKey.meter)));
    expect(allowed, contains(ModuleKey.inspect));
  });

  test('a per user revoke beats a matrix enable', () {
    final AccessState state = AccessState.fromRaw(
      role: UserRole.fromDatabase('Fleet Supervisor'),
      grantsRaw: const <String, Object?>{'mobile:inspect': 'revoke'},
      roleMatrixRaw: const <String, Object?>{'mobile:inspect': true},
    );
    expect(canAccessModule(module: ModuleKey.inspect, access: state), isFalse);
  });
}
