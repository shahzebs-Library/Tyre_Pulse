library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/rca/data/rca_repository.dart';
import 'package:tyre_pulse/features/rca/domain/rca_record.dart';
import 'package:tyre_pulse/features/rca/presentation/rca_screen.dart';
import 'package:tyre_pulse/features/rca/rca_providers.dart';

final class _FakeRcaRepository implements RcaRepository {
  _FakeRcaRepository(this.records);
  final List<RcaRecord> records;
  SubmitRcaInput? submitted;

  @override
  Future<List<RcaRecord>> listRecent({String? country}) async => records;

  @override
  Future<void> submit({
    required WorkspaceContext workspace,
    required SubmitRcaInput input,
  }) async {
    submitted = input;
  }
}

const AccessState _access = AccessState(role: UserRole.known(RoleId.admin));
const WorkspaceContext _workspace = WorkspaceContext(
  userId: 'user-1',
  role: UserRole.known(RoleId.admin),
  effectivePermissions: _access,
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
  activeCountry: 'KSA',
);

Future<void> _pump(
  WidgetTester tester,
  RcaRoute route,
  _FakeRcaRepository repository,
) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        workspaceContextProvider.overrideWithValue(_workspace),
        rcaRepositoryProvider.overrideWithValue(repository),
      ],
      child: MaterialApp(
        theme: TpTheme.light,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: RcaScreen(route: route),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('renders verified RCA records', (WidgetTester tester) async {
    await _pump(
      tester,
      const RcaRoute(),
      _FakeRcaRepository(const <RcaRecord>[
        RcaRecord(
          id: 'rca-1',
          assetNo: 'TM-100',
          brand: 'Michelin',
          site: 'NHC',
          rootCause: 'Persistent under-inflation',
          contributingFactors: <String>['Under-inflation'],
        ),
      ]),
    );
    expect(find.byKey(const Key('rca.list')), findsOneWidget);
    expect(find.textContaining('TM-100'), findsOneWidget);
    expect(find.text('Persistent under-inflation'), findsOneWidget);
  });

  testWidgets('route prefill opens the working create flow and queues input', (
    WidgetTester tester,
  ) async {
    final repository = _FakeRcaRepository(const <RcaRecord>[]);
    await _pump(
      tester,
      const RcaRoute(
        assetNo: AssetNo('PUMP-3'),
        siteName: SiteName('Qiddiya'),
        tyreSerial: TyreSerial('TY-77'),
      ),
      repository,
    );

    expect(
      tester
          .widget<TextField>(find.byKey(const Key('rca.asset')))
          .controller!
          .text,
      'PUMP-3',
    );
    await tester.enterText(
      find.byKey(const Key('rca.cause')),
      'Impact damage from road hazard',
    );
    await tester.tap(find.byKey(const Key('rca.factor.Road hazard')));
    await tester.ensureVisible(find.byKey(const Key('rca.submit')));
    await tester.tap(find.byKey(const Key('rca.submit')));
    await tester.pumpAndSettle();

    expect(repository.submitted!.assetNo, 'PUMP-3');
    expect(repository.submitted!.tyreSerial, 'TY-77');
    expect(repository.submitted!.site, 'Qiddiya');
    expect(repository.submitted!.contributingFactors, <String>['Road hazard']);
  });
}
