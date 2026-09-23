import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/accidents/data/accident_claim_repository.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_claims_screen.dart';

void main() {
  testWidgets(
      'validates required fields and blocks repeat writes after uncertain response',
      (tester) async {
    var calls = 0;
    final repo =
        AccidentClaimRepository((id) async => null, (name, params) async {
      calls++;
      throw const SocketException('connection dropped');
    });
    await tester.pumpWidget(
      ProviderScope(
        overrides: [accidentClaimRepositoryProvider.overrideWithValue(repo)],
        child: const MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: AccidentClaimRegistrationForm(accidentId: 'case'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final save = find.byKey(const Key('accident.claim.save'));
    await tester.tap(save);
    await tester.pumpAndSettle();
    expect(find.text('Required'), findsNWidgets(4));
    expect(calls, 0);
    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), 'Insurer');
    await tester.enterText(fields.at(1), 'P1');
    await tester.enterText(fields.at(2), 'C1');
    await tester.enterText(fields.at(3), '100');
    await tester.ensureVisible(save);
    await tester.tap(save);
    await tester.pumpAndSettle();
    expect(calls, 1);
    expect(find.textContaining('Saving was not confirmed'), findsOneWidget);
    expect(tester.widget<FilledButton>(save).onPressed, isNull);
    expect(find.text('Insurer'), findsWidgets);
    await tester.tap(save);
    await tester.pump();
    expect(calls, 1);
  });
}
