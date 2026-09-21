import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/washing/data/wash_record.dart';
import 'package:tyre_pulse/features/washing/domain/wash_details.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_details_form.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_record_viewer.dart';

void main() {
  test('new checklist is unanswered and issues require a comment', () {
    final details = emptyWashDetails();
    expect(
      detailItems(details, 'checklist')
          .every((c) => c['result'] == 'not_checked'),
      isTrue,
    );
    expect(validWashDetails(details), isTrue);
    details['chemical_status'] = 'used';
    expect(validWashDetails(details), isFalse);
    details['chemicals'] = <Map<String, dynamic>>[
      {'name': 'Actual product'},
    ];
    expect(validWashDetails(details), isTrue);
    details['checklist'] = <Map<String, dynamic>>[
      {'label': 'Cab', 'result': 'fail', 'note': ''},
    ];
    expect(validWashDetails(details), isFalse);
  });
  test('decodes entry person separately from the wash operator', () {
    final wash = WashRecord.fromRow({
      'id': 'wash',
      'asset_no': 'TEST',
      'created_by': 'creator',
      'entry_name': 'Recorder',
      'washed_by': 'Operator',
      'wash_details': emptyWashDetails(),
    });
    expect(wash.createdBy, 'creator');
    expect(wash.entryName, 'Recorder');
    expect(wash.washedBy, 'Operator');
    expect(wash.washDetails?['chemical_status'], 'not_recorded');
  });
  for (final lang in ['en', 'ar', 'ur']) {
    testWidgets('compact $lang evidence form expands without overflow',
        (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      var value = emptyWashDetails();
      await tester.pumpWidget(
        MaterialApp(
          theme: TpTheme.light,
          locale: Locale(lang),
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: Scaffold(
            body: SingleChildScrollView(
              child: StatefulBuilder(
                builder: (context, setState) => WashDetailsForm(
                  value: value,
                  onChanged: (v) => setState(() => value = v),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(DropdownButtonFormField<String>), findsNothing);
      await tester.tap(find.byType(ExpansionTile));
      await tester.pumpAndSettle();
      expect(find.byType(DropdownButtonFormField<String>), findsNWidgets(6));
      expect(tester.takeException(), isNull);
    });
  }
  testWidgets('viewer shows the recorded checklist and chemicals',
      (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          theme: TpTheme.light,
          locale: const Locale('en'),
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: WashRecordViewer(
            wash: WashRecord.fromRow({
              'id': 'w',
              'asset_no': 'TEST',
              'entry_name': 'Recorder',
              'wash_details': {
                'chemical_status': 'used',
                'chemicals': [
                  {'name': 'Actual product'},
                ],
                'checklist': [
                  {
                    'label': 'Cab interior',
                    'result': 'fail',
                    'note': 'Dust remains',
                  }
                ],
              },
            }),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Recorder'), findsOneWidget);
    expect(find.text('Actual product'), findsOneWidget);
    expect(find.textContaining('Dust remains'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
