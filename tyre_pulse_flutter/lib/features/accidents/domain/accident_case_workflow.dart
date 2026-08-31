/// Read-only accident-case workflow projections.
///
/// The mobile case repository currently returns one verified accident row and
/// the `accident_case_workstreams` ledger. This file deliberately projects
/// only those two sources. In particular it never derives route completion,
/// SLA deadlines, document approval, quotation state, purchase-order state or
/// email delivery from a nearby field: each of those has a dedicated backend
/// model and an absent read is still absent.
library;

import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';

/// A query-friendly view over one [AccidentCaseSnapshot].
///
/// Keeping lookup, ordering and active-owner selection out of widgets makes
/// the same truth rules apply to every tab on the case screen.
final class AccidentCaseWorkflowProjection {
  AccidentCaseWorkflowProjection(AccidentCaseSnapshot snapshot)
      : accident = snapshot.accident,
        provisioned = snapshot.provisioned,
        workstreams = snapshot.workstreams,
        _byKey = <String, AccidentWorkstream>{
          for (final AccidentWorkstream workstream in snapshot.workstreams)
            workstream.key: workstream,
        };

  final AccidentRecord accident;
  final bool provisioned;
  final List<AccidentWorkstream> workstreams;
  final Map<String, AccidentWorkstream> _byKey;

  AccidentWorkstream? workstream(String key) => _byKey[key];

  List<AccidentWorkstream> matching(Iterable<String> keys) =>
      List<AccidentWorkstream>.unmodifiable(
        keys.map((String key) => _byKey[key]).whereType<AccidentWorkstream>(),
      );

  /// The first explicit in-progress row, falling back to the first pending
  /// row. A completed or waived row is never presented as the current owner.
  AccidentWorkstream? get activeWorkstream {
    for (final AccidentWorkstream workstream in workstreams) {
      if (workstream.chip == AccidentWorkstreamChip.inProgress) {
        return workstream;
      }
    }
    for (final AccidentWorkstream workstream in workstreams) {
      if (workstream.chip == AccidentWorkstreamChip.pending) {
        return workstream;
      }
    }
    return null;
  }

  /// Latest recorded update per workstream, newest first.
  ///
  /// Undated rows are excluded instead of being assigned the incident date or
  /// the current time. Those substitutions would manufacture audit history.
  List<AccidentWorkstream> get datedUpdates {
    final List<AccidentWorkstream> dated = workstreams
        .where((AccidentWorkstream item) => item.updatedAt != null)
        .toList(growable: false);
    dated.sort(
      (AccidentWorkstream left, AccidentWorkstream right) =>
          right.updatedAt!.compareTo(left.updatedAt!),
    );
    return List<AccidentWorkstream>.unmodifiable(dated);
  }

  /// Route-based completion exactly as recorded by the server.
  ///
  /// The workstream list may be partial, so this must never count locally
  /// visible rows. Values outside the documented 0..100 percentage range are
  /// rejected as unavailable rather than clamped into a plausible KPI.
  double? get recordedCompletionPercent {
    final num? value = accident.completionOverall;
    if (value == null || !value.isFinite || value < 0 || value > 100) {
      return null;
    }
    return value.toDouble();
  }
}
