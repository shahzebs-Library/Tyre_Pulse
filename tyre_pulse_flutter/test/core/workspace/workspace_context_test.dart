import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';

Map<String, Object?> row({
  Object? id = 'user-1',
  Object? role = 'Manager',
  Object? country = const <Object?>['KSA'],
  Object? sites = const <Object?>['ALL'],
  Object? orgId = 'org-1',
  Object? organisationId = 'org-1',
  Object? isSuperAdmin,
  Object? approved = true,
  Object? locked,
  Object? site = 'NHC',
}) =>
    <String, Object?>{
      'id': id,
      'role': role,
      'country': country,
      'sites': sites,
      'org_id': orgId,
      'organisation_id': organisationId,
      'is_super_admin': isSuperAdmin,
      'approved': approved,
      'locked': locked,
      'site': site,
      'full_name': 'A Person',
    };

void main() {
  group('WorkspaceProfile decodes the row honestly', () {
    test('country and sites decode as arrays, not scalars', () {
      final WorkspaceProfile profile = WorkspaceProfile.fromRow(
        row(country: const <Object?>['KSA', 'UAE']),
      );
      expect(profile.countryScope.values, <String>['KSA', 'UAE']);
      expect(profile.siteScope.isOrganisationWide, isTrue);
    });

    test('an empty country array grants nothing', () {
      final WorkspaceProfile profile = WorkspaceProfile.fromRow(
        row(country: const <Object?>[]),
      );
      expect(profile.countryScope.isBlank, isTrue);
      expect(profile.countryScope.canSee('KSA', isSuperAdmin: false), isFalse);
    });

    test('a null is_super_admin is not truthy', () {
      // The column is boolean and NULLABLE. The phone declares it
      // `boolean | null` and compares === true for exactly this reason.
      expect(WorkspaceProfile.fromRow(row()).isSuperAdmin, isFalse);
      expect(
        WorkspaceProfile.fromRow(row(isSuperAdmin: true)).isSuperAdmin,
        isTrue,
      );
      expect(
        WorkspaceProfile.fromRow(row(isSuperAdmin: 'true')).isSuperAdmin,
        isFalse,
        reason: 'a non-boolean must never elevate anybody',
      );
    });

    test('a null locked is not locked', () {
      expect(WorkspaceProfile.fromRow(row()).isLocked, isFalse);
      expect(WorkspaceProfile.fromRow(row(locked: true)).isLocked, isTrue);
    });

    test('an unrecognised role stays unknown', () {
      final WorkspaceProfile profile = WorkspaceProfile.fromRow(
        row(role: 'Tire Planning Engineer'),
      );
      expect(profile.role.isUnknown, isTrue);
      expect(profile.role.id, isNot(RoleId.reporter));
    });

    test('the legacy scalar site is kept apart from the site scope', () {
      final WorkspaceProfile profile = WorkspaceProfile.fromRow(
        row(site: 'NHC', sites: const <Object?>['DIRIYAH']),
      );
      expect(profile.legacySite, 'NHC');
      expect(profile.siteScope.values, <String>['DIRIYAH']);
    });

    test('the two organisation columns are read separately', () {
      // app_current_org() reads org_id. Data rows carry organisation_id. V311
      // exists because a row with one set and the other NULL is visible under
      // one boundary and invisible under the other.
      final WorkspaceProfile agreeing = WorkspaceProfile.fromRow(row());
      expect(agreeing.tenantId, 'org-1');
      expect(agreeing.companyId, 'org-1');
      expect(agreeing.organisationIdsDiffer, isFalse);
      expect(agreeing.organisationIdIncomplete, isFalse);

      final WorkspaceProfile diverging = WorkspaceProfile.fromRow(
        row(organisationId: 'org-2'),
      );
      expect(diverging.organisationIdsDiffer, isTrue);

      final WorkspaceProfile incomplete = WorkspaceProfile.fromRow(
        row(organisationId: null),
      );
      expect(incomplete.organisationIdIncomplete, isTrue);
      expect(incomplete.organisationIdsDiffer, isFalse);
    });

    test('a row with no id is refused, not carried on with', () {
      expect(
        () => WorkspaceProfile.fromRow(row(id: null)),
        throwsA(
          isA<AppError>().having(
            (AppError e) => e.kind,
            'kind',
            AppErrorKind.validation,
          ),
        ),
      );
      expect(
        () => WorkspaceProfile.fromRow(row(id: '')),
        throwsA(isA<AppError>()),
      );
      expect(
        () => WorkspaceProfile.fromRow(row(id: 7)),
        throwsA(isA<AppError>()),
      );
    });

    test('approved false or locked true blocks the app', () {
      expect(WorkspaceProfile.fromRow(row()).isBlockedFromApp, isFalse);
      expect(
        WorkspaceProfile.fromRow(row(approved: false)).isBlockedFromApp,
        isTrue,
      );
      expect(
        WorkspaceProfile.fromRow(row(locked: true)).isBlockedFromApp,
        isTrue,
      );
    });
  });

  group('WorkspaceContext carries the eight fields spec section 8 names', () {
    test('every field is present and typed', () {
      final WorkspaceProfile profile = WorkspaceProfile.fromRow(row());
      final WorkspaceContext context = WorkspaceContext.fromProfile(
        profile,
        effectivePermissions: AccessState(role: profile.role),
        activeCountry: 'KSA',
        activeSites: const <String>['NHC'],
        currency: 'SAR',
      );

      expect(context.userId, 'user-1');
      expect(context.tenantId, 'org-1');
      expect(context.companyId, 'org-1');
      expect(context.activeCountry, 'KSA');
      expect(context.currency, 'SAR');
      expect(context.siteIds, <String>['NHC']);
      expect(context.role.id, RoleId.manager);
      expect(context.effectivePermissions.role.id, RoleId.manager);
    });

    test('currency is NOT defaulted - it is null until the server says', () {
      // Spec section 8: the Kotlin project hard-coded Saudi Arabia and SAR for
      // every user. mobile/lib/execReportPdf.ts still reads
      // `opts.currency ?? 'SAR'` and its only caller passes nothing.
      final WorkspaceContext context = WorkspaceContext.fromProfile(
        WorkspaceProfile.fromRow(row()),
        effectivePermissions: AccessState.signedOut,
        activeCountry: 'Egypt',
      );

      expect(context.currency, isNull);
      expect(context.currency, isNot('SAR'));
      expect(context.hasCurrency, isFalse);
    });

    test('no country is hard-coded either', () {
      final WorkspaceContext context = WorkspaceContext.fromProfile(
        WorkspaceProfile.fromRow(row(country: const <Object?>['Egypt'])),
        effectivePermissions: AccessState.signedOut,
      );
      expect(context.activeCountry, isNull);
      expect(context.filtersByCountry, isFalse);
      expect(context.countryScope.values, <String>['Egypt']);
    });

    test('an empty site list means no filter, not no access', () {
      final WorkspaceContext context = WorkspaceContext.fromProfile(
        WorkspaceProfile.fromRow(row()),
        effectivePermissions: AccessState.signedOut,
      );
      expect(context.siteIds, isEmpty);
      expect(context.filtersBySite, isFalse);
      expect(context.siteScope.isOrganisationWide, isTrue);
    });

    test('navigation is derived from the resolver, not from the role', () {
      final WorkspaceProfile profile = WorkspaceProfile.fromRow(
        row(role: 'Driver'),
      );
      final WorkspaceContext context = WorkspaceContext.fromProfile(
        profile,
        effectivePermissions: AccessState(role: profile.role),
      );

      expect(context.allowedModules(), <ModuleKey>{
        ModuleKey.serial,
        ModuleKey.checklists,
        ModuleKey.meter,
        ModuleKey.washing,
        ModuleKey.reportIssue,
        ModuleKey.repairRequest,
        ModuleKey.vehicles,
      });
    });

    test('a per-user grant reaches the workspace navigation', () {
      final WorkspaceProfile profile = WorkspaceProfile.fromRow(
        row(role: 'Driver'),
      );
      final WorkspaceContext context = WorkspaceContext.fromProfile(
        profile,
        effectivePermissions: AccessState(
          role: profile.role,
          grants: const <ModuleKey, GrantEffect>{
            ModuleKey.analytics: GrantEffect.grant,
          },
        ),
      );
      expect(context.allowedModules(), contains(ModuleKey.analytics));
    });
  });

  group('copyWith', () {
    test('clearing the country is distinguishable from not changing it', () {
      final WorkspaceContext context = WorkspaceContext.fromProfile(
        WorkspaceProfile.fromRow(row()),
        effectivePermissions: AccessState.signedOut,
        activeCountry: 'KSA',
        currency: 'SAR',
      );

      expect(context.copyWith().activeCountry, 'KSA');
      expect(context.copyWith(clearActiveCountry: true).activeCountry, isNull);
      expect(context.copyWith(clearCurrency: true).currency, isNull);
      expect(context.copyWith(activeCountry: 'UAE').activeCountry, 'UAE');
    });

    test('two contexts built the same way are equal', () {
      WorkspaceContext build() => WorkspaceContext.fromProfile(
            WorkspaceProfile.fromRow(row()),
            effectivePermissions: AccessState.signedOut,
            activeCountry: 'KSA',
            activeSites: const <String>['NHC'],
            currency: 'SAR',
          );

      expect(build(), build());
      expect(build().hashCode, build().hashCode);
    });

    test('a country change is a real change', () {
      final WorkspaceContext base = WorkspaceContext.fromProfile(
        WorkspaceProfile.fromRow(row(country: const <Object?>['KSA', 'UAE'])),
        effectivePermissions: AccessState.signedOut,
        activeCountry: 'KSA',
      );
      expect(base, isNot(base.copyWith(activeCountry: 'UAE')));
    });
  });

  group('scope helpers stay separate from the legacy scalar', () {
    test('the site scope answers, the legacy scalar does not', () {
      final WorkspaceProfile profile = WorkspaceProfile.fromRow(
        row(site: 'JEDDAH', sites: const <Object?>['NHC']),
      );
      final SiteScope scope = profile.siteScope;

      expect(
        scope.canSee('JEDDAH', isSuperAdmin: false, isAdminRole: false),
        isFalse,
        reason: 'the legacy profiles.site column is not the access scope',
      );
      expect(
        scope.canSee('NHC', isSuperAdmin: false, isAdminRole: false),
        isTrue,
      );
    });
  });
}
