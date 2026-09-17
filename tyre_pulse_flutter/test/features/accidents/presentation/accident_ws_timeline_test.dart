import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show PostgrestException;
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/accidents/data/accident_sla_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_timeline_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_timeline.dart';

WorkspaceContext _workspace(RoleId role) => WorkspaceContext(
      userId: 'user-1',
      role: UserRole.known(role),
      effectivePermissions: AccessState(role: UserRole.known(role)),
      countryScope: CountryScope.none,
      siteScope: SiteScope.none,
      activeCountry: 'KSA',
      fullName: 'Signed-in officer',
    );

final DateTime _now = DateTime(2026, 9, 16, 15, 8);

final AccidentCaseSnapshot _snapshot = AccidentCaseSnapshot(
  accident: AccidentRecord(
    id: 'case-1',
    assetNo: 'CP-045',
    site: 'Incident yard',
    incidentDate: '2026-09-12',
    referenceNo: 'ACC-2026-0148',
    reporterName: 'Recorded reporter',
    createdAt: DateTime(2026, 9, 12, 9, 8),
  ),
  provisioned: true,
  workstreams: const <AccidentWorkstream>[
    AccidentWorkstream(
      id: 'h',
      key: 'handover',
      status: 'in_progress',
      team: 'External workshop',
    ),
  ],
);

class FakeTimelineRemote implements AccidentTimelineRemote {
  FakeTimelineRemote({
    this.communicationsMissing = false,
    this.evidenceMissing = false,
  });

  final bool communicationsMissing;
  final bool evidenceMissing;
  final List<Map<String, Object?>> inserted = <Map<String, Object?>>[];

  static PostgrestException _missing(String table) => PostgrestException(
        message: 'relation "public.$table" does not exist',
        code: '42P01',
      );

  @override
  Future<List<Map<String, Object?>>> communications(String accidentId) async {
    if (communicationsMissing) throw _missing('accident_case_communications');
    return <Map<String, Object?>>[
      <String, Object?>{
        'id': 'c1',
        'channel': 'email_out',
        'direction': 'outbound',
        'subject': 'Claim package sent',
        'to_party': 'Insurance, Fleet',
        'occurred_at': DateTime(2026, 9, 13, 8).toIso8601String(),
      },
      <String, Object?>{
        'id': 'c2',
        'channel': 'comment',
        'direction': 'internal',
        'body': 'Called the vendor',
        'author_name': 'Recorded author',
        'occurred_at': DateTime(2026, 9, 14, 8).toIso8601String(),
      },
    ];
  }

  @override
  Future<List<Map<String, Object?>>> evidence(String accidentId) async {
    if (evidenceMissing) throw _missing('accident_evidence');
    return <Map<String, Object?>>[
      <String, Object?>{
        'id': 'e1',
        'kind': 'photo',
        'workstream_key': 'incident_evidence',
        'verification_status': 'verified',
        'uploaded_at': DateTime(2026, 9, 12, 9, 30).toIso8601String(),
      },
      <String, Object?>{
        'id': 'e2',
        'kind': 'photo',
        'workstream_key': 'incident_evidence',
        'verification_status': 'unverified',
        'uploaded_at': DateTime(2026, 9, 12, 9, 31).toIso8601String(),
      },
    ];
  }

  @override
  Future<List<Map<String, Object?>>> slaInstances(String accidentId) async =>
      <Map<String, Object?>>[
        <String, Object?>{
          'id': 's1',
          'state': 'running',
          'name': 'Vendor receipt',
          'workstream_key': 'handover',
          'team': 'External workshop',
          'start_at': DateTime(2026, 9, 16, 14).toIso8601String(),
          'due_at': _now.add(const Duration(minutes: 52)).toIso8601String(),
          'warning_at':
              _now.add(const Duration(minutes: 30)).toIso8601String(),
        },
      ];

  @override
  Future<Map<String, Object?>?> latestDispatch(String accidentId) async =>
      <String, Object?>{
        'id': 'd1',
        'accident_id': accidentId,
        'live_status': 'in_transit',
        'departure_at': DateTime(2026, 9, 16, 14).toIso8601String(),
        'destination': 'Recorded workshop',
        'custody_accepted': false,
      };

  @override
  Future<Map<String, Object?>?> accidentPosition(String accidentId) async =>
      <String, Object?>{'latitude': 24.71, 'longitude': 46.67};

  @override
  Future<Map<String, Object?>> insertCommunication(
    Map<String, Object?> row,
  ) async {
    inserted.add(row);
    return <String, Object?>{'id': 'new-${inserted.length}', ...row};
  }

  @override
  String? currentUserId() => 'user-1';
}

