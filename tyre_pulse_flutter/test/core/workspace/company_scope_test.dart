import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/company_scope.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';

const UserRole _role = UserRole.known(RoleId.reporter);

WorkspaceContext _ws({String? tenantId, String? companyId}) => WorkspaceContext(
      userId: 'user-1',
      role: _role,
      effectivePermissions: const AccessState(role: _role),
      countryScope: CountryScope.none,
      siteScope: SiteScope.none,
      tenantId: tenantId,
      companyId: companyId,
    );

void main() {
  const String orgA = '00000000-0000-0000-0000-000000000001';
  const String orgB = 'a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7';

  test('isCompanyId accepts a uuid and refuses blanks and junk', () {
    expect(isCompanyId(orgA), isTrue);
    expect(isCompanyId(' $orgA '), isTrue);
    expect(isCompanyId(null), isFalse);
    expect(isCompanyId(''), isFalse);
    expect(isCompanyId('ALL'), isFalse);
  });

  group('activeCompanyIdFor', () {
    test('no workspace, no pin', () {
      expect(activeCompanyIdFor(null), isNull);
    });

    test('pins org_id (tenantId), the column RLS reads', () {
      expect(activeCompanyIdFor(_ws(tenantId: orgA, companyId: orgA)), orgA);
      expect(activeCompanyIdFor(_ws(tenantId: orgA)), orgA);
    });

    test('falls back to organisation_id when org_id is missing or junk', () {
      expect(activeCompanyIdFor(_ws(companyId: orgB)), orgB);
      expect(activeCompanyIdFor(_ws(tenantId: 'x', companyId: orgB)), orgB);
    });

    test('skips the pin entirely when the two columns disagree', () {
      expect(activeCompanyIdFor(_ws(tenantId: orgA, companyId: orgB)), isNull);
    });
  });
}
