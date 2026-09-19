/// The two-line workstream header the M4/M5/M6 mocks share:
///
/// ```
/// Workstream 1 of 7: Fleet validation | Owner: Fleet
/// Received 14:35 · With Fleet 42m · SLA 1h 18m remaining
/// ```
///
/// Line 2 is read from `accident_sla_instances`; when no clock exists for the
/// workstream it says "No SLA started" rather than inventing one.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/features/accidents/data/accident_sla_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_mock_copy.dart';

class AccidentWorkstreamHeader extends ConsumerWidget {
  const AccidentWorkstreamHeader({
    required this.snapshot,
    required this.workstreamKey,
    this.now,
    super.key,
  });

  final AccidentCaseSnapshot snapshot;

  /// A `caseFlow` key such as `fleet_validation`.
  final String workstreamKey;

  /// Injected clock for deterministic tests. Production leaves it null.
  final DateTime? now;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AccidentMockCopy copy = AccidentMockCopy.of(context);
    final TpPalette palette = TpPalette.of(context);
    final NumberedStep? step = caseFlowStep(workstreamKey);
    final String stepLabel = step == null
        ? humaniseAccidentToken(workstreamKey)
        : copy.fill('workstreamOf', <String, String>{
            'n': '${step.n}',
            't': '${caseFlow.length}',
          });
    final String title = step?.label ?? humaniseAccidentToken(workstreamKey);
    final String owner = accidentWorkstreamOwner(
      copy,
      snapshot.workstreams,
      workstreamKey,
    );
    final AsyncValue<AccidentSlaLoad> sla =
        ref.watch(accidentSlaLoadProvider(snapshot.accident.id));

    final String line1 = '$stepLabel: $title | ${copy('ownerLabel')}: $owner';
    final String line2 = sla.when(
      data: (AccidentSlaLoad load) => accidentSlaLine(
        context: context,
        copy: copy,
        load: load,
        workstreamKey: workstreamKey,
        fallbackTeam: owner,
        now: now ?? DateTime.now(),
      ),
      loading: () => copy('checkingSla'),
      error: (Object error, StackTrace stackTrace) => copy('slaUnavailable'),
    );

    return Semantics(
      container: true,
      header: true,
      child: Column(
        key: const Key('accident.ws.header'),
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            line1,
            key: const Key('accident.ws.header.line1'),
            style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
          ),
          const SizedBox(height: TpSpace.xs),
          Text(
            line2,
            key: const Key('accident.ws.header.line2'),
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: palette.textSecondary,
                ),
          ),
        ],
      ),
    );
  }
}

/// Pure line-2 composer, exported for the header test.
String accidentSlaLine({
  required BuildContext context,
  required AccidentMockCopy copy,
  required AccidentSlaLoad load,
  required String workstreamKey,
  required String fallbackTeam,
  required DateTime now,
}) {
  if (!load.provisioned) return copy('slaNotProvisioned');
  final AccidentSlaInstance? clock = load.forWorkstream(workstreamKey);
  if (clock == null) return copy('noSla');

  final List<String> parts = <String>[];
  final DateTime? startAt = clock.startAt;
  if (startAt != null) {
    parts.add('${copy('received')} ${accidentClock(context, startAt)}');
    final String team = clock.team?.trim().isNotEmpty ?? false
        ? clock.team!.trim()
        : fallbackTeam;
    final Duration held = now.difference(startAt);
    parts.add(
      '${copy('withTeam')} $team '
      '${accidentShortDuration(held.isNegative ? Duration.zero : held)}',
    );
  }

  final DateTime? dueAt = clock.dueAt;
  parts.add(
    switch (clock.state) {
      'paused' => copy('slaPaused'),
      'met' => copy('slaMet'),
      'breached' => copy('slaBreached'),
      'cancelled' => copy('slaCancelled'),
      _ => dueAt == null
          ? copy('slaDueNotSet')
          : now.isAfter(dueAt)
              ? copy.fill('slaOverdue', <String, String>{
                  'd': accidentShortDuration(now.difference(dueAt)),
                })
              : copy.fill('slaRemaining', <String, String>{
                  'd': accidentShortDuration(dueAt.difference(now)),
                }),
    },
  );
  return parts.join(' · ');
}
