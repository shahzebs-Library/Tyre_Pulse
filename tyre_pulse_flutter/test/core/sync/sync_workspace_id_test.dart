import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/query_scope.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/sync/sync_workspace_id.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';

const UserRole _testRole = UserRole.known(RoleId.reporter);
const AccessState _testAccess = AccessState(role: _testRole);

WorkspaceContext _context({String? companyId, String? tenantId}) {
  return WorkspaceContext(
    userId: 'user-1',
    role: _testRole,
    effectivePermissions: _testAccess,
    countryScope: CountryScope.none,
    siteScope: SiteScope.none,
    companyId: companyId,
    tenantId: tenantId,
  );
}

void main() {
  test('prefers companyId (organisation_id) over tenantId (org_id)', () {
    final WorkspaceContext context = _context(
      companyId: 'company-a',
      tenantId: 'tenant-a',
    );

    expect(workspaceIdFor(context), 'company-a');
  });

  test('falls back to tenantId when companyId is absent', () {
    final WorkspaceContext context = _context(tenantId: 'tenant-a');

    expect(workspaceIdFor(context), 'tenant-a');
  });

  test('falls back to tenantId when companyId is blank', () {
    final WorkspaceContext context = _context(
      companyId: '   ',
      tenantId: 'tenant-a',
    );

    expect(workspaceIdFor(context), 'tenant-a');
  });

  test('never returns the raw companyId untrimmed', () {
    final WorkspaceContext context = _context(companyId: '  company-a  ');

    expect(workspaceIdFor(context), 'company-a');
  });

  test('throws ArgumentError when both organisation columns are absent', () {
    final WorkspaceContext context = _context();

    expect(() => workspaceIdFor(context), throwsA(isA<ArgumentError>()));
  });

  test('throws ArgumentError when both organisation columns are blank', () {
    final WorkspaceContext context = _context(companyId: '', tenantId: '  ');

    expect(() => workspaceIdFor(context), throwsA(isA<ArgumentError>()));
  });

  test(
      'this is the exact meaning WorkspaceScopeFilter already uses for '
      'cached reads', () {
    final WorkspaceContext context = _context(
      companyId: 'company-a',
      tenantId: 'tenant-a',
    );

    final WorkspaceScopeFilter scope = WorkspaceScopeFilter(
      workspaceId: workspaceIdFor(context),
    );

    expect(scope.workspaceId, context.companyId);
  });
}
