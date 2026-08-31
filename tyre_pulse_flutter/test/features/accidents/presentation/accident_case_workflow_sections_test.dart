import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_case_workflow_sections.dart';

void main() {
  testWidgets(
    'workshop workflow exposes every route and clearly labels local-only data',
    (WidgetTester tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 844));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: TpTheme.light,
            locale: const Locale('en'),
            supportedLocales: TpLocalizations.supportedLocales,
            localizationsDelegates: TpLocalizations.delegates,
            home: const Scaffold(
              body: SingleChildScrollView(
                padding: EdgeInsets.all(16),
                child: AccidentWorkshopWorkflowSection(
                  snapshot: _externalWorkshopSnapshot,
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Local workflow preview'), findsWidgets);
      expect(
        find.textContaining('Nothing is submitted to Tyre Pulse'),
        findsWidgets,
      );

      for (final String route in <String>[
        'Internal workshop',
        'Authorised dealer',
        'External workshop',
        'On-site repair',
        'Total loss',
      ]) {
        expect(
          find.widgetWithText(ChoiceChip, route),
          findsOneWidget,
          reason: '$route must remain available in the route decision.',
        );
      }
      final ChoiceChip externalRoute = tester.widget<ChoiceChip>(
        find.widgetWithText(ChoiceChip, 'External workshop'),
      );
      expect(externalRoute.selected, isTrue);

      expect(find.text('Vehicle dispatched to workshop'), findsOneWidget);
      expect(
        find.text('External workshop arrival confirmed'),
        findsOneWidget,
      );
      expect(find.text('Vendor quotation received'), findsOneWidget);
      expect(find.text('Purchase order recorded'), findsOneWidget);
      expect(find.text('Repair start confirmed'), findsOneWidget);
      final Finder recordPurchaseOrder =
          find.text('Record purchase order locally');
      expect(recordPurchaseOrder, findsOneWidget);
      expect(find.textContaining('Request quotation'), findsNothing);

      // This control only changes widget-local preview state. No repository is
      // installed in this test, so it cannot write or submit case data.
      await tester.ensureVisible(recordPurchaseOrder);
      await tester.tap(recordPurchaseOrder);
      await tester.pumpAndSettle();
      expect(find.text('Start repair locally after PO'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}

const AccidentCaseSnapshot _externalWorkshopSnapshot = AccidentCaseSnapshot(
  accident: AccidentRecord(
    id: 'acc-workflow-widget',
    referenceNo: 'ACC-2026-0182',
    assetNo: 'Mixer 3208',
    site: 'Diriyah',
    incidentDate: '2026-05-11 08:15',
    damageDescription: 'Rear panel and lamp damage',
    repairType: 'external workshop',
    workshopName: 'Approved Body Repair Centre',
    nextStep: 'Record purchase order',
    repairCost: 18750,
    photos: <String>['tp-storage://accident/photo-1.jpg'],
  ),
  provisioned: true,
  workstreams: <AccidentWorkstream>[
    AccidentWorkstream(
      id: 'assessment',
      key: 'assessment',
      status: 'completed',
      required: true,
      ownerRole: 'Workshop Planner',
    ),
    AccidentWorkstream(
      id: 'repair',
      key: 'repair',
      status: 'waiting_approval',
      required: true,
      ownerRole: 'Procurement Manager',
    ),
    AccidentWorkstream(
      id: 'workshop-qc',
      key: 'workshop_qc',
      status: 'not_started',
      required: true,
      ownerRole: 'Workshop Inspector',
    ),
    AccidentWorkstream(
      id: 'handover',
      key: 'handover',
      status: 'not_started',
      required: true,
      ownerRole: 'Fleet Inspector',
    ),
  ],
);
