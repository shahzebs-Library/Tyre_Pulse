import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/admin/data/admin_sites_repository.dart';

WorkspaceContext _workspace({String? companyId = 'org-a'}) => WorkspaceContext(
      userId: 'admin',
      tenantId: 'org-a',
      companyId: companyId,
      role: const UserRole.known(RoleId.admin),
      effectivePermissions:
          const AccessState(role: UserRole.known(RoleId.admin)),
      countryScope: CountryScope.fromJson(['Saudi Arabia']),
      siteScope: SiteScope.none,
      activeCountry: 'Saudi Arabia',
    );

class _Source implements AdminSitesSource {
  String? org, country, id;
  int? offset;
  Map<String, Object?>? values;
  @override
  Future<List<AdminSite>> page(String org, String? country, int offset) async {
    this.org = org;
    this.country = country;
    this.offset = offset;
    return [];
  }

  @override
  Future<AdminSite> save(
    String org,
    String? id,
    Map<String, Object?> values,
  ) async {
    this.org = org;
    this.id = id;
    this.values = values;
    return AdminSite(
      id: id ?? 'server-id',
      name: 'Normalized site',
      country: values['country']! as String,
      organisationId: org,
      active: values['active']! as bool,
    );
  }
}

class _AmbiguousSource extends _Source {
  final createIds = <Object?>[];
  @override
  Future<AdminSite> save(
    String org,
    String? id,
    Map<String, Object?> values,
  ) async {
    createIds.add(values['id']);
    final result = await super.save(org, id, values);
    if (createIds.length == 1) throw StateError('Response lost after commit');
    return result;
  }
}

void main() {
  test('create retries retain one identity after an unknown outcome', () async {
    final source = _AmbiguousSource();
    final repository = AdminSitesRepository(source);
    Future<AdminSite> save() => repository.save(
          _workspace(),
          createId: 'stable-id',
          name: 'Test',
          country: 'Saudi Arabia',
          active: true,
        );
    await expectLater(save(), throwsStateError);
    await save();
    expect(source.createIds, ['stable-id', 'stable-id']);
  });

  test('list is bounded by organisation, selected country and page', () async {
    final source = _Source();
    await AdminSitesRepository(source).page(_workspace(), 50);
    expect(source.org, 'org-a');
    expect(source.country, 'Saudi Arabia');
    expect(source.offset, 50);
  });
  test(
      'new site sends explicit country and actor, returns server-normalized row',
      () async {
    final source = _Source();
    final site = await AdminSitesRepository(source).save(
      _workspace(),
      createId: 'client-site',
      name: ' Test ',
      country: 'Saudi Arabia',
      region: ' ',
      active: true,
    );
    expect(source.values, {
      'id': 'client-site',
      'name': 'Test',
      'country': 'Saudi Arabia',
      'region': null,
      'city': null,
      'active': true,
      'created_by': 'admin',
    });
    expect(site.id, 'server-id');
    expect(site.name, 'Normalized site');
  });
  test('archive updates the existing site without deleting it', () async {
    final source = _Source();
    const existing = AdminSite(
      id: 'site-1',
      name: 'Test',
      country: 'Saudi Arabia',
      organisationId: 'org-a',
    );
    final site = await AdminSitesRepository(source).save(
      _workspace(),
      existing: existing,
      name: existing.name,
      country: existing.country,
      active: false,
    );
    expect(source.id, 'site-1');
    expect(site.active, isFalse);
    expect(source.values!.containsKey('created_by'), isFalse);
  });
  test('missing organisation and outside-country writes never reach source',
      () {
    final source = _Source();
    final repository = AdminSitesRepository(source);
    expect(
      () => repository.page(_workspace(companyId: null), 0),
      throwsA(anything),
    );
    expect(
      () => repository.save(
        _workspace(),
        name: 'Site',
        country: 'Oman',
        active: true,
      ),
      throwsA(anything),
    );
    expect(source.values, isNull);
  });
  test('another organisation site cannot be edited', () {
    final source = _Source();
    expect(
      () => AdminSitesRepository(source).save(
        _workspace(),
        existing: const AdminSite(
          id: 'foreign',
          name: 'Other',
          country: 'Saudi Arabia',
          organisationId: 'org-b',
        ),
        name: 'Other',
        country: 'Saudi Arabia',
        active: false,
      ),
      throwsA(anything),
    );
    expect(source.values, isNull);
  });
}
