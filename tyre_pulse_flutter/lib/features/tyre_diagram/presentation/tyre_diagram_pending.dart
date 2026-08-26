/// What the diagram still needs filled in.
///
/// Mirrors the RN renderer's `PendingInput` union
/// (`TyreCompletenessResult | string[] | Set<string> | null | undefined`,
/// `mobile/components/VehicleTyreDiagram.tsx:44`) per
/// `docs/flutter-migration/07-tyre-layout-parity-tests.md` section 7.2,
/// which the artifact praises for "correctly accepting a result object, an
/// array or a Set". Dart has no native union type, so a caller picks the
/// matching named constructor instead of the widget runtime-switching on an
/// `Object?` - the same three shapes, made explicit rather than inferred.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_completeness.dart';

/// Which wheels are outstanding, from whichever source the caller holds.
@immutable
sealed class TyreDiagramPending {
  const TyreDiagramPending();

  /// Built from a full [TyreCompletenessResult] - the recommended source,
  /// since it also carries each slot's reason.
  const factory TyreDiagramPending.fromCompleteness(
    TyreCompletenessResult result,
  ) = _CompletenessPending;

  /// Built from a bare list of position ids or codes. A `Set<String>`
  /// satisfies `Iterable<String>` too, so this single constructor covers
  /// both the list and Set shapes the RN union offers.
  const factory TyreDiagramPending.fromKeys(Iterable<String> keys) =
      _KeyListPending;

  /// Nothing outstanding.
  static const TyreDiagramPending none = _KeyListPending(<String>[]);

  /// Normalised comparison keys (via [keyOf]) of every wheel still pending.
  /// Compare a slot's `id` and `positionId` against this set using [keyOf]
  /// on each - never compare a raw, un-normalised string.
  Set<String> resolveKeys();
}

final class _CompletenessPending extends TyreDiagramPending {
  const _CompletenessPending(this.result);

  final TyreCompletenessResult result;

  @override
  Set<String> resolveKeys() {
    final Set<String> out = <String>{};
    for (final TyreSlotStatus s in result.slots) {
      if (s.state == TyreSlotState.complete) continue;
      out.add(keyOf(s.slot));
      if (s.code.isNotEmpty) out.add(keyOf(s.code));
    }
    return out;
  }
}

final class _KeyListPending extends TyreDiagramPending {
  const _KeyListPending(this.keys);

  final Iterable<String> keys;

  @override
  Set<String> resolveKeys() {
    final Set<String> out = <String>{};
    for (final String k in keys) {
      final String normalised = keyOf(k);
      if (normalised.isNotEmpty) out.add(normalised);
    }
    return out;
  }
}
