library;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:signature/signature.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/checklists/presentation/widgets/checklist_signature_pad.dart';

void main() {
  testWidgets(
    'a resumed legacy raw SVG signature renders and redraw emits clear first',
    (WidgetTester tester) async {
      final List<ChecklistSignatureCapture?> changes =
          <ChecklistSignatureCapture?>[];
      await tester.pumpWidget(
        MaterialApp(
          theme: TpTheme.light,
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: Scaffold(
            body: ChecklistSignaturePad(
              value: '<svg xmlns="http://www.w3.org/2000/svg" '
                  'viewBox="0 0 120 50"><path d="M5 25 L115 25" '
                  'stroke="#0f172a" fill="none"/></svg>',
              onChanged: changes.add,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(SvgPicture), findsOneWidget);
      expect(tester.takeException(), isNull);

      expect(find.byType(TpButton), findsOneWidget);
      await tester.tap(find.byType(TpButton));
      await tester.pump();

      expect(changes, <ChecklistSignatureCapture?>[null]);
      expect(find.byType(SvgPicture), findsNothing);
      expect(find.byType(Signature), findsOneWidget);
    },
  );
}
