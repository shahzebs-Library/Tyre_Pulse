import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/accidents/data/accident_workstream_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_workstream_editor.dart';

void main() {
  test('waiver requires a reason and refuses all mandatory workstreams',
      () async {
    var calls = 0;
    final repo = AccidentWorkstreamRepository(
      (name, params) async {
        calls++;
        return <String, dynamic>{'ok': true};
      },
      authenticatedUserId: () => 'signed-in-user',
    );
    for (final key in <String>['incident_evidence', 'liability', 'finance']) {
      await expectLater(
        repo.waive(
          accidentId: 'case',
          workstreamKey: key,
          reason: 'Not needed',
        ),
        throwsArgumentError,
      );
    }
    await expectLater(
      repo.waive(accidentId: 'case', workstreamKey: 'repair', reason: '  '),
      throwsArgumentError,
    );
    expect(calls, 0);
  });

  test('waiver records only current authenticated actor and trimmed reason',
      () async {
    Map<String, dynamic>? sent;
    final repo = AccidentWorkstreamRepository(
      (name, params) async {
        expect(name, 'accident_ws_mark_na');
        sent = params;
        return <String, dynamic>{'ok': true};
      },
      authenticatedUserId: () => 'signed-in-user',
    );
    await repo.waive(
      accidentId: 'case',
      workstreamKey: 'repair',
      reason: ' No repair required ',
    );
    expect(sent, <String, dynamic>{
      'p_accident_id': 'case',
      'p_workstream_key': 'repair',
      'p_reason': 'No repair required',
      'p_approved_by': 'signed-in-user',
    });
  });

  testWidgets('waiver requires a reason before explicit approval',
      (tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: AccidentWorkstreamEditor(
            accidentId: 'case',
            waiver: true,
            workstreams: <AccidentWorkstream>[
              AccidentWorkstream(id: 'ws', key: 'repair'),
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('accident.workstream.status')), findsNothing);
    expect(
      tester
          .widget<FilledButton>(
            find.byKey(const Key('accident.workstream.save')),
          )
          .onPressed,
      isNull,
    );
    await tester.enterText(find.byType(TextField), 'No repair required');
    await tester.pump();
    expect(
      tester
          .widget<FilledButton>(
            find.byKey(const Key('accident.workstream.save')),
          )
          .onPressed,
      isNotNull,
    );
    expect(find.text('Approve waiver'), findsOneWidget);
  });

  test('rejects unsupported transitions without making a request', () async {
    var calls = 0;
    final repo = AccidentWorkstreamRepository((name, params) async {
      calls++;
      return <String, dynamic>{'ok': true};
    });
    await expectLater(
      repo.update(
        accidentId: 'case',
        workstreamKey: 'repair',
        status: 'not_required',
      ),
      throwsArgumentError,
    );
    expect(calls, 0);
  });

  testWidgets(
      'denied save keeps entered note and allows retry, confirmed save closes',
      (tester) async {
    var calls = 0;
    final pending = Completer<dynamic>();
    final repo = AccidentWorkstreamRepository((name, params) async {
      expect(name, 'accident_ws_set_status');
      expect(params, <String, dynamic>{
        'p_accident_id': 'case',
        'p_workstream_key': 'repair',
        'p_status': 'completed',
        'p_note': 'QC reviewed',
      });
      calls++;
      if (calls == 1) {
        throw const PostgrestException(message: 'denied', code: '42501');
      }
      return pending.future;
    });
    bool? saved;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          accidentWorkstreamRepositoryProvider.overrideWithValue(repo),
        ],
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () async {
                  saved = await showDialog<bool>(
                    context: context,
                    builder: (_) => const AccidentWorkstreamEditor(
                      accidentId: 'case',
                      workstreams: [
                        AccidentWorkstream(
                          id: 'ws',
                          key: 'repair',
                          status: 'in_progress',
                        ),
                      ],
                    ),
                  );
                },
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('accident.workstream.status')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Completed').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), ' QC reviewed ');
    await tester.tap(find.byKey(const Key('accident.workstream.save')));
    await tester.pumpAndSettle();
    expect(saved, isNull);
    expect(find.text(' QC reviewed '), findsOneWidget);
    expect(find.byType(AlertDialog), findsOneWidget);
    await tester.tap(find.byKey(const Key('accident.workstream.save')));
    await tester.pump();
    expect(
      tester
          .widget<FilledButton>(
            find.byKey(const Key('accident.workstream.save')),
          )
          .onPressed,
      isNull,
    );
    expect(calls, 2);
    pending.complete(<String, dynamic>{'ok': true});
    await tester.pumpAndSettle();
    expect(saved, isTrue);
    expect(find.byType(AlertDialog), findsNothing);
  });
}
