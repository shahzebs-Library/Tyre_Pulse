import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/washing/data/wash_record.dart';
import 'package:tyre_pulse/features/washing/data/wash_repository.dart';
import 'package:tyre_pulse/features/washing/presentation/washing_screen.dart';
import 'package:tyre_pulse/features/washing/washing_providers.dart';

final class _WashRepository implements WashRepository {
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

void main() {
  testWidgets('compact wash form reports unavailable workspace on save', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          workspaceContextProvider.overrideWithValue(null),
          washRepositoryProvider.overrideWithValue(_WashRepository()),
        ],
        child: MaterialApp(
          theme: TpTheme.light,
          locale: const Locale('en'),
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: const WashingScreen(route: WashingRoute()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Log vehicle wash'), findsOneWidget);
    final Finder saveButton = find.byWidgetPredicate(
      (Widget widget) => widget is TpButton && widget.label == 'Save Wash',
    );
    await tester.scrollUntilVisible(
      saveButton,
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(saveButton);
    await tester.pump();

    expect(
      find.text('Your workspace is still loading. Try again in a moment.'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}
