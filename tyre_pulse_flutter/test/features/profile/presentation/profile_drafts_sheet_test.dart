import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/profile/presentation/profile_drafts_screen.dart';
import 'package:tyre_pulse/features/profile/presentation/profile_drafts_sheet.dart';
import 'package:tyre_pulse/features/profile/profile_providers.dart';

ProfileDraftEntry _inspection(String asset, int day) => ProfileDraftEntry(
      kind: ProfileDraftKind.inspection,
      draftKey: 'user-1|$asset',
      assetNo: asset,
      filled: 4,
      total: 14,
      updatedAt: DateTime.utc(2026, 11, day, 9),
    );

Future<void> _pump(
  WidgetTester tester, {
  required List<ProfileDraftEntry> drafts,
}) async {
  final GoRouter router = GoRouter(
    routes: <RouteBase>[
      GoRoute(
        path: '/',
        builder: (BuildContext _, GoRouterState __) => Consumer(
          builder: (BuildContext context, WidgetRef ref, Widget? _) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () => openProfileDraftsQuick(context, ref),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    ],
    errorBuilder: (BuildContext _, GoRouterState state) =>
        Scaffold(body: Text('opened ${state.uri}')),
  );
  addTearDown(router.dispose);
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        profileDraftEntriesProvider.overrideWith((Ref ref) async => drafts),
        profileDraftDiscardProvider.overrideWithValue(
          (ProfileDraftEntry entry) async {},
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
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('no drafts: a short message, nothing opens', (tester) async {
    await _pump(tester, drafts: const <ProfileDraftEntry>[]);
    expect(find.byType(ProfileDraftsSheet), findsNothing);
    expect(find.byType(ProfileDraftsScreen), findsNothing);
    expect(find.text('No drafts'), findsOneWidget);
  });

  testWidgets('lists at most 3 drafts and offers See all', (tester) async {
    await _pump(
      tester,
      drafts: <ProfileDraftEntry>[
        for (int i = 0; i < 5; i++) _inspection('TM50$i', 20 - i),
      ],
    );
    expect(find.byType(ProfileDraftsSheet), findsOneWidget);
    expect(find.byKey(ProfileDraftsSheetKeys.item('user-1|TM500')), findsOne);
    expect(find.byKey(ProfileDraftsSheetKeys.item('user-1|TM502')), findsOne);
    expect(
      find.byKey(ProfileDraftsSheetKeys.item('user-1|TM503')),
      findsNothing,
    );
    expect(find.text('See all (5)'), findsOneWidget);

    await tester.tap(find.byKey(ProfileDraftsSheetKeys.seeAll));
    await tester.pumpAndSettle();
    expect(find.byType(ProfileDraftsSheet), findsNothing);
    expect(find.byType(ProfileDraftsScreen), findsOneWidget);
  });

  testWidgets('no See all when every draft fits', (tester) async {
    await _pump(tester, drafts: <ProfileDraftEntry>[_inspection('TM500', 20)]);
    expect(find.byKey(ProfileDraftsSheetKeys.seeAll), findsNothing);
  });

  testWidgets('Resume closes the sheet and opens the draft', (tester) async {
    final ProfileDraftEntry draft = _inspection('MP081', 19);
    await _pump(tester, drafts: <ProfileDraftEntry>[draft]);
    await tester.tap(find.byKey(ProfileDraftsSheetKeys.resume(draft.draftKey)));
    await tester.pumpAndSettle();
    expect(find.byType(ProfileDraftsSheet), findsNothing);
    expect(
      find.text('opened ${profileDraftResumeLocation(draft)}'),
      findsOneWidget,
    );
  });
}
