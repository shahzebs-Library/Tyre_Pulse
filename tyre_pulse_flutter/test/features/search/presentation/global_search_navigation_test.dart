import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/search/domain/global_search_state.dart';
import 'package:tyre_pulse/features/search/domain/search_result.dart';
import 'package:tyre_pulse/features/search/presentation/global_search_controller.dart';
import 'package:tyre_pulse/features/search/presentation/global_search_navigation.dart';
import 'package:tyre_pulse/features/search/presentation/global_search_screen.dart';

class _ResultsController extends GlobalSearchController {
  @override
  GlobalSearchState build() => const GlobalSearchState(
        query: 'TM514',
        phase: GlobalSearchPhase.results,
        assets: [AssetSearchResult(assetNo: 'TM514')],
      );
}

void main() {
  for (final language in ['en', 'ar']) {
    testWidgets('result and back preserve search, then return home ($language)',
        (tester) async {
      var allowRestore = true;
      final router = GoRouter(
        routes: [
          GoRoute(
            path: '/',
            builder: (context, state) => Scaffold(
              body: TextButton(
                onPressed: () =>
                    openGlobalSearch(context, canRestore: () => allowRestore),
                child: const Text('Open search'),
              ),
            ),
          ),
          GoRoute(
            path: '/vehicles',
            builder: (context, state) => const Scaffold(
              body: Text('Vehicle destination'),
            ),
          ),
        ],
      );
      addTearDown(router.dispose);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            globalSearchControllerProvider.overrideWith(_ResultsController.new),
          ],
          child: MaterialApp.router(
            routerConfig: router,
            locale: Locale(language),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Open search'));
      await tester.pumpAndSettle();
      await tester
          .tap(find.byKey(const ValueKey('globalSearch.result.Asset.TM514')));
      await tester.pumpAndSettle();
      expect(find.text('Vehicle destination'), findsOneWidget);
      router.pop();
      await tester.pumpAndSettle();
      expect(find.byType(GlobalSearchScreen), findsOneWidget);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'TM514',
      );
      final l10n = AppLocalizations.of(
        tester.element(find.byType(GlobalSearchScreen)),
      );
      await tester.tap(find.byTooltip(l10n.actionBack));
      await tester.pumpAndSettle();
      expect(find.text('Open search'), findsOneWidget);
      expect(find.byType(GlobalSearchScreen), findsNothing);
      await tester.tap(find.text('Open search'));
      await tester.pumpAndSettle();
      await tester
          .tap(find.byKey(const ValueKey('globalSearch.result.Asset.TM514')));
      await tester.pumpAndSettle();
      allowRestore = false;
      router.pop();
      await tester.pumpAndSettle();
      expect(find.byType(GlobalSearchScreen), findsNothing);
      expect(find.text('Open search'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}
