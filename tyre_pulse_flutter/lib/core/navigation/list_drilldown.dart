/// A one-shot "open this list already filtered" request.
///
/// A Home count tile ("Off road 30") must open its list showing exactly the
/// records it counted - not the whole register with the filter left for the
/// user to find. The typed routes carry no filter parameter (and the router
/// wiring files are not edited from feature code), so the tile records the
/// request here immediately before navigating and the destination consumes
/// it exactly once.
///
/// Two kinds of destination exist:
///
/// * a PUSHED screen (fleet list, maintenance) is built fresh each time, so
///   it consumes in `initState` via [ListDrilldownController.take];
/// * a SHELL BRANCH root (the accident register sits in the indexed-stack
///   shell) is built once and kept alive, so `initState` runs on the first
///   visit only. It must also observe requests made while it is mounted:
///   [ListDrilldownController.watch] registers a manual listener that fires
///   immediately (a request made before the first build) and on every later
///   request.
///
/// No request can survive: consuming clears it, and a request nobody
/// consumes expires after [kListDrilldownTtl], so a later NORMAL visit is
/// never pre-filtered by a stale tap.
library;

import 'dart:async';

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

/// How long an unconsumed request stays valid. Navigation completes within a
/// frame or two; anything older is a leftover and is ignored and cleared.
const Duration kListDrilldownTtl = Duration(seconds: 5);

/// One pending request. Compared by identity, never by value, so two taps of
/// the same tile are two distinct requests.
final class ListDrilldownRequest {
  ListDrilldownRequest(this.kind, this.at);

  final ListDrilldown kind;
  final DateTime at;
}

/// The clock requests are stamped and expired against. Overridden in tests.
final Provider<DateTime Function()> listDrilldownClockProvider =
    Provider<DateTime Function()>((Ref ref) => DateTime.now);

final NotifierProvider<ListDrilldownController, ListDrilldownRequest?>
    listDrilldownProvider =
    NotifierProvider<ListDrilldownController, ListDrilldownRequest?>(
  ListDrilldownController.new,
);

final class ListDrilldownController extends Notifier<ListDrilldownRequest?> {
  ListDrilldownRequest? _consumed;

  @override
  ListDrilldownRequest? build() => null;

  DateTime _now() => ref.read(listDrilldownClockProvider)();

  /// Records [kind] for the destination the caller is about to open. Call
  /// from a tap handler, never during build.
  void request(ListDrilldown kind) {
    state = ListDrilldownRequest(kind, _now());
  }

  /// Consumes the pending request when it is a fresh, unconsumed [kind].
  ///
  /// Safe to call from `initState` or a listener: the request is marked
  /// consumed at once (a second take returns false) and the provider is
  /// cleared in a microtask, so it never notifies while the tree builds. A
  /// stale request of any kind is cleared the same way.
  bool take(ListDrilldown kind) {
    final ListDrilldownRequest? r = state;
    if (r == null || identical(r, _consumed)) return false;
    final bool stale = _now().difference(r.at) > kListDrilldownTtl;
    final bool ok = !stale && r.kind == kind;
    if (ok) _consumed = r;
    if (ok || stale) {
      scheduleMicrotask(() {
        if (identical(state, r)) state = null;
      });
    }
    return ok;
  }

  /// For a destination that stays mounted (a shell branch root): calls
  /// [onRequest] for a fresh [kind] request already pending now and for
  /// every later one, consuming each. Call from `initState`; close the
  /// returned subscription in `dispose`.
  static ProviderSubscription<ListDrilldownRequest?> watch(
    WidgetRef ref,
    ListDrilldown kind,
    void Function() onRequest,
  ) =>
      ref.listenManual<ListDrilldownRequest?>(
        listDrilldownProvider,
        (ListDrilldownRequest? _, ListDrilldownRequest? next) {
          if (next == null) return;
          if (ref.read(listDrilldownProvider.notifier).take(kind)) {
            onRequest();
          }
        },
        fireImmediately: true,
      );
}
