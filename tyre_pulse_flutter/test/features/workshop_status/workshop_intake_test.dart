import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/workshop_status/data/workshop_intake_repository.dart';
import 'package:tyre_pulse/features/workshop_status/domain/workshop_intake.dart';
import 'package:tyre_pulse/features/workshop_status/presentation/workshop_intake_copy.dart';
import 'package:tyre_pulse/features/workshop_status/presentation/workshop_intake_screen.dart';
import 'package:tyre_pulse/features/workshop_status/workshop_status_providers.dart';
import 'package:tyre_pulse/l10n/generated/app_localizations_ar.dart';
import 'package:tyre_pulse/l10n/generated/app_localizations_en.dart';
import 'package:tyre_pulse/l10n/generated/app_localizations_ur.dart';

final class _FakeIntake implements WorkshopIntakeRepository {
  _FakeIntake({
    this.perms =
        const WorkshopIntakePermissions(intake: true, intakeConfirm: true),
  });

  final WorkshopIntakePermissions perms;
  final List<List<String>> confirmed = <List<String>>[];
  final List<String> returned = <String>[];
  final List<Map<String, String>> added = <Map<String, String>>[];

  List<WorkshopIntakeRecord> rows = <WorkshopIntakeRecord>[
    WorkshopIntakeRecord.fromRow(const <String, dynamic>{
      'id': 'a',
      'asset_no': 'TM701',
      'site': 'NHC',
      'confirm_status': 'pending_confirm',
      'intake_source': 'sheet',
      'routed_to': <String>['me'],
      'current_active': true,
      'submitted_by': 'other',
      'submitted_by_name': 'Ali',
      'priority': 'High',
      'complaint': 'Brake noise',
    }),
    WorkshopIntakeRecord.fromRow(const <String, dynamic>{
      'id': 'b',
      'asset_no': 'TM628',
      'confirm_status': 'pending_confirm',
      'intake_source': 'phone',
      'routed_to': <String>['me'],
      'current_active': true,
      'submitted_by': 'me',
      'submitted_by_name': 'Me',
    }),
  ];

  @override
  Future<WorkshopIntakePermissions> myPermissions() async => perms;

  @override
  Future<List<WorkshopIntakeRecord>> listWaiting({
    required String userId,
    String? country,
  }) async =>
      rows;

  @override
  Future<Object?> addVehicle({
    required String country,
    required Map<String, String> fields,
    required String clientKey,
  }) async {
    added
        .add(<String, String>{...fields, 'country': country, 'key': clientKey});
    return <String, Object?>{
      'rows': <Object?>[
        <String, Object?>{'outcome': 'new'},
      ],
    };
  }

  @override
  Future<Object?> confirm(List<String> ids) async {
    confirmed.add(ids);
    return <String, Object?>{
      'results': <Object?>[
        for (final String id in ids)
          <String, Object?>{'id': id, 'outcome': 'confirmed'},
      ],
    };
  }

  @override
  Future<void> returnToSender({
    required String id,
    required String reason,
  }) async =>
      returned.add('$id:$reason');
}

