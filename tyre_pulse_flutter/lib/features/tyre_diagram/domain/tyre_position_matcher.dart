/// Places a caller-supplied set of positions onto a layout's wheel slots.
///
/// Ported from `matchPositionsToLayout` in
/// `mobile/lib/tyreDiagramLayouts.ts:491-549`, per
/// `docs/flutter-migration/07-tyre-layout-parity-tests.md` section 5 group
/// F. This is what lets ONE diagram accept EITHER position vocabulary (V1
/// diagram ids or V3 `types.ts` ids) without the renderer needing to know
/// which one a particular caller happened to write.
///
/// Renders only wheels the caller's position set actually names: no ghost
/// slots for positions the layout does not define, and no extra layout
/// axles invented for positions the vehicle does not carry. A position the
/// layout has no slot for (`Spare`, an unrecognised token) is SKIPPED, never
/// forced onto some other wheel. If NOTHING in the caller's list matches
/// anything (a fully foreign vocabulary), the WHOLE layout is returned
/// unmatched-but-complete, so the diagram is never blank.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_position_struct.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_slot.dart';

/// One rendered wheel: a layout's geometry, carrying the CALLER's own
/// position spelling as [positionId].
///
/// [positionId] is deliberately NOT always equal to [id]: it is the exact
/// string the caller passed in (whatever vocabulary or casing it used),
/// because that string is the key the tyre data was actually read or
/// written under. Rendering the wrong id here would draw the correct wheel
/// in the correct place while silently reading/writing the wrong storage
/// key - artifact test 55 is what pins this.
@immutable
class MatchedTyreSlot {
  const MatchedTyreSlot({
    required this.id,
    required this.x,
    required this.y,
    required this.w,
    required this.h,
    required this.positionId,
  });

  factory MatchedTyreSlot._fromSlot(TyreSlot slot, String positionId) {
    return MatchedTyreSlot(
      id: slot.id,
      x: slot.x,
      y: slot.y,
      w: slot.w,
      h: slot.h,
      positionId: positionId,
    );
  }

  final String id;
  final double x;
  final double y;
  final double w;
  final double h;

  /// The caller's own spelling of this position - the tyre-data storage
  /// key. Equal to [id] only when the caller passed the layout's own id
  /// (or nothing at all).
  final String positionId;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is MatchedTyreSlot &&
          other.id == id &&
          other.x == x &&
          other.y == y &&
          other.w == w &&
          other.h == h &&
          other.positionId == positionId);

  @override
  int get hashCode => Object.hash(id, x, y, w, h, positionId);

  @override
  String toString() => 'MatchedTyreSlot(id: $id, positionId: $positionId)';
}

class _Candidate {
  _Candidate(this.tyre) : struct = parsePositionStruct(tyre.id);

  final TyreSlot tyre;
  final PositionStruct struct;
  bool used = false;
}

String _rowKey(PositionStruct s) => '${s.kind.name}:${s.axle}';

/// `role` search order for a wanted role: the wanted role first, then the
/// two alternates, closest fit first. Mirrors `roleOrder` verbatim.
List<PositionRole> _roleSearchOrder(PositionRole want) {
  switch (want) {
    case PositionRole.single:
      return const <PositionRole>[
        PositionRole.single,
        PositionRole.outer,
        PositionRole.inner,
      ];
    case PositionRole.outer:
      return const <PositionRole>[
        PositionRole.outer,
        PositionRole.single,
        PositionRole.inner,
      ];
    case PositionRole.inner:
      return const <PositionRole>[
        PositionRole.inner,
        PositionRole.single,
        PositionRole.outer,
      ];
  }
}

_Candidate? _firstUnused(
  Iterable<_Candidate> candidates,
  bool Function(_Candidate) test,
) {
  for (final _Candidate c in candidates) {
    if (!c.used && test(c)) return c;
  }
  return null;
}

