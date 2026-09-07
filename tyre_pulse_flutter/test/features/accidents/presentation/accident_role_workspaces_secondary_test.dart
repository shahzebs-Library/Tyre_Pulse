import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_role_workspaces_secondary.dart';
import 'package:tyre_pulse/features/notifications/domain/app_notification.dart';

const snapshot = AccidentCaseSnapshot(
  accident: AccidentRecord(
    id: 'case-1',
    assetNo: 'CP-045',
    site: 'Incident site',
    incidentDate: '2026-09-01',
    workshopName: 'Actual workshop',
    workshopLocation: 'Actual location',
    releaseDate: '2026-09-06',
    repairCost: 1234,
  ),
  provisioned: true,
);

Future<void> pump(
  WidgetTester tester,
  Widget child, {
  String locale = 'en',
}) async {
  tester.view.physicalSize = const Size(320, 760);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: TpTheme.light,
      locale: Locale(locale),
      supportedLocales: TpLocalizations.supportedLocales,
      localizationsDelegates: TpLocalizations.delegates,
      home: Scaffold(body: SingleChildScrollView(child: child)),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  for (final locale in ['en', 'ar', 'ur']) {
    for (final entry in <String, Widget>{
      'assessment':
          const AccidentWorkshopAssessmentWorkspace(snapshot: snapshot),
      'external': const AccidentExternalWorkshopWorkspace(snapshot: snapshot),
      'timeline':
          const AccidentTimelineNotificationsWorkspace(snapshot: snapshot),
    }.entries) {
      testWidgets('${entry.key} remains readable at 320px in $locale',
          (tester) async {
        await pump(tester, entry.value, locale: locale);
        expect(tester.takeException(), isNull);
        expect(find.byType(ExpansionTile), findsNothing);
      });
    }
  }

  testWidgets(
      'assessment exposes estimates, attachments and route without invented values',
      (tester) async {
    await pump(
      tester,
      const AccidentWorkshopAssessmentWorkspace(snapshot: snapshot),
    );
    for (final title in [
      'Safety and mobility',
      'Damage assessment',
      'Labour and parts estimate',
      'Repair route recommendation',
      'Required attachments',
    ]) {
      expect(find.text(title), findsOneWidget);
    }
    expect(find.text('1234'), findsOneWidget);
    expect(
      tester
          .widget<OutlinedButton>(
            find.widgetWithText(OutlinedButton, 'Submit assessment and route'),
          )
          .onPressed,
      isNull,
    );
  });

  testWidgets(
      'external exposes receipt but never treats location or release as signed custody',
      (tester) async {
    await pump(
      tester,
      const AccidentExternalWorkshopWorkspace(snapshot: snapshot),
    );
    for (final title in [
      'Destination and vendor',
      'Dispatch details',
      'Vehicle handover condition',
      'Workshop receipt',
      'Handover milestones',
    ]) {
      expect(find.text(title), findsOneWidget);
    }
    final custody =
        tester.widget<CheckboxListTile>(find.byType(CheckboxListTile));
    expect(custody.value, isNull);
    expect(custody.onChanged, isNull);
    expect(find.text('Actual location'), findsOneWidget);
  });

  testWidgets(
      'timeline retains notifications and owners together with actual dated updates',
      (tester) async {
    final caseData = AccidentCaseSnapshot(
      accident: snapshot.accident,
      provisioned: true,
      workstreams: [
        AccidentWorkstream(
          id: 'assessment',
          key: 'assessment',
          team: 'Actual team',
          notes: 'Actual update',
          updatedAt: DateTime.utc(2026, 9, 3),
        ),
        const AccidentWorkstream(
          id: 'unknown',
          key: 'external_workshop',
          notes: 'Undated update',
        ),
      ],
    );
    await pump(
      tester,
      AccidentTimelineNotificationsWorkspace(
        snapshot: caseData,
        notifications: [
          AppNotification(
            id: 'n1',
            userId: 'u1',
            entityId: 'case-1',
            entityType: 'accident',
            title: 'Actual notice',
            isRead: true,
            createdAt: DateTime.utc(2026, 9, 4),
          ),
          AppNotification(
            id: 'n2',
            userId: 'u1',
            entityId: 'other-case',
            entityType: 'accident',
            title: 'Other case notice',
            isRead: false,
            createdAt: DateTime.utc(2026, 9, 4),
          ),
        ],
      ),
    );
    expect(find.text('Notification log'), findsOneWidget);
    expect(find.text('Participants and ownership'), findsOneWidget);
    expect(find.text('Actual notice'), findsOneWidget);
    expect(find.text('Other case notice'), findsNothing);
    expect(find.textContaining('Actual update'), findsOneWidget);
    expect(find.textContaining('Undated update'), findsNothing);
    expect(find.text('Read'), findsOneWidget);
    expect(find.text('Delivered'), findsNothing);
  });
}
