import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_remote_repository.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_submission_queue.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_record.dart';
import 'package:tyre_pulse/features/inspections/inspections_providers.dart';
import 'package:tyre_pulse/features/inspections/presentation/inspection_detail_screen.dart';

class _Queue extends Mock implements InspectionSubmissionQueue {}

class _Remote extends Mock implements InspectionRemoteRepository {}

InspectionRecord _record(String id, String asset) => InspectionRecord.fromRow(
      <String, Object?>{
        'tyre_conditions': const <String, Object?>{},
        'id': id,
        'asset_no': asset,
        'vehicle_type': 'TR-MIXER',
        'site': 'NHC',
        'inspection_date': '2026-11-01T09:00:00Z',
        'status': 'Done',
      },
    );

void main() {
  testWidgets(
      'a reused detail State reloads for the NEW id, never the old vehicle',
      (WidgetTester tester) async {
    final _Queue queue = _Queue();
    final _Remote remote = _Remote();
    when(() => queue.byId(any())).thenAnswer((_) async => null);
    when(() => remote.byId('a')).thenAnswer((_) async => _record('a', 'TM100'));
    when(() => remote.byId('b')).thenAnswer((_) async => _record('b', 'TM200'));

    Widget app(String id) => ProviderScope(
          overrides: [
            inspectionSubmissionQueueProvider.overrideWithValue(queue),
            inspectionRemoteRepositoryProvider.overrideWithValue(remote),
          ],
          child: MaterialApp(
            theme: TpTheme.light,
            supportedLocales: TpLocalizations.supportedLocales,
            localizationsDelegates: TpLocalizations.delegates,
            home: InspectionDetailScreen(
              route: InspectionDetailRoute(inspectionId: InspectionId(id)),
            ),
          ),
        );

    // Pumped in steps, not pumpAndSettle: the tyre board animates.
    Future<void> settle() async {
      for (int i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
    }

    await tester.pumpWidget(app('a'));
    await settle();
    expect(find.text('TM100'), findsOneWidget);

    await tester.pumpWidget(app('b'));
    await settle();
    expect(find.text('TM200'), findsOneWidget);
    expect(find.text('TM100'), findsNothing);
    // A synced inspection offers Raise action.
    await tester.scrollUntilVisible(
      find.text('Raise action'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Raise action'), findsOneWidget);
  });
}
