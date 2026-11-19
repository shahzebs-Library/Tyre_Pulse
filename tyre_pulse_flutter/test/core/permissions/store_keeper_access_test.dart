import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';

/// docs/inventory/05_mobile_identification_audit.md finding 1: Store Keeper
/// was in `knownUnmappedDatabaseRoles`, so it resolved to an unknown role and
/// was denied every module, including Stock Count.
void main() {
  Set<ModuleKey> reach(String role, Map<String, Object?> matrix) =>
      allowedModulesFor(
        AccessState.fromRaw(
          role: UserRole.fromDatabase(role),
          grantsRaw: const <String, Object?>{},
          roleMatrixRaw: matrix,
        ),
      );

  test('Store Keeper maps to a real role, not unknown', () {
    final UserRole role = UserRole.fromDatabase('Store Keeper');
    expect(role.isKnown, isTrue);
    expect(role.id, RoleId.storeKeeper);
    expect(role.isRecognisedButUnmapped, isFalse);
    expect(knownUnmappedDatabaseRoles, isNot(contains('Store Keeper')));
  });

  test('with no matrix Store Keeper reaches Stock Count and nothing else', () {
    expect(
      reach('Store Keeper', const <String, Object?>{}),
      <ModuleKey>{ModuleKey.stock},
    );
  });

  test('Store Keeper is a Flutter extension, not in the parity lists', () {
    final ModuleDef stock = ModuleRegistry.all
        .firstWhere((ModuleDef d) => d.key == ModuleKey.stock);
    expect(stock.defaultRoles, isNot(contains(RoleId.storeKeeper)));
    expect(
      flutterRoleDefaultExtensions[ModuleKey.stock],
      contains(RoleId.storeKeeper),
    );
  });

  test('a matrix row turned off removes Stock Count from Store Keeper', () {
    expect(
      reach('Store Keeper', const <String, Object?>{'mobile:stock': false}),
      isNot(contains(ModuleKey.stock)),
    );
  });

  test('Store Keeper does not reach handover, admin or stock management', () {
    final Set<ModuleKey> allowed =
        reach('Store Keeper', const <String, Object?>{});
    expect(allowed, isNot(contains(ModuleKey.handover)));
    expect(allowed, isNot(contains(ModuleKey.admin)));
    expect(allowed, isNot(contains(ModuleKey.stockManage)));
  });
}
