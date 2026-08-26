/// The tyre detail sheet, field by field.
///
/// The sheet takes a [TyreRecord] the caller already has rather than an id
/// - see the library comment on `tyre_detail_sheet.dart`. So every test here
/// opens the sheet directly from a record it constructs, with no repository
/// or network layer involved at all.
///
/// The two rules worth proving explicitly, because both are places a display
/// bug would be silent rather than a crash: a field with nothing recorded
/// renders no row at all (never a label beside a blank), and a monetary
/// figure is never shown without its resolved currency.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_record.dart';
import 'package:tyre_pulse/features/records/presentation/tyre_detail_sheet.dart';

import '../records_test_support.dart';

Future<void> _openSheet(
  WidgetTester tester, {
  required TyreRecord record,
  String? currency,
}) async {
  final overrides = [
    if (currency != null) activeCurrencyProvider.overrideWithValue(currency),
  ];
  final ProviderContainer container = ProviderContainer(overrides: overrides);
  addTearDown(container.dispose);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: Scaffold(
          body: Builder(
            builder: (BuildContext context) => ElevatedButton(
              onPressed: () => showTyreDetailSheet(context, record),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  );

  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

void main() {
  group('header', () {
    testWidgets('shows the asset number as the title', (
      WidgetTester tester,
    ) async {
      await _openSheet(
        tester,
        record: buildTyreRecord(id: '1', assetNo: 'TM514'),
      );
      expect(find.text('TM514'), findsOneWidget);
    });

    testWidgets(
        'falls back to a generic title when the asset number is not '
        'recorded', (WidgetTester tester) async {
      await _openSheet(tester, record: buildTyreRecord(id: '1', assetNo: null));
      expect(find.text('Tyre record'), findsOneWidget);
    });

    testWidgets('shows the brand only when it is recorded', (
      WidgetTester tester,
    ) async {
      await _openSheet(
        tester,
        record: buildTyreRecord(id: '1', brand: 'Bridgestone'),
      );
      expect(find.text('Bridgestone'), findsOneWidget);
    });

    testWidgets('shows no brand line when brand is not recorded', (
      WidgetTester tester,
    ) async {
      await _openSheet(tester, record: buildTyreRecord(id: '1', brand: null));
      expect(find.text('Bridgestone'), findsNothing);
    });
  });

  group('risk chip', () {
    testWidgets(
      'renders a status chip carrying the raw risk label when the tyre '
      'has been risk-scored',
      (WidgetTester tester) async {
        await _openSheet(
          tester,
          record: buildTyreRecord(id: '1', riskLevel: 'Critical'),
        );
        expect(find.byType(TpStatusChip), findsOneWidget);
        expect(find.text('Critical'), findsOneWidget);
      },
    );

    testWidgets('renders no risk chip when the tyre has never been scored', (
      WidgetTester tester,
    ) async {
      await _openSheet(
        tester,
        record: buildTyreRecord(id: '1', riskLevel: null),
      );
      expect(find.byType(TpStatusChip), findsNothing);
    });
  });

  group('position chip', () {
    testWidgets('renders when a canonical position is recorded', (
      WidgetTester tester,
    ) async {
      await _openSheet(
        tester,
        record: buildTyreRecord(id: '1', tyrePosition: 'LHF1'),
      );
      expect(find.byType(TpTyreChip), findsOneWidget);
    });

    testWidgets(
        'is absent when neither the canonical nor the legacy position '
        'column is recorded', (WidgetTester tester) async {
      await _openSheet(
        tester,
        record: buildTyreRecord(id: '1', tyrePosition: null),
      );
      expect(find.byType(TpTyreChip), findsNothing);
    });
  });

  group('a row with nothing to say is not shown at all', () {
    testWidgets('a recorded serial renders its value', (
      WidgetTester tester,
    ) async {
      await _openSheet(
        tester,
        record: buildTyreRecord(id: '1', serialNo: 'SN-001'),
      );
      expect(find.text('SN-001'), findsOneWidget);
    });

    testWidgets('an unrecorded serial renders nothing for that row', (
      WidgetTester tester,
    ) async {
      await _openSheet(
        tester,
        record: buildTyreRecord(id: '1', serialNo: null),
      );
      expect(find.text('SN-001'), findsNothing);
    });

    testWidgets('a description block renders its full text when recorded', (
      WidgetTester tester,
    ) async {
      await _openSheet(
        tester,
        record: buildTyreRecord(id: '1', description: 'Rotated at 40000 km'),
      );
      expect(find.text('Rotated at 40000 km'), findsOneWidget);
    });

    testWidgets(
      'a blank-only description is treated as unrecorded, matching the '
      'block-level rule the production DetailRow also applies',
      (WidgetTester tester) async {
        await _openSheet(
          tester,
          record: buildTyreRecord(id: '1', description: '   '),
        );
        expect(find.text('   '), findsNothing);
      },
    );

    testWidgets('remarks render only when recorded', (
      WidgetTester tester,
    ) async {
      await _openSheet(
        tester,
        record: buildTyreRecord(
          id: '1',
          remarks: 'Vendor warranty claim filed',
        ),
      );
      expect(find.text('Vendor warranty claim filed'), findsOneWidget);
    });
  });

  group('cost - never shown without its currency', () {
    testWidgets(
      'a priced tyre with no resolved currency shows no cost line at all',
      (WidgetTester tester) async {
        await _openSheet(
          tester,
          record: buildTyreRecord(id: '1', costPerTyre: 12345),
        );
        expect(find.textContaining('12,345'), findsNothing);
      },
    );

    testWidgets(
      'a priced tyre with a resolved currency shows the formatted amount',
      (WidgetTester tester) async {
        await _openSheet(
          tester,
          record: buildTyreRecord(id: '1', costPerTyre: 12345),
          currency: 'SAR',
        );
        expect(find.text('SAR 12,345'), findsOneWidget);
      },
    );

    testWidgets(
      'a resolved currency with no recorded price still shows no cost '
      'line - a currency alone is not a price',
      (WidgetTester tester) async {
        await _openSheet(
          tester,
          record: buildTyreRecord(id: '1', costPerTyre: null),
          currency: 'SAR',
        );
        expect(find.textContaining('SAR'), findsNothing);
      },
    );
  });

  group('tyre life', () {
    testWidgets(
        'renders the computed distance when removal is genuinely after '
        'fitment', (WidgetTester tester) async {
      await _openSheet(
        tester,
        record: buildTyreRecord(id: '1', kmAtFitment: 1000, kmAtRemoval: 41000),
      );
      expect(find.text('40,000'), findsOneWidget);
    });

    testWidgets(
      'shows nothing when the readings are reversed - a reversed pair is '
      'not a measured life',
      (WidgetTester tester) async {
        await _openSheet(
          tester,
          record: buildTyreRecord(
            id: '1',
            kmAtFitment: 41000,
            kmAtRemoval: 1000,
          ),
        );
        expect(find.text('40,000'), findsNothing);
      },
    );
  });

  group('close', () {
    testWidgets('dismisses the sheet', (WidgetTester tester) async {
      await _openSheet(
        tester,
        record: buildTyreRecord(id: '1', assetNo: 'TM514'),
      );
      expect(find.byType(TyreDetailSheet), findsOneWidget);

      await tester.tap(find.text('Close'));
      await tester.pumpAndSettle();

      expect(find.byType(TyreDetailSheet), findsNothing);
    });
  });
}
