import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/driver_workspace/data/driver_workspace_dto.dart';
import 'package:tyre_pulse/features/driver_workspace/domain/driver_workspace.dart';
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
      contains('reference'),
    );
    expect(
      validateDriverFineResponse(
        <String, Object?>{...values, 'resolution': 'direct_payment'},
      ),
      contains('date'),
    );
    expect(
      validateDriverFineResponse(<String, Object?>{
        ...values,
        'resolution': 'dispute',
        'acknowledged': false,
      }),
      contains('sign'),
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
}