/// Matches [positions] onto [layout]'s wheel slots.
///
/// `positions == null` or empty returns every slot in [layout], each
/// carrying its own [TyreSlot.id] as [MatchedTyreSlot.positionId] (artifact
/// test 53) - this is the "diagramPositions() called this" fast path.
List<MatchedTyreSlot> matchPositionsToLayout(
  DiagramLayout layout,
  List<String>? positions,
) {
  final List<MatchedTyreSlot> all = <MatchedTyreSlot>[
    for (final TyreSlot t in layout.tyres)
      MatchedTyreSlot._fromSlot(t, t.id),
  ];

  final List<String> list = (positions ?? const <String>[])
      .map((String p) => p.trim())
      .where((String s) => s.isNotEmpty)
      .toList();
  if (list.isEmpty) return all;

  final List<_Candidate> slots = <_Candidate>[
    for (final TyreSlot t in layout.tyres) _Candidate(t),
  ];

  // Overall axle rows (front -> back), for generic Axle/lift ordinal
  // matching further down. Built by scanning the slots sorted by `y`, so a
  // row is discovered in visual front-to-back order regardless of how the
  // layout happened to declare them (though for every production layout
  // declaration order already agrees with `y` order - invariant 89).
  final List<_Candidate> byY = List<_Candidate>.of(slots)
    ..sort((_Candidate a, _Candidate b) => a.tyre.y.compareTo(b.tyre.y));
  final List<String> rowKeys = <String>[];
  for (final _Candidate c in byY) {
    final String key = _rowKey(c.struct);
    if (!rowKeys.contains(key)) rowKeys.add(key);
  }

  final List<MatchedTyreSlot> matched = <MatchedTyreSlot>[];
  for (final String pos in list) {
    // 1. Exact id match (fast path - covers diagramPositions() callers).
    final _Candidate? exact = _firstUnused(
      slots,
      (_Candidate c) => c.tyre.id.toUpperCase() == pos.toUpperCase(),
    );
    if (exact != null) {
      exact.used = true;
      matched.add(MatchedTyreSlot._fromSlot(exact.tyre, pos));
      continue;
    }

    final PositionStruct ps = parsePositionStruct(pos);
    if (ps.kind == PositionKind.spare || ps.kind == PositionKind.unknown) {
      continue;
    }

    _Candidate? slot;
    if (ps.kind == PositionKind.steer || ps.kind == PositionKind.drive) {
      // 2. Structural match: same kind + side + axle, closest wheel role.
      for (final PositionRole role in _roleSearchOrder(ps.role)) {
        slot = _firstUnused(
          slots,
          (_Candidate c) =>
              c.struct.kind == ps.kind &&
              c.struct.side == ps.side &&
              c.struct.axle == ps.axle &&
              c.struct.role == role,
        );
        if (slot != null) break;
      }
    } else {
      // 3. Generic axle / lift ordinal -> Nth axle row, side-matched.
      final int rowIndex = ps.axle - 1;
      if (rowIndex >= 0 && rowIndex < rowKeys.length) {
        final String key = rowKeys[rowIndex];
        final List<_Candidate> rowSlots = <_Candidate>[];
        for (final _Candidate c in slots) {
          final bool sameSide = c.struct.side == ps.side ||
              c.struct.side == null;
          if (!c.used && _rowKey(c.struct) == key && sameSide) {
            rowSlots.add(c);
          }
        }
        rowSlots.sort(
          (_Candidate a, _Candidate b) => a.tyre.x.compareTo(b.tyre.x),
        );
        if (rowSlots.isNotEmpty) {
          slot = ps.side == PositionSide.right
              ? rowSlots.last
              : rowSlots.first;
        }
      }
    }

    if (slot != null) {
      slot.used = true;
      matched.add(MatchedTyreSlot._fromSlot(slot.tyre, pos));
    }
  }

  // Fully foreign vocabulary: return the whole layout rather than a blank
  // diagram (artifact test 59).
  if (matched.isEmpty) return all;

  matched.sort((MatchedTyreSlot a, MatchedTyreSlot b) {
    final int byRow = a.y.compareTo(b.y);
    if (byRow != 0) return byRow;
    return a.x.compareTo(b.x);
  });
  return matched;
}
