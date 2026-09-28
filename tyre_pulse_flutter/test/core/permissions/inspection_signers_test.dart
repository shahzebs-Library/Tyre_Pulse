/// [canSignInspectionApprovals] mirrors `decide_inspection_approval`'s role
/// gate (V606). Reaching the approvals module is not the same as being able
/// to sign, and this pins exactly which roles the server accepts.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/inspection_signers.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';

AccessState _as(RoleId id, {bool superAdmin = false}) =>
    AccessState(role: UserRole.known(id), isSuperAdmin: superAdmin);

void main() {
  test('the signer set is exactly the V606 role list', () {
    expect(
      inspectionApprovalSignerRoles.map((RoleId r) => r.databaseName).toSet(),
      <String>{
        'Admin',
        'PMV Manager',
        'Workshop Area Manager',
        'Workshop Maintenance Area Manager',
        'Tyre Data Collector',
      },
    );
  });

  test('every listed role can sign', () {
    for (final RoleId id in inspectionApprovalSignerRoles) {
      expect(canSignInspectionApprovals(_as(id)), isTrue, reason: id.name);
    }
  });

  test(
      'roles that reach the approvals queue but are refused by the server '
      'cannot sign', () {
    for (final RoleId id in <RoleId>[
      RoleId.manager,
      RoleId.director,
      RoleId.maintenanceSupervisor,
      RoleId.workshopSupervisor,
      RoleId.inspector,
      RoleId.tyreMan,
      RoleId.driver,
      RoleId.reporter,
    ]) {
      expect(canSignInspectionApprovals(_as(id)), isFalse, reason: id.name);
    }
  });

  test('a super admin signs whatever the role', () {
    expect(
      canSignInspectionApprovals(_as(RoleId.reporter, superAdmin: true)),
      isTrue,
    );
  });

  test('an unknown or absent role never signs', () {
    expect(
      canSignInspectionApprovals(
        const AccessState(role: UserRole.unknown('Fleet Supervisor')),
      ),
      isFalse,
    );
    expect(
      canSignInspectionApprovals(const AccessState(role: UserRole.absent)),
      isFalse,
    );
  });
}
