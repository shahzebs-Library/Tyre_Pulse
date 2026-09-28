/// Pure rules behind Home's recent-inspections strip and its draft filters.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/home/domain/home_work.dart';

Map<String, Object?> _wheel(String condition, {Object? pressure = 110}) =>
    <String, Object?>{
      'condition': condition,
      'pressure_psi': pressure,
      'checked': true,
    };

WorkspaceContext _ws({String? company, String? tenant}) => WorkspaceContext(
      userId: 'user-1',
      role: const UserRole.known(RoleId.admin),
      effectivePermissions:
          const AccessState(role: UserRole.known(RoleId.admin)),
      countryScope: CountryScope.none,
      siteScope: SiteScope.none,
      companyId: company,
      tenantId: tenant,
    );

void main() {
  group('healthFromTyreConditions', () {
    test('the worst recorded wheel wins', () {
      expect(
        healthFromTyreConditions(<String, Object?>{
          'LHF1': _wheel('Good'),
          'RHF1': _wheel('Worn'),
        }),
        HomeAssetHealth.attention,
      );
      expect(
        healthFromTyreConditions(<String, Object?>{
          'LHF1': _wheel('Worn'),
          'RHF1': _wheel('Damaged'),
        }),
        HomeAssetHealth.critical,
      );
      expect(
        healthFromTyreConditions(<String, Object?>{'LHF1': _wheel('Good')}),
        HomeAssetHealth.good,
      );
    });

    test('nothing recorded is "not checked", never "good"', () {
      expect(healthFromTyreConditions(null), HomeAssetHealth.notChecked);
      expect(
        healthFromTyreConditions(const <String, Object?>{}),
        HomeAssetHealth.notChecked,
      );
    });
  });

  group('recentAssetsFromInspections', () {
    test('keeps the first (newest) row per asset, case-insensitively', () {
      final List<HomeRecentAsset> out = recentAssetsFromInspections(
        <Map<String, Object?>>[
          <String, Object?>{
            'asset_no': 'CP045',
            'vehicle_type': 'PUMPS',
            'tyre_conditions': <String, Object?>{'L': _wheel('Damaged')},
          },
          <String, Object?>{
            'asset_no': 'cp045 ',
            'tyre_conditions': <String, Object?>{'L': _wheel('Good')},
          },
          <String, Object?>{'asset_no': '  '},
          <String, Object?>{'asset_no': 'TM102'},
        ],
      );
      expect(out.map((HomeRecentAsset a) => a.assetNo), <String>[
        'CP045',
        'TM102',
      ]);
      expect(out.first.health, HomeAssetHealth.critical);
      expect(out.first.vehicleType, 'PUMPS');
      expect(out.last.health, HomeAssetHealth.notChecked);
    });

    test('stops at the limit', () {
      final List<HomeRecentAsset> out = recentAssetsFromInspections(
        <Map<String, Object?>>[
          for (int i = 0; i < 10; i++) <String, Object?>{'asset_no': 'A$i'},
        ],
        limit: 6,
      );
      expect(out, hasLength(6));
    });
  });

  group('homeDraftWorkspaceIds', () {
    test('both the queue and the wizard derivations are accepted', () {
      expect(homeDraftWorkspaceIds(_ws(company: 'org-1', tenant: 'org-1')), {
        'org-1',
      });
      // A blank companyId is never a workspace: it is dropped, and the
      // queue derivation falls back to the tenant.
      expect(homeDraftWorkspaceIds(_ws(company: '', tenant: 'org-2')), {
        'org-2',
      });
      expect(homeDraftWorkspaceIds(_ws(tenant: 'org-3')), {'org-3'});
    });

    test('no organisation at all matches nothing rather than everything', () {
      expect(homeDraftWorkspaceIds(_ws()), isEmpty);
    });
  });

  group('draftMatchesActiveCountry', () {
    test('another country is hidden; blank on either side is visible', () {
      expect(
        draftMatchesActiveCountry(draftCountry: 'UAE', activeCountry: 'KSA'),
        isFalse,
      );
      expect(
        draftMatchesActiveCountry(draftCountry: 'ksa', activeCountry: 'KSA'),
        isTrue,
      );
      expect(
        draftMatchesActiveCountry(draftCountry: null, activeCountry: 'KSA'),
        isTrue,
      );
      expect(
        draftMatchesActiveCountry(draftCountry: 'UAE', activeCountry: null),
        isTrue,
      );
      expect(
        draftMatchesActiveCountry(draftCountry: 'UAE', activeCountry: 'All'),
        isTrue,
      );
    });
  });
}
