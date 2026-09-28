import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/driver_workspace/data/driver_workspace_dto.dart';
import 'package:tyre_pulse/features/driver_workspace/domain/driver_workspace.dart';
import 'package:tyre_pulse/features/driver_workspace/presentation/driver_workspace_l10n.dart';
import 'package:tyre_pulse/features/driver_workspace/presentation/driver_workspace_panel.dart';

void main() {
  test('offline snapshots cannot enable any mutation', () {
    final DriverWorkspaceSnapshot data =
        DriverWorkspaceDto.fromJson(<String, Object?>{
      'can_respond': true,
      'can_review': true,
      'can_manage': true,
    }).toDomain(offline: true);
    expect(data.canRespond, false);
    expect(data.canReview, false);
    expect(data.canManage, false);
  });
  test('payment and recovery choices require signed driver input', () {
    final DriverRow values = <String, Object?>{
      'explanation': 'Please review this request',
      'signature': 'signed',
      'acknowledged': true,
    };
    expect(
      validateDriverFineResponse(
        <String, Object?>{...values, 'resolution': 'instalments'},
      ),
      isNull,
    );
    expect(
      validateDriverFineResponse(
        <String, Object?>{...values, 'resolution': 'company_recovery'},
      ),
      isNull,
    );
    expect(
      validateDriverFineResponse(
        <String, Object?>{...values, 'resolution': 'already_paid'},
      ),
      DriverFineResponseIssue.paymentReference,
    );
    expect(
      validateDriverFineResponse(
        <String, Object?>{...values, 'resolution': 'direct_payment'},
      ),
      DriverFineResponseIssue.proposedDate,
    );
    expect(
      validateDriverFineResponse(<String, Object?>{
        ...values,
        'resolution': 'dispute',
        'acknowledged': false,
      }),
      DriverFineResponseIssue.signature,
    );
  });
  test('invalid backend payloads do not fabricate a workspace', () {
    expect(() => DriverWorkspaceDto.fromJson(null), throwsFormatException);
  });
  testWidgets('driver sees response action but no staff review control',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: Scaffold(
            body: SingleChildScrollView(
              child: DriverFineCard(
                fine: const <String, Object?>{
                  'id': 'fine',
                  'notice_reference': 'N1',
                  'amount': 500,
                  'currency': 'SAR',
                  'status': 'open',
                  'response_status': 'awaiting_response',
                  'paid_amount': 0,
                  'evidence': <DriverRow>[],
                  'responses': <DriverRow>[],
                },
                data: const DriverWorkspaceSnapshot(
                  data: <String, Object?>{'can_respond': true},
                ),
                onAction: (String action, [DriverRow? fine]) async {},
                onChanged: () async {},
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('N1 · 500 SAR'));
    await tester.pumpAndSettle();
    expect(find.text('Acknowledge and respond'), findsOneWidget);
    expect(find.text('Review / record payment'), findsNothing);
  });

  test('missing linked records return null so the UI localizes them', () {
    expect(driverRecordLabel(null), isNull);
    expect(
      driverRecordLabel(const <String, Object?>{
        'title': 'Brake check',
        'asset_no': 'TM514',
      }),
      'Brake check · TM514',
    );
  });

  Future<AppLocalizations> load(String code) =>
      AppLocalizations.delegate.load(Locale(code));

  test('server tokens resolve through the ARB catalogs in every language',
      () async {
    final AppLocalizations en = await load('en');
    final AppLocalizations ar = await load('ar');
    final AppLocalizations ur = await load('ur');
    expect(driverWsTermLabel(en, 'awaiting_response'), 'Awaiting response');
    expect(driverWsTermLabel(ar, 'awaiting_response'), 'بانتظار الرد');
    expect(driverWsTermLabel(ur, 'respond_fine'), 'جائزہ لیں اور دستخط کریں');
    expect(driverWsRecordFieldLabel(en, 'serial_no'), 'Serial number');
    expect(driverWsEvidenceKindLabel(ar, 'payment'), 'إيصال السداد');
    // A token the catalog does not know falls back to the token, never blank.
    expect(driverWsTermLabel(ar, 'brand_new_state'), 'brand new state');
    expect(driverWsRecordFieldLabel(en, 'odd_column'), 'odd column');
  });

  test('every form field has a label in every language', () async {
    for (final String code in <String>['en', 'ar', 'ur']) {
      final AppLocalizations l10n = await load(code);
      for (final List<DriverWsField> fields in driverWsFields.values) {
        for (final DriverWsField field in fields) {
          expect(field.label(l10n).trim(), isNotEmpty, reason: field.key);
        }
      }
      for (final DriverFineResponseIssue issue
          in DriverFineResponseIssue.values) {
        expect(driverWsIssueMessage(l10n, issue).trim(), isNotEmpty);
      }
    }
  });

  testWidgets('fine card renders Arabic copy, not English',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          locale: const Locale('ar'),
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: Scaffold(
            body: SingleChildScrollView(
              child: DriverFineCard(
                fine: const <String, Object?>{
                  'id': 'fine',
                  'notice_reference': 'N1',
                  'amount': 500,
                  'currency': 'SAR',
                  'status': 'open',
                  'response_status': 'awaiting_response',
                  'paid_amount': 0,
                  'evidence': <DriverRow>[],
                  'responses': <DriverRow>[],
                },
                data: const DriverWorkspaceSnapshot(
                  data: <String, Object?>{'can_respond': true},
                ),
                onAction: (String action, [DriverRow? fine]) async {},
                onChanged: () async {},
              ),
            ),
          ),
        ),
      ),
    );
    expect(find.text('مفتوحة · بانتظار الرد'), findsOneWidget);
    await tester.tap(find.text('N1 · 500 SAR'));
    await tester.pumpAndSettle();
    expect(find.text('الإقرار بالاستلام والرد'), findsOneWidget);
    expect(find.text('Acknowledge and respond'), findsNothing);
  });
}
