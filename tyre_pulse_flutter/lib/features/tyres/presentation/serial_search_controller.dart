/// Drives the serial search screen: search, clear, mark scrap, undo scrap.
///
/// ONLINE-ONLY BY DESIGN. Marking or undoing a scrap changes what the whole
/// fleet sees as a tyre's status and, on undo, what it is recorded as fitted
/// in - a hard-to-reverse safety action that must never silently queue while
/// the button reads as though it worked. Every method here either completes
/// against the live server or leaves the failure in
/// [SerialSearchState.lastError]; none of them writes to the offline
/// command queue, and none should ever be made to.
///
/// Kept as a thin orchestration layer over [TyreLookupRepository]: state
/// transitions and busy flags live here, but the "ask permission, then make
/// exactly one write" invariant for scrap/undo lives in the repository - see
/// that file's library comment - and is not re-implemented here.
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/tyres/data/tyre_lookup_repository.dart';
import 'package:tyre_pulse/features/tyres/domain/serial_search_state.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_lookup_record.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_scrap_mark.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_serial_code.dart';
import 'package:tyre_pulse/features/tyres/presentation/serial_search_deps.dart';

class SerialSearchController extends Notifier<SerialSearchState> {
  @override
  SerialSearchState build() {
    // Fired once on first read of this provider. Kicking it off here, rather
    // than requiring the screen to remember to call it, is what makes
    // `canScrap`/`canUnscrap` correct even for a caller that never explicitly
    // asks - matching the production screen's own mount-time `useEffect`.
    unawaited(_loadPermissions());
    return const SerialSearchState();
  }

  Future<void> _loadPermissions() async {
    final TyreLookupRepository repository = ref.read(
      tyreLookupRepositoryProvider,
    );
    final bool scrapAllowed = await repository.canScrap();
    state = state.copyWith(canScrap: scrapAllowed);
    final bool unscrapAllowed = await repository.canUnscrap();
    state = state.copyWith(canUnscrap: unscrapAllowed);
  }

  /// Keeps [SerialSearchState.query] in step with whatever is in the box, so
  /// [search] can be called with no argument later and still know what to
  /// search for.
  void setQuery(String value) {
    state = state.copyWith(query: value);
  }

  /// Runs a search. Reads [SerialSearchState.query] when [raw] is omitted,
  /// so the search button and the keyboard's search action can share one
  /// call site.
  ///
  /// A [raw] that sanitises to an empty code is a no-op - matching the
  /// production screen, which does nothing rather than searching for
  /// nothing - so whatever result is already on screen is left untouched.
  Future<void> search([String? raw]) async {
    if (state.isSearching) return;

    final String source = raw ?? state.query;
    final String code = sanitizeSerial(extractScanCode(source));
    if (code.isEmpty) return;

    state = state.copyWith(
      phase: SerialSearchPhase.searching,
      query: source,
      resolvedSerial: code,
      clearTyre: true,
      clearScrapMark: true,
      clearError: true,
    );

    final TyreLookupRepository repository = ref.read(
      tyreLookupRepositoryProvider,
    );
    try {
      final TyreLookupRecord? found = await repository.lookupBySerial(code);
      if (found == null) {
        state = state.copyWith(phase: SerialSearchPhase.empty);
        return;
      }

      // Best-effort: a status lookup that fails must never hide an
      // otherwise-successful result. Mirrors the production screen.
      ScrapMark? mark;
      try {
        mark = await repository.getScrapMark(code);
      } on Object {
        mark = null;
      }

      state = state.copyWith(
        phase: SerialSearchPhase.found,
        tyre: found,
        scrapMark: mark,
      );
    } on Object catch (error) {
      state = state.copyWith(
        phase: SerialSearchPhase.error,
        lastError: mapSupabaseError(error),
      );
    }
  }

  /// Returns the screen to its starting state: empty box, no result.
  void clear() {
    state = const SerialSearchState();
  }

  /// Marks the tyre currently shown as scrapped, recording [reason].
  ///
  /// A no-op when nothing is resolved, or an action is already in flight -
  /// matching the production screen's own guard against a double press.
  /// EXACTLY ONE mutating request reaches the server, and only after the
  /// server has confirmed the caller may make it; see
  /// [TyreLookupRepository.scrapBySerial].
  Future<void> confirmScrap({String? reason}) async {
    final String? serial = state.resolvedSerial;
    if (serial == null || serial.isEmpty || state.isScrapBusy) return;

    state = state.copyWith(isScrapBusy: true, clearError: true);
    final TyreLookupRepository repository = ref.read(
      tyreLookupRepositoryProvider,
    );
    try {
      await repository.scrapBySerial(serial, reason: reason);

      ScrapMark? mark;
      try {
        mark = await repository.getScrapMark(serial);
      } on Object {
        mark = null;
      }

      state = state.copyWith(isScrapBusy: false, scrapMark: mark);
    } on Object catch (error) {
      state = state.copyWith(
        isScrapBusy: false,
        lastError: mapSupabaseError(error),
      );
    }
  }

  /// Undoes the scrap mark on the tyre currently shown.
  Future<void> undoScrap() async {
    final String? serial = state.resolvedSerial;
    if (serial == null || serial.isEmpty || state.isUnscrapBusy) return;

    state = state.copyWith(isUnscrapBusy: true, clearError: true);
    final TyreLookupRepository repository = ref.read(
      tyreLookupRepositoryProvider,
    );
    try {
      await repository.unscrapBySerial(serial);
      state = state.copyWith(isUnscrapBusy: false, clearScrapMark: true);
    } on Object catch (error) {
      state = state.copyWith(
        isUnscrapBusy: false,
        lastError: mapSupabaseError(error),
      );
    }
  }
}

/// Serial search screen state and actions.
final NotifierProvider<SerialSearchController, SerialSearchState>
serialSearchControllerProvider =
    NotifierProvider<SerialSearchController, SerialSearchState>(
      SerialSearchController.new,
    );
