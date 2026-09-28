/// The two-line workstream header the M4/M5/M6 mocks share:
///
/// ```
/// Workstream 1 of 7: Fleet validation | Owner: Fleet
/// Received 14:35 · With Fleet 42m · SLA 1h 18m remaining
/// ```
///
/// Line 1 carries the workstream name in the primary colour. Line 2 is a wrap
/// of icon + text segments read from `accident_sla_instances`; the SLA
/// segment is tinted by its state (warning while running, critical when
/// overdue or breached, ok when met) and always keeps its words, so colour is
/// never the only signal. When no clock exists for the workstream it says
/// "No SLA started" rather than inventing one.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/accidents/data/accident_sla_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_workstream_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_mock_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_ui.dart';

/// What a line-2 segment describes; drives its icon.
enum AccidentSlaSegmentKind { received, withTeam, sla, info }

/// How urgent the SLA segment is. [neutral] renders in secondary text.
enum AccidentSlaUrgency { neutral, running, overdue, met }

/// One icon + text piece of line 2.
@immutable
final class AccidentSlaSegment {
  const AccidentSlaSegment(
    this.kind,
    this.text, {
    this.urgency = AccidentSlaUrgency.neutral,
  });

  final AccidentSlaSegmentKind kind;
  final String text;
  final AccidentSlaUrgency urgency;
}

class AccidentWorkstreamHeader extends ConsumerWidget {
  const AccidentWorkstreamHeader({
    required this.snapshot,
    required this.workstreamKey,
    this.statusToken,
    this.now,
    super.key,
  });

  final AccidentCaseSnapshot snapshot;

  /// A `caseFlow` key such as `fleet_validation`.
  final String workstreamKey;

  /// Optional workstream status (e.g. `in_progress`). When set, a compact
  /// status chip with the status words leads line 1.
  final String? statusToken;

  /// Injected clock for deterministic tests. Production leaves it null.
  final DateTime? now;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AccidentMockCopy copy = AccidentMockCopy.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final NumberedStep? step = caseFlowStep(workstreamKey);
    final String stepLabel = step == null
        ? humaniseAccidentToken(workstreamKey)
        : copy.fill('workstreamOf', <String, String>{
            'n': '${step.n}',
            't': '${caseFlow.length}',
          });
    final String title = step == null
        ? humaniseAccidentToken(workstreamKey)
        : accidentVocabLabel(copy, 'flow', step.key, step.label);
    final String owner = accidentWorkstreamOwner(
      copy,
      snapshot.workstreams,
      workstreamKey,
    );
    final AccidentCasePeople people =
        ref.watch(accidentCasePeopleProvider(snapshot.accident.id)).value ??
            AccidentCasePeople.unknown;
    final String ownerShown = accidentOwnerDisplay(
      copy,
      people,
      workstreamKey,
      owner,
    );
    final AsyncValue<AccidentSlaLoad> sla =
        ref.watch(accidentSlaLoadProvider(snapshot.accident.id));

    final List<AccidentSlaSegment> segments = sla.when(
      data: (AccidentSlaLoad load) => accidentSlaSegments(
        context: context,
        copy: copy,
        load: load,
        workstreamKey: workstreamKey,
        fallbackTeam: owner,
        now: now ?? DateTime.now(),
      ),
      loading: () => <AccidentSlaSegment>[
        AccidentSlaSegment(AccidentSlaSegmentKind.info, copy('checkingSla')),
      ],
      error: (Object error, StackTrace stackTrace) => <AccidentSlaSegment>[
        AccidentSlaSegment(AccidentSlaSegmentKind.info, copy('slaUnavailable')),
      ],
    );
    final String line2 =
        segments.map((AccidentSlaSegment s) => s.text).join(' · ');
    final String status = statusToken?.trim() ?? '';