Future<void> _pump(
  WidgetTester tester,
  _FakeIntake repo, {
  Locale locale = const Locale('en'),
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        workshopIntakeRepositoryProvider.overrideWithValue(repo),
        workshopStatusUserIdProvider.overrideWithValue('me'),
        activeCountryProvider.overrideWithValue('KSA'),
      ],
      child: MaterialApp(
        theme: TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const WorkshopIntakeScreen(),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('domain', () {
    test('permissions fail closed', () {
      expect(WorkshopIntakePermissions.fromJson(null).any, isFalse);
      final WorkshopIntakePermissions p = WorkshopIntakePermissions.fromJson(
        <String, Object?>{'intake': true, 'intake_confirm': 'true'},
      );
      expect(p.intake, isTrue);
      expect(p.intakeConfirm, isFalse);
    });

    test('nobody confirms their own entry', () {
      final WorkshopIntakeRecord r =
          WorkshopIntakeRecord.fromRow(const <String, dynamic>{
        'id': 'x',
        'asset_no': 'TM1',
        'confirm_status': 'pending_confirm',
        'routed_to': <String>['me'],
        'current_active': true,
        'submitted_by': 'me',
      });
      expect(r.isWaitingFor('me'), isTrue);
      expect(r.canConfirm('me'), isFalse);
      expect(intakeAssetKey(' tm 70 1'), 'TM701');
      expect(intakeReasonOk('abcd'), isFalse);
      expect(intakeReasonOk('abcde'), isTrue);
    });

    test('reads server outcomes', () {
      expect(
        intakeOutcomeOf(<String, Object?>{
          'rows': <Object?>[
            <String, Object?>{'outcome': 'already_listed'},
          ],
        }),
        IntakeOutcome.alreadyListed,
      );
      expect(intakeOutcomeOf(null), IntakeOutcome.unknown);
      expect(
        intakeConfirmOutcome(
          <String, Object?>{
            'results': <Object?>[
              <String, Object?>{'id': 'a', 'outcome': 'refused'},
            ],
          },
          'a',
        ),
        'refused',
      );
    });

    test('copy catalogs carry the same keys in en, ar and ur', () {
      final Set<String> en = WorkshopIntakeCopy.parse(
        AppLocalizationsEn().workshopIntakeCopyCatalog,
      ).values.keys.toSet();
      expect(en, contains('ownEntry'));
      expect(
        WorkshopIntakeCopy.parse(
          AppLocalizationsAr().workshopIntakeCopyCatalog,
        ).values.keys.toSet(),
        en,
      );
      expect(
        WorkshopIntakeCopy.parse(
          AppLocalizationsUr().workshopIntakeCopyCatalog,
        ).values.keys.toSet(),
        en,
      );
    });
  });

  testWidgets('waiting list: confirm mine-to-check, own entry disabled',
      (WidgetTester tester) async {
    final _FakeIntake repo = _FakeIntake();
    await _pump(tester, repo);
    expect(find.text('2 vehicles waiting for you to confirm'), findsOneWidget);
    expect(
      find.text('You entered this one. Another supervisor confirms it.'),
      findsOneWidget,
    );
    expect(find.byKey(WorkshopIntakeKeys.confirm('b')), findsNothing);
    expect(repo.confirmed, isEmpty);
    await tester.tap(find.byKey(WorkshopIntakeKeys.confirm('a')));
    await tester.pumpAndSettle();
    expect(repo.confirmed, <List<String>>[
      <String>['a'],
    ]);
    expect(find.text('Vehicle confirmed.'), findsOneWidget);
  });

  testWidgets('return needs a reason', (WidgetTester tester) async {
    final _FakeIntake repo = _FakeIntake();
    await _pump(tester, repo);
    await tester.tap(find.byKey(WorkshopIntakeKeys.returnButton('a')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Return').last);
    await tester.pumpAndSettle();
    expect(repo.returned, isEmpty);
    expect(find.text('Write at least 5 characters.'), findsOneWidget);
    await tester.enterText(
      find.descendant(
        of: find.byKey(WorkshopIntakeKeys.reason),
        matching: find.byType(TextField),
      ),
      'Wrong site entered',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Return').last);
    await tester.pumpAndSettle();
    expect(repo.returned, <String>['a:Wrong site entered']);
  });

  testWidgets('add vehicle sends from the phone with a normalised asset code',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 2600);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    final _FakeIntake repo =
        _FakeIntake(perms: const WorkshopIntakePermissions(intake: true));
    await _pump(tester, repo);
    await tester.scrollUntilVisible(
      find.byKey(WorkshopIntakeKeys.send),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byKey(WorkshopIntakeKeys.send));
    await tester.pumpAndSettle();
    expect(find.text('Enter the asset code.'), findsOneWidget);
    expect(repo.added, isEmpty);
    await tester.enterText(
      find.descendant(
        of: find.byKey(WorkshopIntakeKeys.asset),
        matching: find.byType(TextField),
      ),
      'tm 701',
    );
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.byKey(WorkshopIntakeKeys.send),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byKey(WorkshopIntakeKeys.send));
    await tester.pumpAndSettle();
    expect(repo.added.single['asset_no'], 'TM701');
    expect(repo.added.single['country'], 'KSA');
    expect(repo.added.single['key'], startsWith('phone-'));
  });

  testWidgets('no permission shows the denied state',
      (WidgetTester tester) async {
    await _pump(tester, _FakeIntake(perms: const WorkshopIntakePermissions()));
    expect(
      find.textContaining('Confirm workshop vehicles permission'),
      findsOneWidget,
    );
  });

  testWidgets('renders in Arabic right to left', (WidgetTester tester) async {
    await _pump(tester, _FakeIntake(), locale: const Locale('ar'));
    expect(find.text('بانتظاري'), findsOneWidget);
    expect(
      Directionality.of(tester.element(find.byType(WorkshopIntakeScreen))),
      TextDirection.rtl,
    );
  });
}
