/// Coverage for [computeTyreDiagramStats] - the Total/OK/Monitor/Critical
/// counts shown above the vehicle layout board.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_stats.dart';

void main() {
  test('an empty position list is a zero total with nothing else counted', () {
    final TyreDiagramStats stats = computeTyreDiagramStats(
      const <String>[],
      const <String, Map<String, Object?>>{},
    );
    expect(stats.total, 0);
    expect(stats.ok, 0);
    expect(stats.monitor, 0);
    expect(stats.critical, 0);
    expect(stats.unrecorded, 0);
  });

  test('a position with no entry at all counts as unrecorded, never OK', () {
    final TyreDiagramStats stats = computeTyreDiagramStats(
      const <String>['FL', 'FR'],
      const <String, Map<String, Object?>>{},
    );
    expect(stats.total, 2);
    expect(stats.unrecorded, 2);
    expect(stats.ok, 0);
  });

  test(
      'Good sorts into OK, Worn and Flat into Monitor, Damaged and '
      'Puncture into Critical - the same bands the diagram itself colours '
      'a wheel by', () {
    final TyreDiagramStats stats = computeTyreDiagramStats(
      const <String>['A', 'B', 'C', 'D', 'E'],
      const <String, Map<String, Object?>>{
        'A': <String, Object?>{'condition': 'Good', 'checked': true},
        'B': <String, Object?>{'condition': 'Worn'},
        'C': <String, Object?>{'condition': 'Flat'},
        'D': <String, Object?>{'condition': 'Damaged'},
        'E': <String, Object?>{'condition': 'Puncture'},
      },
    );
    expect(stats.total, 5);
    expect(stats.ok, 1);
    expect(stats.monitor, 2);
    expect(stats.critical, 2);
    expect(stats.unrecorded, 0);
  });

  test('a seeded unchecked Good entry is unrecorded, never an OK result', () {
    final TyreDiagramStats stats = computeTyreDiagramStats(
      const <String>['A'],
      const <String, Map<String, Object?>>{
        'A': <String, Object?>{'condition': 'Good', 'checked': false},
      },
    );
    expect(stats.unrecorded, 1);
    expect(stats.ok, 0);
    expect(stats.monitor, 0);
    expect(stats.critical, 0);
  });

  test('Missing condition counts as unrecorded, matching TpStatus.unknown', () {
    final TyreDiagramStats stats = computeTyreDiagramStats(
      const <String>['A'],
      const <String, Map<String, Object?>>{
        'A': <String, Object?>{'condition': 'Missing'},
      },
    );
    expect(stats.unrecorded, 1);
    expect(stats.ok + stats.monitor + stats.critical, 0);
  });

  test('every position is counted exactly once, across every band', () {
    final TyreDiagramStats stats = computeTyreDiagramStats(
      const <String>['A', 'B', 'C', 'D'],
      const <String, Map<String, Object?>>{
        'A': <String, Object?>{'condition': 'Good', 'checked': true},
        'B': <String, Object?>{'condition': 'Damaged'},
      },
    );
    expect(
      stats.ok + stats.monitor + stats.critical + stats.unrecorded,
      stats.total,
    );
  });

  test('value equality holds for two structurally identical results', () {
    const TyreDiagramStats a = TyreDiagramStats(
      total: 4,
      ok: 2,
      monitor: 1,
      critical: 1,
      unrecorded: 0,
    );
    const TyreDiagramStats b = TyreDiagramStats(
      total: 4,
      ok: 2,
      monitor: 1,
      critical: 1,
      unrecorded: 0,
    );
    expect(a, b);
    expect(a.hashCode, b.hashCode);
  });
}