Future<void> _pump(
  WidgetTester tester,
  FakeTimelineRemote remote, {
  RoleId role = RoleId.admin,
  Locale locale = const Locale('en'),
}) async {
  tester.view.physicalSize = const Size(400, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        workspaceContextProvider.overrideWithValue(_workspace(role)),
        accidentSlaLoadProvider.overrideWith(
          (Ref ref, String id) async =>
              const AccidentSlaLoad(provisioned: true),
        ),
        accidentTimelineRepositoryProvider.overrideWithValue(
          AccidentTimelineRepository(remote, clock: () => _now),
        ),
      ],
      child: MaterialApp(
        theme: TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: Scaffold(
          body: SingleChildScrollView(
            child: AccidentTimelineMockWorkspace(
              snapshot: _snapshot,
              onNavigate: (_) {},
              clock: () => _now,
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('renders the M1 chips, filter chips and the merged feed',
      (WidgetTester tester) async {
    await _pump(tester, FakeTimelineRemote());
    expect(tester.takeException(), isNull);
    expect(find.text('Case timeline & notifications'), findsOneWidget);
    expect(find.textContaining('ACC-2026-0148'), findsWidgets);

    // Chips.
    expect(find.text('4d 6h'), findsOneWidget);
    expect(find.text('External workshop'), findsWidgets);
    expect(find.text('Vendor receipt'), findsOneWidget);
    expect(find.text('52m'), findsOneWidget);

    // Filters and rows.
    for (final String chip in <String>[
      'All',
      'Actions',
      'Documents',
      'SLA',
      'Emails',
    ]) {
      expect(find.widgetWithText(ChoiceChip, chip), findsOneWidget);
    }
    expect(find.text('Vehicle dispatched to workshop'), findsOneWidget);
    expect(find.text('Transit timer running'), findsOneWidget);
    expect(find.text('Vendor SLA not started'), findsOneWidget);
    expect(find.text('In transit'), findsOneWidget);
    expect(find.text('Accident reported'), findsOneWidget);
    expect(find.text('by Recorded reporter'), findsOneWidget);
    expect(find.text('GPS 24.71000, 46.67000'), findsOneWidget);
    expect(find.text('Verified 1/2'), findsOneWidget);
    expect(find.text('Sent'), findsOneWidget);
    expect(find.textContaining('Delivered'), findsNothing);

    await tester.tap(find.byKey(const Key('accident.timeline.filter.emails')));
    await tester.pumpAndSettle();
    expect(find.text('Claim package sent'), findsOneWidget);
    expect(find.text('Accident reported'), findsNothing);
  });

  testWidgets('notifications tab shows the honest delivery log and gates '
      'recipient management to Admin', (WidgetTester tester) async {
    await _pump(tester, FakeTimelineRemote(), role: RoleId.manager);
    await tester.tap(find.text('Notifications'));
    await tester.pumpAndSettle();
    expect(find.text('Notification delivery log'), findsOneWidget);
    expect(find.text('Trigger'), findsOneWidget);
    expect(find.text('Scheduled in 30m'), findsOneWidget);
    expect(find.text('Sent'), findsOneWidget);
    expect(find.text('Email + in-app'), findsOneWidget);
    expect(find.textContaining('Delivered'), findsNothing);
    expect(find.text('View all notifications'), findsOneWidget);
    final OutlinedButton manage = tester.widget<OutlinedButton>(
      find.byKey(const Key('accident.timeline.manageRecipients')),
    );
    expect(manage.onPressed, isNull);
    expect(
      find.text('Recipients are set by Admin per event and role.'),
      findsOneWidget,
    );
  });

  testWidgets('an Admin can open recipient groups; participants list roles',
      (WidgetTester tester) async {
    await _pump(tester, FakeTimelineRemote());
    await tester.tap(find.text('Notifications'));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<OutlinedButton>(
            find.byKey(const Key('accident.timeline.manageRecipients')),
          )
          .onPressed,
      isNotNull,
    );
    await tester.tap(find.text('Participants'));
    await tester.pumpAndSettle();
    expect(find.text('Participants and ownership'), findsOneWidget);
    expect(find.text('Insurance: Insurance Officer'), findsOneWidget);
    expect(find.textContaining('External workshop'), findsWidgets);
  });

  testWidgets('a missing ledger is named, never rendered as empty',
      (WidgetTester tester) async {
    await _pump(tester, FakeTimelineRemote(evidenceMissing: true));
    expect(
      find.textContaining('Evidence: not provisioned yet'),
      findsOneWidget,
    );
    expect(find.text('Verified 1/2'), findsNothing);
    expect(find.text('Accident reported'), findsOneWidget);
  });

  testWidgets('Add timeline note writes an internal comment',
      (WidgetTester tester) async {
    final FakeTimelineRemote remote = FakeTimelineRemote();
    await _pump(tester, remote);
    await tester.ensureVisible(find.text('Add timeline note'));
    await tester.tap(find.text('Add timeline note'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, 'Vendor called back');
    await tester.tap(find.text('Save note'));
    await tester.pumpAndSettle();
    expect(remote.inserted.single['channel'], 'comment');
    expect(remote.inserted.single['direction'], 'internal');
    expect(remote.inserted.single['body'], 'Vendor called back');
    expect(remote.inserted.single['author_id'], 'user-1');
  });

  testWidgets('stays readable in Arabic and Urdu',
      (WidgetTester tester) async {
    for (final String locale in <String>['ar', 'ur']) {
      await _pump(tester, FakeTimelineRemote(), locale: Locale(locale));
      expect(tester.takeException(), isNull);
      expect(find.text('4d 6h'), findsOneWidget);
    }
  });
}
