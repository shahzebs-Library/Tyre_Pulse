/// Coarse categories a sync failure is reported under.
///
/// Spec section 59: telemetry must capture "sync failure categories" as a
/// signal distinct from a raw exception, because a category is what shows up
/// on a dashboard - counted, trended, alerted on - while a stack trace is
/// read one incident at a time. This enum names the categories a caller with
/// an already-classified failure (the offline queue in `core/sync`, a
/// repository, this module's own crash hooks) can report against.
///
/// Kept deliberately narrow rather than speculative: every value here is a
/// direct restatement of an outcome [AppErrorKind] or
/// `SupabaseFailureCause` already distinguishes, via [fromAppErrorKind]. A
/// caller with a classified [AppError] never has to invent a second
/// judgement about what kind of sync failure this is - it already made that
/// judgement once, in `supabase_error_mapper.dart`, and this reuses it.
///
/// Pure Dart. Depends only on [AppErrorKind], so it is testable, and usable
/// by `core/sync`, without either side needing the Sentry SDK.
library;

import 'package:tyre_pulse/core/errors/app_error.dart';

/// What kind of thing stopped a queued write from reaching the server.
enum TelemetrySyncFailureCategory {
  /// The write never reached the server at all. [AppErrorKind.network].
  connectivity,

  /// The server was reached and refused the write on purpose: row-level
  /// security, a CHECK constraint, a missing relation, a server-side guard.
  /// [AppErrorKind.authorization], [AppErrorKind.validation] and
  /// [AppErrorKind.server] all land here - each is a case where nothing
  /// about retrying THIS request unchanged is expected to help.
  rejected,

  /// The server holds a newer version of the record than the one being
  /// synced. [AppErrorKind.conflict].
  conflict,

  /// The write was captured locally but the secure or local store could not
  /// persist it, or could not be read back to confirm it. [AppErrorKind.storage].
  localPersistence,

  /// The session was gone or was rejected by the server.
  /// [AppErrorKind.authentication].
  sessionExpired,

  /// Nothing above explains it. Also where [AppErrorKind.sync] itself lands:
  /// that kind exists for a sync-lane failure with no more specific reason
  /// than "sync failed", which is exactly what this category means.
  unknown;

  /// Derives the category from an already-classified [AppErrorKind].
  ///
  /// A caller that already holds an [AppError] - which is every caller in
  /// this codebase, since a raw exception is never allowed to escape past
  /// `supabase_error_mapper.dart` - should use this rather than inventing a
  /// second mapping from a driver exception.
  static TelemetrySyncFailureCategory fromAppErrorKind(AppErrorKind kind) {
    switch (kind) {
      case AppErrorKind.network:
        return TelemetrySyncFailureCategory.connectivity;
      case AppErrorKind.authorization:
      case AppErrorKind.validation:
      case AppErrorKind.server:
        return TelemetrySyncFailureCategory.rejected;
      case AppErrorKind.conflict:
        return TelemetrySyncFailureCategory.conflict;
      case AppErrorKind.storage:
        return TelemetrySyncFailureCategory.localPersistence;
      case AppErrorKind.authentication:
        return TelemetrySyncFailureCategory.sessionExpired;
      case AppErrorKind.sync:
      case AppErrorKind.unknown:
        return TelemetrySyncFailureCategory.unknown;
    }
  }
}
