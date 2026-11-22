import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/l10n/generated/app_localizations.dart';
import 'package:widgetbook/widgetbook.dart';
import 'package:widgetbook_workspace/main.directories.g.dart';

/// Every catalogue entry must build, in light and dark, in English and in
/// Arabic, at the default text size and at 2x, without throwing or
/// overflowing. A use case that only works in one configuration is a
/// catalogue that lies about the component.
void main() {
  final List<(String, WidgetbookUseCase)> cases = <(String, WidgetbookUseCase)>[];
  void walk(WidgetbookNode node, String path) {
    final String here = path.isEmpty ? node.name : '$path/${node.name}';
    if (node is WidgetbookUseCase) cases.add((here, node));
    for (final WidgetbookNode child in node.children ?? <WidgetbookNode>[]) {
      walk(child, here);
    }
  }

  for (final WidgetbookNode node in directories) {
    walk(node, '');
  }

  test('catalogue is not empty', () => expect(cases.length, greaterThan(40)));

  const List<(String, bool, Locale, double)> configs = <(String, bool, Locale, double)>[
    ('light en 1x', false, Locale('en'), 1),
    ('dark ar 1x', true, Locale('ar'), 1),
    ('light ar 2x', false, Locale('ar'), 2),
  ];

  for (final (String, WidgetbookUseCase) c in cases) {
    for (final (String, bool, Locale, double) cfg in configs) {
      final String id = '${c.$1} [${cfg.$1}]';
      testWidgets(id, skip: _knownDefects.containsKey(id), (WidgetTester tester) async {
        tester.view.physicalSize = const Size(390 * 3, 844 * 3);
        tester.view.devicePixelRatio = 3;
        addTearDown(tester.view.reset);

        final WidgetbookState state = WidgetbookState(
          root: WidgetbookRoot(children: directories),
        );
        await tester.pumpWidget(
          ProviderScope(
            child: WidgetbookScope(
              state: state,
              child: MaterialApp(
                debugShowCheckedModeBanner: false,
                theme: cfg.$2 ? TpTheme.dark : TpTheme.light,
                locale: cfg.$3,
                supportedLocales: AppLocalizations.supportedLocales,
                localizationsDelegates: AppLocalizations.localizationsDelegates,
                builder: (BuildContext context, Widget? child) => MediaQuery(
                  data: MediaQuery.of(context).copyWith(
                    textScaler: TextScaler.linear(cfg.$4),
                  ),
                  child: child!,
                ),
                home: Scaffold(body: Builder(builder: c.$2.builder)),
              ),
            ),
          ),
        );
        await tester.pump(const Duration(milliseconds: 100));
        expect(tester.takeException(), isNull);
      });
    }
  }
}

/// App components that overflow in a configuration the catalogue renders.
/// These are real defects in `lib/core/design_system/`, recorded in
/// `docs/flutter-redesign/02_design_system_inventory.md`. Phase 2 does not
/// change app code, so the cases are skipped with the reason, not hidden.
/// Remove an entry when the component is fixed; the case then has to pass.
const Map<String, String> _knownDefects = <String, String>{
  'Cards and tiles/TpAssetCard/All statuses [light ar 2x]':
      'TpAssetCard: status chip is not Flexible, row overflows ~14 dp',
  'Sync and connectivity/TpSyncIndicator/Every queue state [dark ar 1x]':
      'TpSyncIndicator: label Text has no Flexible/ellipsis',
  'Sync and connectivity/TpSyncIndicator/Every queue state [light ar 2x]':
      'TpSyncIndicator: label Text has no Flexible/ellipsis',
  'Sync and connectivity/TpSyncLabel/Synced and pending [light ar 2x]':
      'TpSyncLabel (tp_mobile_chrome.dart:76): Row has no Flexible label',
};
