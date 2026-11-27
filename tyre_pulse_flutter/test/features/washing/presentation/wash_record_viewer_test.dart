import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/washing/data/wash_record.dart';
import 'package:tyre_pulse/features/washing/data/wash_repository.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_record_viewer.dart';
import 'package:tyre_pulse/features/washing/washing_providers.dart';

final class _Repo implements WashRepository {
  final List<String> verified = <String>[];

  @override
  Future<void> verifyWash(String washId, {String? note}) async =>
      verified.add(washId);

  @override
  Future<String?> currentUserDisplayName(String userId) async => null;

  @override
  Future<List<WashRecord>> listRecentWashes({int limit = 200}) async =>
      const <WashRecord>[];

  @override
  Future<Set<String>> submitWash({
    required WorkspaceContext workspace,
    required SubmitWashInput input,
  }) async =>
      const <String>{};
}

WorkspaceContext _me(String id, UserRole role) => WorkspaceContext(
      userId: id,
      role: role,
      effectivePermissions: AccessState(role: role),
      countryScope: CountryScope.none,
      siteScope: SiteScope.none,
      activeCountry: 'KSA',
    );

Future<void> _show(
  WidgetTester tester,
  WashRecord wash, {
  WorkspaceContext? me,
  _Repo? repo,
}) async {
  tester.view.physicalSize = const Size(420, 3000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        privateStorageImageUrlProvider.overrideWith(
          (ref, reference) async => throw StateError('offline'),
        ),
        workspaceContextProvider.overrideWithValue(me),
        washRepositoryProvider.overrideWithValue(repo ?? _Repo()),
      ],
      child: MaterialApp(
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: WashRecordViewer(wash: wash),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

WashRecord _pending({String status = 'pending'}) =>
    WashRecord.fromRow(<String, dynamic>{
      'id': 'w-1',
      'asset_no': 'TM514',
      'wash_date': '2026-11-27',
      'created_by': 'driver-1',
      'verification_status': status,
      if (status == 'not_required') 'verified_by': 'driver-1',
    });

void main() {
  testWidgets('a supervisor can verify a driver wash',
      (WidgetTester tester) async {
    final _Repo repo = _Repo();
    await _show(
      tester,
      _pending(),
      me: _me('sup-1', UserRole.fromDatabase('Fleet Supervisor')),
      repo: repo,
    );
    expect(find.text('Waiting for a supervisor to verify'), findsOneWidget);
    expect(find.text('Next wash due 2026-12-04'), findsOneWidget);
    await tester.tap(find.byKey(WashRecordViewer.verifyAction));
    await tester.pumpAndSettle();
    expect(repo.verified, <String>['w-1']);
    expect(find.text('Wash verified'), findsWidgets);
    expect(find.byKey(WashRecordViewer.verifyAction), findsNothing);
  });

  testWidgets('the driver who logged it cannot verify it',
      (WidgetTester tester) async {
    await _show(
      tester,
      _pending(),
      me: _me('driver-1', UserRole.fromDatabase('Fleet Supervisor')),
    );
    expect(find.byKey(WashRecordViewer.verifyAction), findsNothing);
    expect(find.textContaining('another supervisor must verify'), findsOne);
  });

  testWidgets('a driver role cannot verify someone else\'s wash',
      (WidgetTester tester) async {
    await _show(
      tester,
      _pending(),
      me: _me('driver-2', const UserRole.known(RoleId.driver)),
    );
    expect(find.byKey(WashRecordViewer.verifyAction), findsNothing);
  });

  testWidgets('a supervisor entry needs no check', (WidgetTester tester) async {
    await _show(
      tester,
      _pending(status: 'not_required'),
      me: _me('sup-1', UserRole.fromDatabase('Fleet Supervisor')),
    );
    expect(
      find.text('No check needed: logged by a supervisor'),
      findsOneWidget,
    );
    expect(find.byKey(WashRecordViewer.verifyAction), findsNothing);
  });

  WashRecord record() => WashRecord.fromRow(<String, dynamic>{
        'id': '9f1c2d3e-0000-4000-8000-000000000001',
        'asset_no': 'TM514',
        'vehicle_type': 'TR-MIXER',
        'site': 'DIRIYAH-G1',
        'wash_date': '2026-11-27',
        'wash_time': '09:01',
        'wash_type': 'Engine Bay',
        'entry_name': 'Ahmed Saleh',
        'captured_at': '2026-11-27T06:01:30Z',
        'created_at': '2026-11-27T06:02:10Z',
        'photos': <String>['tp-storage://a.jpg', 'tp-storage://b.jpg'],
        'wash_details': <String, dynamic>{
          'version': 1,
          'chemical_status': 'none',
          'chemicals': <dynamic>[],
          'areas': <String>['engine_bay', 'drum_hopper'],
          'views': <String>['left', 'rear'],
          'photo_evidence': <Map<String, Object?>>[
            <String, Object?>{
              'index': 0,
              'stage': 'before',
              'taken_at': '2026-11-27T06:00:00.000Z',
              'lat': 24.713612,
              'lng': 46.675346,
            },
            <String, Object?>{
              'index': 1,
              'stage': 'after',
              'taken_at': '2026-11-27T06:01:00.000Z',
            },
          ],
        },
      });

  testWidgets('shows everything an auditor needs and no edit',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(420, 3000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          privateStorageImageUrlProvider.overrideWith(
            (ref, reference) async => throw StateError('offline'),
          ),
          workspaceContextProvider.overrideWithValue(null),
        ],
        child: MaterialApp(
          theme: TpTheme.light,
          locale: const Locale('en'),
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: WashRecordViewer(wash: record()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(WashRecordViewer.readOnlyNote), findsOneWidget);
    expect(
      find.textContaining('cannot be changed on the phone'),
      findsOneWidget,
    );
    expect(find.text('9f1c2d3e-0000-4000-8000-000000000001'), findsOneWidget);
    expect(find.text('TM514 · TR-MIXER'), findsOneWidget);
    expect(find.text('DIRIYAH-G1'), findsOneWidget);
    expect(find.text('Ahmed Saleh'), findsOneWidget);
    expect(find.text('Left, Rear'), findsOneWidget);
    expect(find.text('Engine bay, Mixer drum and hopper'), findsOneWidget);
    expect(find.text('No charge · washed in-house'), findsOneWidget);
    expect(find.textContaining('24.71361, 46.67535'), findsOneWidget);
    expect(find.textContaining('No GPS'), findsOneWidget);
    expect(find.byIcon(Icons.edit_outlined), findsNothing);
    expect(find.byIcon(Icons.edit), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