    return Semantics(
      container: true,
      header: true,
      child: Column(
        key: const Key('accident.ws.header'),
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.xs,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              if (status.isNotEmpty)
                TpStatusChip(
                  key: const Key('accident.ws.header.status'),
                  status: accidentTone(status),
                  label: humaniseAccidentToken(status),
                  isCompact: true,
                )
              else
                Icon(
                  Icons.fact_check_outlined,
                  size: TpSizing.iconMd,
                  color: palette.primary,
                ),
              Text.rich(
                TextSpan(
                  children: <InlineSpan>[
                    TextSpan(text: '$stepLabel: '),
                    TextSpan(
                      text: title,
                      style: TextStyle(color: palette.primary),
                    ),
                    TextSpan(text: ' | ${copy('ownerLabel')}: $ownerShown'),
                  ],
                ),
                key: const Key('accident.ws.header.line1'),
                style: text.titleSmall?.copyWith(fontWeight: FontWeight.w800),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.sm),
          Semantics(
            container: true,
            label: line2,
            excludeSemantics: true,
            child: Wrap(
              key: const Key('accident.ws.header.line2'),
              spacing: TpSpace.md,
              runSpacing: TpSpace.xs,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: <Widget>[
                for (final AccidentSlaSegment segment in segments)
                  _SegmentView(segment: segment, palette: palette),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SegmentView extends StatelessWidget {
  const _SegmentView({required this.segment, required this.palette});

  final AccidentSlaSegment segment;
  final TpPalette palette;

  @override
  Widget build(BuildContext context) {
    final Color color = accidentSlaUrgencyColor(palette, segment.urgency);
    final bool strong = segment.urgency != AccidentSlaUrgency.neutral;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(_icon(segment), size: 16, color: color),
        const SizedBox(width: TpSpace.xs),
        Flexible(
          child: Text(
            segment.text,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: color,
                  fontWeight: strong ? FontWeight.w700 : null,
                ),
          ),
        ),
      ],
    );
  }

  static IconData _icon(AccidentSlaSegment s) => switch (s.kind) {
        AccidentSlaSegmentKind.received => Icons.schedule_outlined,
        AccidentSlaSegmentKind.withTeam => Icons.groups_outlined,
        AccidentSlaSegmentKind.sla => switch (s.urgency) {
            AccidentSlaUrgency.met => Icons.check_circle_outline,
            AccidentSlaUrgency.overdue => Icons.error_outline,
            _ => Icons.timer_outlined,
          },
        AccidentSlaSegmentKind.info => Icons.info_outline,
      };
}

/// "Owner" as the mock prints it: the assigned person and the team
/// ("A. Name · Fleet"), "Unassigned · Fleet" when the lookup ran and nobody
/// is assigned, and just the team when no lookup result is available.
String accidentOwnerDisplay(
  AccidentMockCopy copy,
  AccidentCasePeople people,
  String workstreamKey,
  String team,
) {
  final String? name = people.ownerName(workstreamKey)?.trim();
  if (name != null && name.isNotEmpty) return '$name · $team';
  if (people.isUnassigned(workstreamKey)) {
    return '${copy('unassigned')} · $team';
  }
  return team;
}

/// Colour for an SLA urgency: warning while running, critical when overdue or
/// breached, ok when met, secondary text otherwise.
Color accidentSlaUrgencyColor(TpPalette palette, AccidentSlaUrgency urgency) =>
    switch (urgency) {
      AccidentSlaUrgency.running => palette.warning.onSoft,
      AccidentSlaUrgency.overdue => palette.critical.base,
      AccidentSlaUrgency.met => palette.ok.onSoft,
      AccidentSlaUrgency.neutral => palette.textSecondary,
    };

/// Line-2 segments, exported for the header test.
List<AccidentSlaSegment> accidentSlaSegments({
  required BuildContext context,
  required AccidentMockCopy copy,
  required AccidentSlaLoad load,
  required String workstreamKey,
  required String fallbackTeam,
  required DateTime now,
}) {
  if (!load.provisioned) {
    return <AccidentSlaSegment>[
      AccidentSlaSegment(
        AccidentSlaSegmentKind.info,
        copy('slaNotProvisioned'),
      ),
    ];
  }
  final AccidentSlaInstance? clock = load.forWorkstream(workstreamKey);
  if (clock == null) {
    return <AccidentSlaSegment>[
      AccidentSlaSegment(AccidentSlaSegmentKind.info, copy('noSla')),
    ];
  }

  final List<AccidentSlaSegment> parts = <AccidentSlaSegment>[];
  final DateTime? startAt = clock.startAt;
  if (startAt != null) {
    parts.add(
      AccidentSlaSegment(
        AccidentSlaSegmentKind.received,
        '${copy('received')} ${accidentClock(context, startAt)}',
      ),
    );
    final String team = clock.team?.trim().isNotEmpty ?? false
        ? clock.team!.trim()
        : fallbackTeam;
    final Duration held = now.difference(startAt);
    parts.add(
      AccidentSlaSegment(
        AccidentSlaSegmentKind.withTeam,
        '${copy('withTeam')} $team '
        '${accidentShortDuration(held.isNegative ? Duration.zero : held)}',
      ),
    );
  }

  final DateTime? dueAt = clock.dueAt;
  parts.add(
    switch (clock.state) {
      'paused' => AccidentSlaSegment(
          AccidentSlaSegmentKind.sla,
          copy('slaPaused'),
        ),
      'met' => AccidentSlaSegment(
          AccidentSlaSegmentKind.sla,
          copy('slaMet'),
          urgency: AccidentSlaUrgency.met,
        ),
      'breached' => AccidentSlaSegment(
          AccidentSlaSegmentKind.sla,
          copy('slaBreached'),
          urgency: AccidentSlaUrgency.overdue,
        ),
      'cancelled' => AccidentSlaSegment(
          AccidentSlaSegmentKind.sla,
          copy('slaCancelled'),
        ),
      _ => dueAt == null
          ? AccidentSlaSegment(
              AccidentSlaSegmentKind.sla,
              copy('slaDueNotSet'),
            )
          : now.isAfter(dueAt)
              ? AccidentSlaSegment(
                  AccidentSlaSegmentKind.sla,
                  copy.fill('slaOverdue', <String, String>{
                    'd': accidentShortDuration(now.difference(dueAt)),
                  }),
                  urgency: AccidentSlaUrgency.overdue,
                )
              : AccidentSlaSegment(
                  AccidentSlaSegmentKind.sla,
                  copy.fill('slaRemaining', <String, String>{
                    'd': accidentShortDuration(dueAt.difference(now)),
                  }),
                  urgency: AccidentSlaUrgency.running,
                ),
    },
  );
  return parts;
}

/// Pure line-2 composer (the segments joined with a middle dot).
String accidentSlaLine({
  required BuildContext context,
  required AccidentMockCopy copy,
  required AccidentSlaLoad load,
  required String workstreamKey,
  required String fallbackTeam,
  required DateTime now,
}) =>
    accidentSlaSegments(
      context: context,
      copy: copy,
      load: load,
      workstreamKey: workstreamKey,
      fallbackTeam: fallbackTeam,
      now: now,
    ).map((AccidentSlaSegment s) => s.text).join(' · ');
