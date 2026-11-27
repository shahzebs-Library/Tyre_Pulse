/// A one-shot "open this list already filtered" request.
///
/// A Home count tile ("Off road 30") must open its list showing exactly the
/// records it counted - not the whole register with the filter left for the
/// user to find. The typed routes carry no filter parameter (and the router
/// wiring files are not edited from feature code), so the tile records the
/// filter here immediately before navigating and the destination screen
/// TAKES it once, in `initState`.
///
/// A plain mutable box rather than a notifier on purpose: nothing listens to
/// it, and taking it from `initState` must not mutate provider state while
/// the tree is building. A request the destination never takes is harmless:
/// it is overwritten by the next tile tap and only ever matches its own kind.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The filtered list a Home tile can open.
enum ListDrilldown {
  /// Fleet register: `ops_status = 'breakdown'`.
  offRoad,

  /// Accident register: the Open status filter.
  openAccidents,

  /// Maintenance plans: overdue plans only.
  maintenanceOverdue,
}

/// Holds at most one pending [ListDrilldown].
final class ListDrilldownBox {
  ListDrilldown? _pending;

  /// Records [kind] for the next screen that takes it.
  void request(ListDrilldown kind) => _pending = kind;

  /// True (and clears the request) when the pending request is [kind].
  bool take(ListDrilldown kind) {
    if (_pending != kind) return false;
    _pending = null;
    return true;
  }
}

final Provider<ListDrilldownBox> listDrilldownProvider =
    Provider<ListDrilldownBox>((Ref ref) => ListDrilldownBox());
