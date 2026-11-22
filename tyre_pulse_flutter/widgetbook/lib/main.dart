import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/l10n/generated/app_localizations.dart';
import 'package:widgetbook/widgetbook.dart';
import 'package:widgetbook_annotation/widgetbook_annotation.dart' as widgetbook;

import 'main.directories.g.dart';

void main() {
  runApp(const ProviderScope(child: WidgetbookApp()));
}

/// Catalogue of Tyre Pulse field-app components, each in the states that
/// are hard to reach in the running app (no readings, critical tyres, a
/// failed load, Arabic, dark mode, small phones, large text).
@widgetbook.App()
class WidgetbookApp extends StatelessWidget {
  const WidgetbookApp({super.key});

  @override
  Widget build(BuildContext context) {
    return Widgetbook.material(
      directories: directories,
      addons: <WidgetbookAddon>[
        ViewportAddon(<ViewportData>[
          Viewports.none,
          IosViewports.iPhone13,
          IosViewports.iPhoneSE,
          AndroidViewports.samsungGalaxyS20,
        ]),
        MaterialThemeAddon(
          themes: <WidgetbookTheme<ThemeData>>[
            WidgetbookTheme<ThemeData>(name: 'Light', data: TpTheme.light),
            WidgetbookTheme<ThemeData>(name: 'Dark', data: TpTheme.dark),
          ],
        ),
        LocalizationAddon(
          locales: AppLocalizations.supportedLocales,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
        ),
        TextScaleAddon(),
      ],
    );
  }
}
