/// The Flutter side of `20261109160000_workforce_operations_core.sql`: blocker
/// causes through the durable queue (including entries written by older
/// builds without one), the RPC argument set, the new refusal reasons in all
/// three languages, evidence rules, and the cause picker.
library;

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/my_work/data/queued_workforce_transition.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignment_evidence.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_sync_engine.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_transition_remote.dart';
import 'package:tyre_pulse/features/my_work/domain/workforce_transition.dart';
import 'package:tyre_pulse/features/my_work/presentation/workforce_assignments_panel.dart';
import 'package:tyre_pulse/features/my_work/presentation/workforce_copy.dart';
import 'package:tyre_pulse/l10n/generated/app_localizations.dart'
    show lookupAppLocalizations;

import 'data/workforce_test_fakes.dart';

const String userA = '11111111-1111-1111-1111-111111111111';

QueuedWorkforceTransition _entry({WorkforceBlockReason? reason}) =>
    QueuedWorkforceTransition(
      id: 'key-1-0000000000',
      userId: userA,
      assignmentId: 'a1',
      action: WorkforceAction.block,
      seq: 1,
      createdAt: DateTime.utc(2026, 11, 9),
      clientAt: DateTime.utc(2026, 11, 9),
      baseStatus: 'in_progress',
      note: 'no valve',
      reasonCode: reason,
    );

