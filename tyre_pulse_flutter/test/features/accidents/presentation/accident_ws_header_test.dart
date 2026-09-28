import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show PostgrestException;
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/accidents/data/accident_sla_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_header.dart';

const AccidentRecord _record = AccidentRecord(
  id: 'case-1',
  assetNo: 'CP-045',
  site: 'Yard',
  incidentDate: '2026-09-16',
);

final DateTime _start = DateTime(2026, 9, 16, 14, 35);
final DateTime _now = _start.add(const Duration(minutes: 42));

Future<void> _pump(
  WidgetTester tester, {
  required Future<List<Map<String, dynamic>>> Function(String id) read,
  List<AccidentWorkstream> workstreams = const <AccidentWorkstream>[],
  String workstreamKey = 'fleet_validation',
}) async {
  tester.view.physicalSize = const Size(360, 760);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        accidentSlaRepositoryProvider
            .overrideWithValue(AccidentSlaRepository(read)),
      ],
      child: MaterialApp(
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: Scaffold(
          body: AccidentWorkstreamHeader(
            snapshot: AccidentCaseSnapshot(
              accident: _record,
              provisioned: true,
              workstreams: workstreams,
            ),
            workstreamKey: workstreamKey,
            now: _now,
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// Line 1 is a rich text; line 2 is a wrap of icon + text segments. Both
/// are read back as the sentence a reader (and screen reader) gets.
String _line(WidgetTester tester, String key) {
  final Finder finder = find.byKey(Key(key));
  final Widget widget = tester.widget(finder);
  if (widget is Text) {
    return widget.data ?? widget.textSpan?.toPlainText() ?? '';
  }
  return tester
      .widgetList<Text>(
        find.descendant(of: finder, matching: find.byType(Text)),
      )
      .map((Text t) => t.data ?? '')
      .join(' · ');
}

/// The colour the SLA segment (the last segment of line 2) is drawn in.
Color? _slaColor(WidgetTester tester) => tester
    .widgetList<Text>(
      find.descendant(
        of: find.byKey(const Key('accident.ws.header.line2')),
        matching: find.byType(Text),
      ),
    )
    .last
    .style
    ?.color;

TpPalette _palette(WidgetTester tester) => TpPalette.of(
      tester.element(find.byKey(const Key('accident.ws.header.line2'))),
    );

void main() {
  testWidgets('running SLA prints received, held-with and remaining time',
      (WidgetTester tester) async {
    await _pump(
      tester,
      read: (_) async => <Map<String, dynamic>>[
        <String, dynamic>{
          'workstream_key': 'fleet_validation',
          'team': 'Fleet',
          'start_at': _start.toIso8601String(),
          'due_at':
              _now.add(const Duration(hours: 1, minutes: 18)).toIso8601String(),
          'state': 'running',
        },
      ],
    );
    expect(
      _line(tester, 'accident.ws.header.line1'),
      'Workstream 1 of 7: Fleet validation | Owner: Fleet',
    );
    expect(
      _line(tester, 'accident.ws.header.line2'),
      'Received 14:35 · With Fleet 42m · SLA 1h 18m remaining',
    );
    // A running SLA is the warning tone; the words stay, colour is extra.
    expect(_slaColor(tester), _palette(tester).warning.onSoft);
    // The workstream name is drawn in the primary colour.
    final Text line1 =
        tester.widget<Text>(find.byKey(const Key('accident.ws.header.line1')));
    final List<InlineSpan> spans =
        (line1.textSpan! as TextSpan).children!.cast<InlineSpan>();
    expect(
      spans
          .whereType<TextSpan>()
          .firstWhere((s) => s.text == 'Fleet validation')
          .style
          ?.color,
      _palette(tester).primary,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('owner comes from the workstream row, never a person',
      (WidgetTester tester) async {
    await _pump(
      tester,
      read: (_) async => <Map<String, dynamic>>[],
      workstreams: const <AccidentWorkstream>[
        AccidentWorkstream(
          id: 'ws',
          key: 'fleet_validation',
          team: 'Fleet',
          ownerRole: 'Fleet Supervisor',
        ),
      ],
    );
    expect(
      _line(tester, 'accident.ws.header.line1'),
      'Workstream 1 of 7: Fleet validation | Owner: Fleet / Fleet Supervisor',
    );
    expect(_line(tester, 'accident.ws.header.line2'), 'No SLA started');
  });

  testWidgets('an overdue clock says overdue, a paused one says paused',
      (WidgetTester tester) async {
    await _pump(
      tester,
      read: (_) async => <Map<String, dynamic>>[
        <String, dynamic>{
          'workstream_key': 'liability',
          'start_at': _start.toIso8601String(),
          'due_at': _start.add(const Duration(minutes: 12)).toIso8601String(),
          'state': 'running',
        },
        <String, dynamic>{
          'workstream_key': 'assessment',
          'start_at': _start.toIso8601String(),
          'state': 'paused',
        },
      ],
      workstreamKey: 'liability',
    );
    expect(
      _line(tester, 'accident.ws.header.line2'),
      'Received 14:35 · With Fleet 42m · SLA overdue by 30m',
    );
    expect(_slaColor(tester), _palette(tester).critical.base);
  });

  testWidgets('a missing SLA table reads as not provisioned, not as no SLA',
      (WidgetTester tester) async {
    await _pump(
      tester,
      read: (_) async =>
          throw const PostgrestException(message: 'missing', code: '42P01'),
    );
    expect(
      _line(tester, 'accident.ws.header.line2'),
      'SLA tracking not provisioned yet',
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('a met SLA is the ok tone and a breached one critical',
      (WidgetTester tester) async {
    await _pump(
      tester,
      read: (_) async => <Map<String, dynamic>>[
        <String, dynamic>{
          'workstream_key': 'fleet_validation',
          'start_at': _start.toIso8601String(),
          'state': 'met',
        },
        <String, dynamic>{
          'workstream_key': 'insurance',
          'start_at': _start.toIso8601String(),
          'state': 'breached',
        },
      ],
    );
    expect(_line(tester, 'accident.ws.header.line2'), contains('SLA met'));
    expect(_slaColor(tester), _palette(tester).ok.onSoft);

    await _pump(
      tester,
      read: (_) async => <Map<String, dynamic>>[
        <String, dynamic>{
          'workstream_key': 'insurance',
          'start_at': _start.toIso8601String(),
          'state': 'breached',
        },
      ],
      workstreamKey: 'insurance',
    );
    expect(_slaColor(tester), _palette(tester).critical.base);
    expect(tester.takeException(), isNull);
  });

  testWidgets('line 2 is announced as one sentence',
      (WidgetTester tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await _pump(
      tester,
      read: (_) async => <Map<String, dynamic>>[
        <String, dynamic>{
          'workstream_key': 'fleet_validation',
          'team': 'Fleet',
          'start_at': _start.toIso8601String(),
          'due_at': _now.add(const Duration(minutes: 5)).toIso8601String(),
          'state': 'running',
        },
      ],
    );
    expect(
      find.bySemanticsLabel(
        'Received 14:35 · With Fleet 42m · SLA 5m remaining',
      ),
      findsOneWidget,
    );
    handle.dispose();
  });
}
