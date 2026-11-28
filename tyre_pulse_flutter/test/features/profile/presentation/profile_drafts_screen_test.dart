import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/profile/presentation/profile_drafts_screen.dart';
import 'package:tyre_pulse/features/profile/profile_providers.dart';

final ProfileDraftEntry _checklist = ProfileDraftEntry(
  kind: ProfileDraftKind.checklist,
  draftKey: 'user-1|tpl-1|TM514',
  assetNo: 'TM514',
  filled: 3,
  total: 10,
  updatedAt: DateTime.utc(2026, 11, 20, 9),
  templateId: 'tpl-1',
  templateName: 'Workshop Daily Checklist',
  site: 'NHC',
);

final ProfileDraftEntry _inspection = ProfileDraftEntry(
  kind: ProfileDraftKind.inspection,
  draftKey: 'user-1|MP081',
  assetNo: 'MP081',
  filled: 4,
  total: 14,
  updatedAt: DateTime.utc(2026, 11, 19, 9),
  site: 'DIRIYAH',
  vehicleType: 'PUMPS',
);

final class _Harness {
  final List<ProfileDraftEntry> discarded = <ProfileDraftEntry>[];
}

Future<_Harness> _pump(
  WidgetTester tester, {
  Future<List<ProfileDraftEntry>> Function()? load,
}) async {
  final _Harness harness = _Harness();
  final GoRouter router = GoRouter(
    routes: <RouteBase>[
      GoRoute(
        path: '/',
        builder: (BuildContext _, GoRouterState __) =>
            const ProfileDraftsScreen(),
      ),
    ],
    errorBuilder: (BuildContext _, GoRouterState state) =>
        Scaffold(body: Text('opened ${state.uri}')),
  );
  addTearDown(router.dispose);
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        profileDraftEntriesProvider.overrideWith(
          (Ref ref) =>
              load?.call() ??
              Future<List<ProfileDraftEntry>>.value(
                <ProfileDraftEntry>[_checklist, _inspection],
              ),
        ),
        profileDraftDiscardProvider.overrideWithValue(
          (ProfileDraftEntry entry) async => harness.discarded.add(entry),
        ),
      ],
      child: MaterialApp.router(
        theme: TpTheme.light,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        routerConfig: router,
      ),
    ),
  );
  await tester.pumpAndSettle();
  return harness;
}

void main() {
  testWidgets('lists checklist and inspection drafts', (tester) async {
    await _pump(tester);
    expect(find.text('Workshop Daily Checklist'), findsOneWidget);
    expect(find.text('MP081'), findsOneWidget);
    expect(find.textContaining('3 of 10 checked'), findsOneWidget);
    expect(find.textContaining('Last edited'), findsNWidgets(2));
  });

  testWidgets('empty shows the no-drafts state', (tester) async {
    await _pump(
      tester,
      load: () async => const <ProfileDraftEntry>[],
    );
    expect(find.byKey(ProfileDraftsScreenKeys.empty), findsOneWidget);
    expect(find.text('No drafts'), findsOneWidget);
  });

  testWidgets('a read failure shows an error with retry', (tester) async {
    await _pump(tester, load: () async => throw StateError('db'));
    expect(find.byKey(ProfileDraftsScreenKeys.error), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
  });

  testWidgets('Resume opens the checklist fill route with its draft key', (
    tester,
  ) async {
    await _pump(tester);
    await tester.tap(
      find.byKey(ProfileDraftsScreenKeys.resume(_checklist.draftKey)),
    );
    await tester.pumpAndSettle();
    expect(
      find.text('opened ${profileDraftResumeLocation(_checklist)}'),
      findsOneWidget,
    );
  });

  testWidgets('Resume opens the inspection wizard for the asset', (
    tester,
  ) async {
    await _pump(tester);
    await tester.tap(
      find.byKey(ProfileDraftsScreenKeys.resume(_inspection.draftKey)),
    );
    await tester.pumpAndSettle();
    expect(
      find.text('opened ${profileDraftResumeLocation(_inspection)}'),
      findsOneWidget,
    );
  });

  testWidgets('Discard asks first and cancel keeps the draft', (tester) async {
    final _Harness h = await _pump(tester);
    await tester.tap(
      find.byKey(ProfileDraftsScreenKeys.discard(_checklist.draftKey)),
    );
    await tester.pumpAndSettle();
    expect(find.text('Discard this draft?'), findsOneWidget);
    await tester.tap(find.byKey(ProfileDraftsScreenKeys.cancelDiscard));
    await tester.pumpAndSettle();
    expect(h.discarded, isEmpty);
  });

  testWidgets('Discard confirmed removes the draft', (tester) async {
    final _Harness h = await _pump(tester);
    await tester.tap(
      find.byKey(ProfileDraftsScreenKeys.discard(_inspection.draftKey)),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(ProfileDraftsScreenKeys.confirmDiscard));
    await tester.pumpAndSettle();
    expect(h.discarded, <ProfileDraftEntry>[_inspection]);
    expect(find.text('Draft discarded.'), findsOneWidget);
  });

  test('resume locations reuse the existing routes', () {
    expect(
      profileDraftResumeLocation(_checklist),
      const ChecklistFillRoute(
        templateId: TemplateId('tpl-1'),
        assetNo: AssetNo('TM514'),
        draftKey: DraftKey('user-1|tpl-1|TM514'),
      ).location,
    );
    expect(
      profileDraftResumeLocation(_inspection),
      const NewInspectionRoute(
        assetNo: AssetNo('MP081'),
        siteName: SiteName('DIRIYAH'),
      ).location,
    );
  });
}
