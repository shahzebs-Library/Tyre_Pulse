/// Where a serial search is, right now.
///
/// Kept in a pure file, with no Flutter and no Riverpod, so the state shape
/// is unit-testable without a widget binding - the same discipline
/// `workspace_state.dart` and `access_resolver.dart` already follow.
library;

import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_lookup_record.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_scrap_mark.dart';

/// The five states the production screen's own `SearchState` union names,
/// kept distinct rather than folded into the design system's generic seven:
/// [found] carries a RESULT the others do not, and [idle] is deliberately
/// separate from [empty] - "nothing searched yet" and "searched and found
/// nothing" are different facts about the world and must read differently.
enum SerialSearchPhase { idle, searching, found, empty, error }

/// Immutable state of the serial search screen.
final class SerialSearchState {
  const SerialSearchState({
    this.phase = SerialSearchPhase.idle,
    this.query = '',
    this.resolvedSerial,
    this.tyre,
    this.scrapMark,
    this.lastError,
    this.canScrap,
    this.canUnscrap,
    this.isScrapBusy = false,
    this.isUnscrapBusy = false,
  });

  final SerialSearchPhase phase;

  /// Whatever is currently in the search box. Kept in state, not only in a
  /// text controller, so a prefill from a scan hand-off survives independent
  /// of which widget currently owns the field.
  final String query;

  /// The sanitised code the last search actually ran against.
  ///
  /// Distinct from [query] on purpose: the box may hold a whole scanned URL
  /// while this holds the serial code extracted from it, and scrap/undo act
  /// on THIS value, never on the raw box contents.
  final String? resolvedSerial;

  final TyreLookupRecord? tyre;
  final ScrapMark? scrapMark;

  /// The reason the last action failed. Callers clear this at the start of
  /// the next attempt, so a stale failure can never linger over a fresh one.
  final AppError? lastError;

  /// Server-answered, tri-state. Null means "not yet asked" - the
  /// corresponding button stays hidden until this resolves to an explicit
  /// `true`, so an action is never offered before the server has actually
  /// said yes. See `tyre_lookup_repository.dart`.
  final bool? canScrap;
  final bool? canUnscrap;

  final bool isScrapBusy;
  final bool isUnscrapBusy;

  bool get isIdle => phase == SerialSearchPhase.idle;

  bool get isSearching => phase == SerialSearchPhase.searching;

  bool get isFound => phase == SerialSearchPhase.found && tyre != null;

  bool get isEmptyResult => phase == SerialSearchPhase.empty;

  bool get isError => phase == SerialSearchPhase.error;

  bool get isScrapped => scrapMark != null;

  /// Whether the Mark-as-scrap action should be offered at all. Requires an
  /// explicit `true` from the server, not merely "not yet known to be false".
  bool get offerScrap => isFound && !isScrapped && canScrap == true;

  /// Whether the Undo-scrap action should be offered at all.
  bool get offerUnscrap => isFound && isScrapped && canUnscrap == true;

  SerialSearchState copyWith({
    SerialSearchPhase? phase,
    String? query,
    String? resolvedSerial,
    bool clearResolvedSerial = false,
    TyreLookupRecord? tyre,
    bool clearTyre = false,
    ScrapMark? scrapMark,
    bool clearScrapMark = false,
    AppError? lastError,
    bool clearError = false,
    bool? canScrap,
    bool? canUnscrap,
    bool? isScrapBusy,
    bool? isUnscrapBusy,
  }) => SerialSearchState(
    phase: phase ?? this.phase,
    query: query ?? this.query,
    resolvedSerial: clearResolvedSerial
        ? null
        : (resolvedSerial ?? this.resolvedSerial),
    tyre: clearTyre ? null : (tyre ?? this.tyre),
    scrapMark: clearScrapMark ? null : (scrapMark ?? this.scrapMark),
    lastError: clearError ? null : (lastError ?? this.lastError),
    canScrap: canScrap ?? this.canScrap,
    canUnscrap: canUnscrap ?? this.canUnscrap,
    isScrapBusy: isScrapBusy ?? this.isScrapBusy,
    isUnscrapBusy: isUnscrapBusy ?? this.isUnscrapBusy,
  );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SerialSearchState &&
          other.phase == phase &&
          other.query == query &&
          other.resolvedSerial == resolvedSerial &&
          other.tyre == tyre &&
          other.scrapMark == scrapMark &&
          other.lastError == lastError &&
          other.canScrap == canScrap &&
          other.canUnscrap == canUnscrap &&
          other.isScrapBusy == isScrapBusy &&
          other.isUnscrapBusy == isUnscrapBusy;

  @override
  int get hashCode => Object.hash(
    phase,
    query,
    resolvedSerial,
    tyre,
    scrapMark,
    lastError,
    canScrap,
    canUnscrap,
    isScrapBusy,
    isUnscrapBusy,
  );

  @override
  String toString() =>
      'SerialSearchState(phase: ${phase.name}, serial: $resolvedSerial, '
      'scrapped: $isScrapped)';
}
