import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/workshop_status/data/workshop_status_repository.dart';
import 'package:tyre_pulse/features/workshop_status/domain/workshop_status_record.dart';
import 'package:tyre_pulse/features/workshop_status/presentation/workshop_status_detail_screen.dart';
import 'package:tyre_pulse/features/workshop_status/presentation/workshop_status_list_screen.dart';
import 'package:tyre_pulse/features/workshop_status/workshop_status_providers.dart';

final class _FakeRepo implements WorkshopStatusRepository {
  _FakeRepo({
    this.permissions = const WorkshopStatusPermissions(
      view: true,
      update: true,
      assign: true,
    ),
    this.stale = false,
  });

  final WorkshopStatusPermissions permissions;
  bool stale;
  final List<Map<String, String?>> patches = <Map<String, String?>>[];
  final List<String?> expected = <String?>[];

  final List<WorkshopStatusRecord> records = <WorkshopStatusRecord>[
    WorkshopStatusRecord.fromRow(const <String, dynamic>{
      'id': 'r1',
      'asset_no': 'TM514',
      'site': 'NHC',
      'current_stage': 'Waiting for Parts',
      'ooc_since': '2026-10-01',
      'responsible_user_id': 'me',
      'updated_at': '2026-10-07T08:12:33.123456+00:00',
    }),
    WorkshopStatusRecord.fromRow(const <String, dynamic>{
      'id': 'r2',
      'asset_no': 'MP200',
      'site': 'RUMAH',
      'updated_at': '2026-10-07T08:00:00+00:00',
    }),
  ];

  @override
  Future<WorkshopStatusList> listActive({String? country}) async =>
      WorkshopStatusList(records: records, truncated: false);

  @override
  Future<WorkshopStatusRecord?> fetch(String id) async =>
      records.firstWhere((WorkshopStatusRecord r) => r.id == id);

  @override
  Future<WorkshopStatusPermissions> myPermissions() async => permissions;

  @override
  Future<void> update({
    required String recordId,
    required Map<String, String?> patch,
    required String? expectedUpdatedAt,
  }) async {
    if (stale) throw const WorkshopStatusStaleError();
    patches.add(patch);
    expected.add(expectedUpdatedAt);
  }
}

Future<void> _pump(WidgetTester tester, _FakeRepo repo, Widget home) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        workshopStatusRepositoryProvider.overrideWithValue(repo),
        workshopStatusUserIdProvider.overrideWithValue('me'),
        workshopStatusClockProvider
            .overrideWithValue(() => DateTime(2026, 10, 7, 15)),
      ],
      child: MaterialApp(
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: home,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _scrollTo(WidgetTester tester, Key key) async {
  await tester.scrollUntilVisible(
    find.byKey(key),
    200,
    scrollable: find.byType(Scrollable).first,
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('Mine shows my vehicle; All shows every vehicle', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo();
    await _pump(
      tester,
      repo,
      const WorkshopStatusListScreen(route: WorkshopStatusRoute()),
    );
    expect(find.byKey(WorkshopStatusKeys.row('r1')), findsOneWidget);
    expect(find.byKey(WorkshopStatusKeys.row('r2')), findsNothing);
    // Never updated by a person: flagged.
    expect(find.byKey(WorkshopStatusKeys.staleBadge('r1')), findsOneWidget);
    expect(find.text('6 days down'), findsOneWidget);

    await tester.tap(find.text('All'));
    await tester.pumpAndSettle();
    expect(find.byKey(WorkshopStatusKeys.row('r2')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('no server view permission shows a refusal, not the list', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      _FakeRepo(permissions: const WorkshopStatusPermissions()),
      const WorkshopStatusListScreen(route: WorkshopStatusRoute()),
    );
    expect(find.byKey(TpStateKeys.permissionDenied), findsOneWidget);
    expect(find.byKey(WorkshopStatusKeys.row('r1')), findsNothing);
  });

  testWidgets('Save sends only the change and updated_at exactly as read', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo();
    await _pump(
      tester,
      repo,
      WorkshopStatusDetailScreen(record: repo.records.first),
    );
    await _scrollTo(tester, WorkshopStatusDetailKeys.field('remarks'));
    await tester.enterText(
      find.descendant(
        of: find.byKey(WorkshopStatusDetailKeys.field('remarks')),
        matching: find.byType(TextField),
      ),
      'Pump on order',
    );
    await tester.ensureVisible(find.byKey(WorkshopStatusDetailKeys.save));
    await tester.tap(find.byKey(WorkshopStatusDetailKeys.save));
    await tester.pumpAndSettle();

    expect(repo.patches, <Map<String, String?>>[
      <String, String?>{'remarks': 'Pump on order'},
    ]);
    expect(repo.expected.single, '2026-10-07T08:12:33.123456+00:00');
  });

  testWidgets('a stale save says someone else updated it', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(stale: true);
    await _pump(
      tester,
      repo,
      WorkshopStatusDetailScreen(record: repo.records.first),
    );
    await _scrollTo(tester, WorkshopStatusDetailKeys.field('remarks'));
    await tester.enterText(
      find.descendant(
        of: find.byKey(WorkshopStatusDetailKeys.field('remarks')),
        matching: find.byType(TextField),
      ),
      'x',
    );
    await tester.ensureVisible(find.byKey(WorkshopStatusDetailKeys.save));
    await tester.tap(find.byKey(WorkshopStatusDetailKeys.save));
    await tester.pumpAndSettle();
    expect(find.text('Updated by someone else'), findsOneWidget);
    expect(find.text('Reload'), findsOneWidget);
  });

  testWidgets('read-only users see no Save button', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(
      permissions: const WorkshopStatusPermissions(view: true),
    );
    await _pump(
      tester,
      repo,
      WorkshopStatusDetailScreen(record: repo.records.first),
    );
    expect(find.byKey(WorkshopStatusDetailKeys.readOnly), findsOneWidget);
    expect(find.byKey(WorkshopStatusDetailKeys.save), findsNothing);
  });

  testWidgets('the detail screen renders right-to-left in Arabic', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          workshopStatusRepositoryProvider.overrideWithValue(repo),
          workshopStatusUserIdProvider.overrideWithValue('me'),
        ],
        child: MaterialApp(
          theme: TpTheme.light,
          locale: const Locale('ar'),
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: WorkshopStatusDetailScreen(record: repo.records.first),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await _scrollTo(tester, WorkshopStatusDetailKeys.parts);
    expect(find.text('حالة قطع الغيار'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
