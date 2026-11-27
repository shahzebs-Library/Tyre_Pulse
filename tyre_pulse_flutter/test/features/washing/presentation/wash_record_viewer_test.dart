import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/features/washing/data/wash_record.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_record_viewer.dart';

void main() {
  WashRecord record() => WashRecord.fromRow(<String, dynamic>{
        'id': '9f1c2d3e-0000-4000-8000-000000000001',
        'asset_no': 'TM514',
        'vehicle_type': 'TR-MIXER',
        'site': 'DIRIYAH-G1',
        'wash_date': '2026-11-27',
        'wash_time': '09:01',
        'wash_type': 'Engine Bay',
        'entry_name': 'Ahmed Saleh',
        'captured_at': '2026-11-27T06:01:30Z',
        'created_at': '2026-11-27T06:02:10Z',
        'photos': <String>['tp-storage://a.jpg', 'tp-storage://b.jpg'],
        'wash_details': <String, dynamic>{
          'version': 1,
          'chemical_status': 'none',
          'chemicals': <dynamic>[],
          'areas': <String>['engine_bay', 'drum_hopper'],
          'views': <String>['left', 'rear'],
          'photo_evidence': <Map<String, Object?>>[
            <String, Object?>{
              'index': 0,
              'stage': 'before',
              'taken_at': '2026-11-27T06:00:00.000Z',
              'lat': 24.713612,
              'lng': 46.675346,
            },
            <String, Object?>{
              'index': 1,
              'stage': 'after',
              'taken_at': '2026-11-27T06:01:00.000Z',
            },
          ],
        },
      });

  testWidgets('shows everything an auditor needs and no edit',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(420, 3000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          privateStorageImageUrlProvider.overrideWith(
            (ref, reference) async => throw StateError('offline'),
          ),
        ],
        child: MaterialApp(
          theme: TpTheme.light,
          locale: const Locale('en'),
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: WashRecordViewer(wash: record()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(WashRecordViewer.readOnlyNote), findsOneWidget);
    expect(
      find.textContaining('cannot be changed on the phone'),
      findsOneWidget,
    );
    expect(find.text('9f1c2d3e-0000-4000-8000-000000000001'), findsOneWidget);
    expect(find.text('TM514 · TR-MIXER'), findsOneWidget);
    expect(find.text('DIRIYAH-G1'), findsOneWidget);
    expect(find.text('Ahmed Saleh'), findsOneWidget);
    expect(find.text('Left, Rear'), findsOneWidget);
    expect(find.text('Engine bay, Mixer drum and hopper'), findsOneWidget);
    expect(find.text('No charge · washed in-house'), findsOneWidget);
    expect(find.textContaining('24.71361, 46.67535'), findsOneWidget);
    expect(find.textContaining('No GPS'), findsOneWidget);
    expect(find.byIcon(Icons.edit_outlined), findsNothing);
    expect(find.byIcon(Icons.edit), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
