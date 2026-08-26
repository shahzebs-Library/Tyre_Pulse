/// The one place a raw Supabase exception is allowed to exist for longer than
/// one statement.
///
/// # Why this file exists
///
/// `supabase_error_mapper.dart` already decides, once, what a
/// `PostgrestException`, an `AuthException`, a `StorageException` or a plain
/// connectivity failure MEANS. Without something like this class, every
/// repository would still have to remember to write its own
/// `try { ... } on Object catch (error) { throw classifySupabaseError(error); }`
/// around every remote call - the exact per-module drift `AGENTS.md` rule 5
/// and the mapper's own library comment both warn about: ~150 web service
/// modules and every mobile screen once did this independently, and the wrong
/// message reached a user often enough that it is recorded as the reason the
/// mapper exists at all.
///
/// # Deliberately narrow
///
/// Spec section 64: do not add a package or an abstraction to shorten five
/// lines. This file adds exactly one method, [SupabaseGateway.guard],
/// because that is what its two immediate callers need:
///
/// - the sync engine, to run a queued write and branch on
///   `SupabaseFailure.isIdempotentReplay` before deciding whether a 23505 on
///   a retried command means the earlier attempt already landed;
/// - the auth lane, to turn `signInWithPassword`, `signOut` and session
///   refresh failures into an `AppError` a screen can show, without each of
///   those call sites writing its own catch block.
///
/// It is deliberately NOT a query builder, a caching layer, a retry
/// scheduler, or an RPC-name-and-params helper. A repository still calls
/// `.from(table)`, `.select()`, `.rpc(name, params: ...)` directly on the
/// `SupabaseClient` it holds - `guard` only wraps the `Future` that call
/// produces. Retry policy belongs to the caller (the sync engine's own queue
/// already has one, described in artifact 06, and it is a different policy
/// from a plain UI read's retry policy); folding a second one in here would
/// be a decision this file has no business making.
///
/// # How to use it
///
/// ```dart
/// class TyreRecordsRepository with SupabaseGateway {
///   TyreRecordsRepository(this._client);
///
///   final SupabaseClient _client;
///
///   Future<List<Map<String, Object?>>> forAsset(String assetNo) => guard(
///         () => _client
///             .from(SupabaseTables.tyreRecords)
///             .select()
///             .eq('asset_no', assetNo),
///       );
/// }
/// ```
///
/// A [SupabaseGateway] repository catches [SupabaseFailure] where the
/// decision differs by cause, and lets it propagate everywhere else - it is
/// already an [AppError]-carrying exception with a message safe to show, so a
/// screen that only needs to display something needs no catch at all.
library;

import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';

/// Mixed in or extended by a repository that talks to Supabase.
///
/// Declared as a `mixin class` so a repository that already extends some
/// other base class can `with SupabaseGateway`, and one that does not can
/// `extends SupabaseGateway` just as well - both compile against the exact
/// same declaration, so there is only one implementation to keep correct.
mixin class SupabaseGateway {
  /// Runs [call] and reclassifies whatever it throws through
  /// [classifySupabaseError], so a repository never writes its own
  /// try/catch around a raw Supabase exception.
  ///
  /// On success, returns [call]'s result unchanged - nothing here inspects or
  /// transforms it. On failure, throws the [SupabaseFailure]
  /// [classifySupabaseError] produced for that error, never the original
  /// exception, with the original stack trace preserved via
  /// [Error.throwWithStackTrace] so telemetry still points at the real call
  /// site. A caller that needs to branch on the CAUSE - not just show
  /// something - catches [SupabaseFailure] and reads
  /// `.isIdempotentReplay`, `.isSchemaMismatch`, `.isPermissionDenied`,
  /// `.isNoRowsFound`, `.isRangeExhausted` or `.isConnectivity` rather than
  /// re-deriving any of that from the raw error itself.
  ///
  /// Never throws anything OTHER than a [SupabaseFailure]:
  /// [classifySupabaseError] is documented never to throw while classifying,
  /// including for an error it does not recognise, which becomes
  /// `SupabaseFailureCause.unknown` with a generic user-facing message rather
  /// than propagating unclassified.
  Future<T> guard<T>(Future<T> Function() call) async {
    try {
      return await call();
    } on Object catch (error, stackTrace) {
      Error.throwWithStackTrace(classifySupabaseError(error), stackTrace);
    }
  }
}