void main() {
  group('blocker cause vocabulary', () {
    test('matches the server CHECK exactly', () {
      expect(
        WorkforceBlockReason.values.map((WorkforceBlockReason r) => r.wire),
        <String>[
          'waiting_stock',
          'waiting_equipment',
          'vehicle_unavailable',
          'safety_hold',
          'waiting_approval',
          'waiting_manpower',
          'other',
        ],
      );
    });

    test('unknown or absent values parse to null without throwing', () {
      expect(WorkforceBlockReason.fromWire(null), isNull);
      expect(WorkforceBlockReason.fromWire('coffee_break'), isNull);
      expect(
        WorkforceBlockReason.fromWire('safety_hold'),
        WorkforceBlockReason.safetyHold,
      );
    });
  });

  group('queued entry serialisation', () {
    test('a cause round-trips through JSON', () {
      final QueuedWorkforceTransition back =
          QueuedWorkforceTransition.fromJsonString(
        _entry(reason: WorkforceBlockReason.waitingApproval).toJsonString(),
      );
      expect(back.reasonCode, WorkforceBlockReason.waitingApproval);
      expect(back.toJson()['reasonCode'], 'waiting_approval');
    });

    test('an entry written by an older build (no reasonCode key) still loads',
        () {
      final Map<String, Object?> legacy = _entry().toJson()
        ..remove('reasonCode');
      expect(legacy.containsKey('reasonCode'), isFalse);
      final QueuedWorkforceTransition back =
          QueuedWorkforceTransition.fromJsonString(jsonEncode(legacy));
      expect(back.action, WorkforceAction.block);
      expect(back.note, 'no valve');
      expect(back.reasonCode, isNull);
    });

    test('a corrupt reasonCode value does not lose the entry', () {
      final Map<String, Object?> odd = _entry().toJson()..['reasonCode'] = 7;
      final QueuedWorkforceTransition back =
          QueuedWorkforceTransition.fromJsonString(jsonEncode(odd));
      expect(back.reasonCode, isNull);
      expect(back.id, 'key-1-0000000000');
    });

    test('copyWith keeps the cause', () {
      final QueuedWorkforceTransition changed = _entry(
        reason: WorkforceBlockReason.other,
      ).copyWith(status: WorkforceQueueStatus.rejected, attempts: 2);
      expect(changed.reasonCode, WorkforceBlockReason.other);
    });
  });

  group('RPC arguments', () {
    test('p_reason_code is sent when there is a cause', () {
      final Map<String, Object?> params = workforceTransitionParams(
        assignmentId: 'a1',
        action: 'block',
        idempotencyKey: 'key-1-0000000000',
        clientAt: DateTime.utc(2026, 11, 9, 8),
        note: 'no valve',
        reasonCode: 'waiting_stock',
      );
      expect(params['p_reason_code'], 'waiting_stock');
      expect(params['p_client_at'], '2026-11-09T08:00:00.000Z');
    });

    test('p_reason_code is omitted (not null) when there is none', () {
      final Map<String, Object?> params = workforceTransitionParams(
        assignmentId: 'a1',
        action: 'start',
        idempotencyKey: 'key-1-0000000000',
        clientAt: DateTime.utc(2026, 11, 9),
      );
      expect(params.containsKey('p_reason_code'), isFalse);
    });
  });

  group('engine', () {
    WorkforceTransitionEngine engine(
      FakeWorkforceQueue queue,
      FakeWorkforceRemote remote,
    ) {
      int n = 0;
      return WorkforceTransitionEngine(
        queue: queue,
        remote: remote,
        newId: () => 'key-${++n}-0000000000',
      );
    }

    test('a new block without a cause is refused and nothing is stored',
        () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      final FakeWorkforceRemote remote = FakeWorkforceRemote();
      final WorkforceSubmitResult result = await engine(queue, remote).submit(
        userId: userA,
        assignmentId: 'a1',
        serverStatus: 'in_progress',
        action: WorkforceAction.block,
        note: 'no valve',
      );
      expect(result.outcome, WorkforceSubmitOutcome.refused);
      expect(queue.of(userA), isEmpty);
      expect(remote.calls, isEmpty);
    });

    test('the cause is stored with the queued entry while offline', () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      final FakeWorkforceRemote remote = FakeWorkforceRemote(<Object>[
        const SocketException('offline'),
      ]);
      await engine(queue, remote).submit(
        userId: userA,
        assignmentId: 'a1',
        serverStatus: 'in_progress',
        action: WorkforceAction.block,
        note: 'no valve',
        reason: WorkforceBlockReason.vehicleUnavailable,
      );
      expect(
        queue.of(userA).single.reasonCode,
        WorkforceBlockReason.vehicleUnavailable,
      );
    });

    test('a cause is never attached to a non-block action', () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      final FakeWorkforceRemote remote = FakeWorkforceRemote();
      await engine(queue, remote).submit(
        userId: userA,
        assignmentId: 'a1',
        serverStatus: 'assigned',
        action: WorkforceAction.start,
        reason: WorkforceBlockReason.other,
      );
      expect(remote.calls.single.reasonCode, isNull);
    });

    test('a legacy queued block with no cause still replays (null)', () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      final Map<String, Object?> legacy = _entry().toJson()
        ..remove('reasonCode');
      await queue.put(
        QueuedWorkforceTransition.fromJsonString(jsonEncode(legacy)),
      );
      final FakeWorkforceRemote remote = FakeWorkforceRemote();
      final WorkforceFlushSummary summary =
          await engine(queue, remote).flush(userA);
      expect(summary.delivered, 1);
      expect(remote.calls.single.action, 'block');
      expect(remote.calls.single.reasonCode, isNull);
      expect(queue.of(userA), isEmpty);
    });

    test('a refused evidence_required update keeps its server reason',
        () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      final FakeWorkforceRemote remote = FakeWorkforceRemote(<Object>[
        rejectedResult('evidence_required', status: 'in_progress'),
      ]);
      final WorkforceSubmitResult result = await engine(queue, remote).submit(
        userId: userA,
        assignmentId: 'a1',
        serverStatus: 'in_progress',
        action: WorkforceAction.complete,
      );
      expect(result.outcome, WorkforceSubmitOutcome.rejected);
      expect(result.item?.rejectionReason, 'evidence_required');
      expect(workforceTerminalRefusals, isNot(contains('evidence_required')));
    });
  });

  group('refusal mapping', () {
    const List<String> newReasons = <String>[
      'evidence_required',
      'record_required',
      'review_note_required',
      'record_not_found',
      'asset_mismatch',
      'record_already_linked',
    ];

    test('every new reason has its own English sentence', () {
      final Set<String> sentences = <String>{
        for (final String r in newReasons) workforceRejectionMessage(r, null),
      };
      expect(sentences, hasLength(newReasons.length));
      expect(
        sentences,
        isNot(contains(workforceRejectionMessage('???', null))),
      );
    });

    for (final String language in <String>['en', 'ar', 'ur']) {
      test('$language localises every server refusal distinctly', () {
        final AppLocalizations l10n = lookupAppLocalizations(Locale(language));
        final Set<String> texts = <String>{};
        for (final String reason in workforceServerRefusalReasons) {
          final String? text = workforceRefusalText(l10n, reason);
          expect(text, isNotNull, reason: reason);
          expect(text!.trim(), isNotEmpty, reason: reason);
          texts.add(text);
        }
        expect(texts, hasLength(workforceServerRefusalReasons.length));
        for (final WorkforceBlockReason r in WorkforceBlockReason.values) {
          expect(workforceBlockCauseLabel(l10n, r).trim(), isNotEmpty);
        }
      });
    }

    test('a client-side classification is not a server refusal', () {
      final AppLocalizations l10n = lookupAppLocalizations(const Locale('en'));
      expect(workforceRefusalText(l10n, 'checkViolation'), isNull);
      expect(workforceRefusalText(l10n, null), isNull);
    });

    test('invalid_transition carries the current status', () {
      final AppLocalizations l10n = lookupAppLocalizations(const Locale('en'));
      expect(
        workforceRefusalText(
          l10n,
          'invalid_transition',
          currentStatus: 'in_progress',
        ),
        endsWith('Current status: in progress.'),
      );
    });

    test('Arabic and Urdu are translations, not English copies', () {
      final AppLocalizations en = lookupAppLocalizations(const Locale('en'));
      for (final String language in <String>['ar', 'ur']) {
        final AppLocalizations other = lookupAppLocalizations(Locale(language));
        for (final String r in newReasons) {
          expect(
            workforceRefusalText(other, r),
            isNot(workforceRefusalText(en, r)),
            reason: '$language $r',
          );
        }
      }
    });

    test('the four record kinds have labels; others do not', () {
      final AppLocalizations l10n = lookupAppLocalizations(const Locale('en'));
      expect(workforceRecordLabel(l10n, 'tyre_records'), 'tyre record');
      expect(workforceRecordLabel(l10n, 'work_orders'), 'work order');
      expect(workforceRecordLabel(l10n, 'inspections'), 'inspection');
      expect(
        workforceRecordLabel(l10n, 'tyre_service_events'),
        'tyre service event',
      );
      expect(workforceRecordLabel(l10n, 'accidents'), isNull);
    });
  });

  group('evidence rules', () {
    WorkforceEvidenceFile file(int size, String mime) => WorkforceEvidenceFile(
          bytes: Uint8List(size),
          fileName: 'x',
          mimeType: mime,
          kind: WorkforceEvidenceKind.photo,
        );

    test('mime types follow the server allow-list', () {
      expect(workforceEvidenceMimeFor('a.JPG'), 'image/jpeg');
      expect(workforceEvidenceMimeFor('a.jpeg'), 'image/jpeg');
      expect(workforceEvidenceMimeFor('a.png'), 'image/png');
      expect(workforceEvidenceMimeFor('scan.pdf'), 'application/pdf');
      expect(workforceEvidenceMimeFor('a.heic'), isNull);
      expect(workforceEvidenceMimeFor('noext'), isNull);
    });

    test('size is 1 byte to 10 MB', () {
      expect(
        validateWorkforceEvidence(file(0, 'image/jpeg')),
        WorkforceEvidenceProblem.size,
      );
      expect(validateWorkforceEvidence(file(1, 'image/jpeg')), isNull);
      expect(
        validateWorkforceEvidence(file(workforceEvidenceMaxBytes, 'image/png')),
        isNull,
      );
      expect(
        validateWorkforceEvidence(
          file(workforceEvidenceMaxBytes + 1, 'application/pdf'),
        ),
        WorkforceEvidenceProblem.size,
      );
      expect(
        validateWorkforceEvidence(file(5, 'image/webp')),
        WorkforceEvidenceProblem.type,
      );
    });

    test('the object path matches the storage and insert policies', () {
      expect(
        workforceEvidencePath(
          organisationId: 'org-1',
          assignmentId: 'a1',
          stamp: 42,
          mimeType: 'application/pdf',
        ),
        'org-1/assignments/a1/42.pdf',
      );
    });

    test('the insert row carries every NOT NULL column except defaults', () {
      final Map<String, Object?> row = workforceEvidenceRow(
        organisationId: 'org-1',
        assignmentId: 'a1',
        objectPath: 'org-1/assignments/a1/1.jpg',
        file: WorkforceEvidenceFile(
          bytes: Uint8List(3),
          fileName: '   ',
          mimeType: 'image/jpeg',
          kind: WorkforceEvidenceKind.photo,
        ),
      );
      expect(row['kind'], 'photo');
      expect(row['byte_size'], 3);
      expect(row['file_name'], 'evidence.jpg');
      expect(row.containsKey('uploaded_by'), isFalse);
      expect(
        workforceEvidenceFileName('x' * 300, 'image/png').length,
        240,
      );
    });

    test('counts include assignments with no rows as zero', () {
      const List<String> ids = <String>['a1', 'a2'];
      final List<dynamic> rows = <dynamic>[
        <String, dynamic>{'assignment_id': 'a1'},
        <String, dynamic>{'assignment_id': 'a1'},
        <String, dynamic>{'assignment_id': 'other'},
        'junk',
      ];
      expect(
        countWorkforceEvidence(ids, rows),
        <String, int>{'a1': 2, 'a2': 0},
      );
    });
  });

  group('cause picker', () {
    Future<List<Object?>> open(WidgetTester tester, Locale locale) async {
      final List<Object?> results = <Object?>[];
      await tester.pumpWidget(
        MaterialApp(
          locale: locale,
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: Builder(
            builder: (BuildContext context) => Scaffold(
              body: TextButton(
                onPressed: () async => results.add(
                  await showDialog<Object?>(
                    context: context,
                    builder: (_) => const WorkforceBlockDialog(title: 'Block'),
                  ),
                ),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      return results;
    }

    testWidgets('offers all seven causes and returns the chosen one',
        (WidgetTester tester) async {
      final List<Object?> results = await open(tester, const Locale('en'));
      for (final WorkforceBlockReason r in WorkforceBlockReason.values) {
        expect(find.byKey(WorkforcePanelKeys.cause(r)), findsOneWidget);
      }
      await tester.tap(
        find.byKey(WorkforcePanelKeys.cause(WorkforceBlockReason.safetyHold)),
      );
      await tester.enterText(
        find.byKey(WorkforcePanelKeys.noteField),
        '  hydraulic leak  ',
      );
      await tester.pump();
      await tester.tap(find.byKey(WorkforcePanelKeys.noteConfirm));
      await tester.pumpAndSettle();
      final ({WorkforceBlockReason reason, String note}) picked =
          results.single! as ({WorkforceBlockReason reason, String note});
      expect(picked.reason, WorkforceBlockReason.safetyHold);
      expect(picked.note, 'hydraulic leak');
    });

    testWidgets('deselecting the cause disables confirm again',
        (WidgetTester tester) async {
      await open(tester, const Locale('en'));
      final Finder chip =
          find.byKey(WorkforcePanelKeys.cause(WorkforceBlockReason.other));
      await tester.enterText(find.byKey(WorkforcePanelKeys.noteField), 'x');
      await tester.tap(chip);
      await tester.pump();
      FilledButton confirm() => tester.widget<FilledButton>(
            find.byKey(WorkforcePanelKeys.noteConfirm),
          );
      expect(confirm().onPressed, isNotNull);
      await tester.tap(chip);
      await tester.pump();
      expect(confirm().onPressed, isNull);
    });

    testWidgets('renders right-to-left in Arabic with translated causes',
        (WidgetTester tester) async {
      await open(tester, const Locale('ar'));
      expect(
        Directionality.of(tester.element(find.byType(WorkforceBlockDialog))),
        TextDirection.rtl,
      );
      expect(find.text('إيقاف لأسباب السلامة'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
