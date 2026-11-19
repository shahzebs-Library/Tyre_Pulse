import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/inventory/domain/count_models.dart';
import 'package:tyre_pulse/features/inventory/domain/count_session.dart';
import 'package:tyre_pulse/features/inventory/domain/transfer_models.dart';
import 'package:tyre_pulse/features/inventory/inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/presentation/count_line_sheet.dart';
import 'package:tyre_pulse/features/inventory/presentation/my_audits_screen.dart';
import 'package:tyre_pulse/features/inventory/presentation/transfers_screen.dart';

const SupabaseFailure _missing = SupabaseFailure(
  error: AppError(kind: AppErrorKind.server, message: 'Feature unavailable.'),
  cause: SupabaseFailureCause.schemaMismatch,
);

Widget _app(Widget child, List<Override> overrides) => ProviderScope(
      overrides: overrides,
      child: MaterialApp(
        localizationsDelegates: TpLocalizations.delegates,
        supportedLocales: TpLocalizations.supportedLocales,
        home: child,
      ),
    );

void main() {
  testWidgets('My counts: a missing server object is "not set up", not empty',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      _app(const MyAuditsScreen(), <Override>[
        myInventoryAuditsProvider
            .overrideWith((Ref ref) async => throw _missing),
        myCountDraftsProvider.overrideWith(
          (Ref ref) async => <String, CountSession>{},
        ),
      ]),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('inventory.notProvisioned')), findsOneWidget);
  });

  testWidgets('My counts lists an assigned audit', (WidgetTester tester) async {
    await tester.pumpWidget(
      _app(const MyAuditsScreen(), <Override>[
        myInventoryAuditsProvider.overrideWith(
          (Ref ref) async => const <InventoryAuditSummary>[
            InventoryAuditSummary(
              id: 'a1',
              reference: 'AUD-7',
              status: 'assigned',
              auditType: 'cycle',
            ),
          ],
        ),
        myCountDraftsProvider.overrideWith(
          (Ref ref) async => <String, CountSession>{},
        ),
      ]),
    );
    await tester.pumpAndSettle();
    expect(find.text('AUD-7'), findsOneWidget);
    expect(find.text('Cycle count'), findsOneWidget);
  });

  testWidgets('Transfers: not provisioned is stated honestly',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      _app(const TransfersScreen(), <Override>[
        stockTransfersProvider.overrideWith((Ref ref) async => throw _missing),
      ]),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('inventory.notProvisioned')), findsOneWidget);
  });

  testWidgets('Transfers lists one awaiting receipt',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      _app(const TransfersScreen(), <Override>[
        stockTransfersProvider.overrideWith(
          (Ref ref) async => const <StockTransfer>[
            StockTransfer(id: 't1', reference: 'TRF-1', status: 'in_transit'),
          ],
        ),
      ]),
    );
    await tester.pumpAndSettle();
    expect(find.text('TRF-1'), findsOneWidget);
    expect(find.byIcon(Icons.move_to_inbox_outlined), findsOneWidget);
  });

  test('a count line cannot be saved without a count or a confirmed zero', () {
    expect(countLineProblem(qty: null, confirmedZero: false), 'enterQty');
    expect(countLineProblem(qty: 0, confirmedZero: false), 'confirmZeroFirst');
    expect(countLineProblem(qty: -1, confirmedZero: false), 'invalidQty');
    expect(countLineProblem(qty: null, confirmedZero: true), isNull);
    expect(countLineProblem(qty: 3, confirmedZero: false), isNull);
  });
}
