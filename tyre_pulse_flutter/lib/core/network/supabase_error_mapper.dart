/// Turns anything a Supabase call can throw into a typed [AppError].
///
/// # The rule this file enforces
///
/// Spec section 57: **a user must never see `PostgrestException PGRST116`.**
/// Postgres error text names constraints, columns, relations and RLS policies.
/// A screen that renders it verbatim is showing a field technician the internals
/// of the database. So the user-facing sentence is decided HERE, once, and the
/// untouched original travels on [AppError.technical] and [AppError.cause] for
/// telemetry only.
///
/// This is the Dart counterpart of `mobile/lib/safeError.ts` and of the
/// `unwrap` / `isMissingRelation` pair in `src/lib/api/_client.js`. Both of
/// those exist because the same mistake was made twice: ~150 web service
/// modules each sniffing `err.message`, and every mobile screen rendering a raw
/// `err.message` into an `Alert`.
///
/// # Why a classification, and not just a message
///
/// Three failures need a caller to be able to tell them apart, and a sentence
/// cannot carry that:
///
/// 1. **23505 on an idempotent replay is usually SUCCESS.** Artifact 06 section
///    1: every queued command is idempotent and upserts on a stable
///    `client_uuid`. A lost response followed by a retry is the NORMAL path, and
///    the second attempt colliding with the row the first attempt actually
///    wrote means the work is safe, not lost. A queue that treats that as a
///    failure retries forever and eventually marks a technician's real work
///    `failed`. [SupabaseFailure.isIdempotentReplay] is what lets the queue
///    decide.
/// 2. **PGRST116 is not an empty list.** It is `.single()` finding no row where
///    exactly one was required. An empty list is a legitimate answer about the
///    world; PGRST116 is a statement that a specific record is not there. Fold
///    them together and "this asset does not exist" becomes indistinguishable
///    from "this asset has no tyres".
/// 3. **A missing relation or unknown column must be LOUD.** Artifact 01
///    records that a column PostgREST cannot find fails the WHOLE request, and
///    that a failed read must never render as an empty result - a fleet count
///    that under-counted every site rollup looked right and was wrong. So a
///    42P01 / 42703 / PGRST204 becomes a real error with
///    [SupabaseFailure.isSchemaMismatch] set, never a quiet `[]`.
///
/// # Deliberate API choices
///
/// Only exception types this project is certain `supabase_flutter` 2.x exports
/// are referenced by TYPE: [PostgrestException], [AuthException] and
/// [StorageException], and only their long-stable fields are read. Anything
/// else (an edge-function failure, an `http` `ClientException`, gotrue's
/// retryable-fetch exception) is recognised by runtime type NAME plus message
/// shape, so this file cannot fail to compile because a minor version moved a
/// field.
library;

import 'dart:async';
import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';

/// What actually went wrong, at a granularity a caller can branch on.
///
/// [AppErrorKind] answers "how do we speak to the user". This answers "what do
/// we do about it", which is a different question with a different set of
/// answers.
enum SupabaseFailureCause {
  /// No usable connection. The request never reached the server, so nothing is
  /// known about whether it applied.
  offline,

  /// The request reached the server but no answer arrived in time. Unlike
  /// [offline] this does NOT mean the write did not happen.
  timeout,

  /// 23505. On an idempotent replay this normally means the earlier attempt
  /// succeeded. See [SupabaseFailure.isIdempotentReplay].
  uniqueViolation,

  /// 42P10. An upsert whose `on_conflict` target could not be inferred.
  ///
  /// Artifact 05 section 3.2: six of the twelve idempotent tables use a PARTIAL
  /// unique index on `client_uuid`, and Postgres index inference for
  /// `ON CONFLICT (col)` needs the statement to supply the index predicate,
  /// which supabase-js does not emit. If that is what is happening, the write is
  /// visibly STUCK, not silently duplicated - which is the safe direction, but
  /// it is emphatically not a successful replay.
  onConflictInferenceFailed,

  /// 23503. A referenced row is missing, or this row is still referenced.
  foreignKeyViolation,

  /// 23502. A required column arrived null.
  notNullViolation,

  /// 23514. A CHECK constraint refused the value.
  checkViolation,

  /// 22P02 and friends. Malformed input, classically a non-uuid in a uuid
  /// column.
  invalidInput,

  /// PGRST116. Exactly one row was required and none was returned.
  noRowsFound,

  /// PGRST103. The requested `.range()` starts past the end of the result. For
  /// a pager this is the end of the data, not a failure.
  rangeNotSatisfiable,

  /// 42501. Refused by row-level security or a missing grant.
  rowLevelSecurity,

  /// The client asked for an object or column the server does not have. Always
  /// loud; never degraded to an empty result.
  schemaMismatch,

  /// P0001 / 22023. A PL/pgSQL guard refused the operation deliberately. The
  /// RPCs in this system raise plain sentences written to be read by a person,
  /// so the server's own wording is preferred when it is safe to show.
  serverRaise,

  /// The access token has expired.
  jwtExpired,

  /// No usable credentials.
  unauthenticated,

  /// Real credentials, insufficient rights.
  forbidden,

  /// Too many requests.
  rateLimited,

  /// Storage object not found.
  storageNotFound,

  /// The server failed or is unavailable.
  serverError,

  /// Nothing above matched.
  unknown,
}

/// A classified Supabase failure: the sentence for the user, plus the facts a
/// caller needs to decide what to do.
class SupabaseFailure implements Exception {
  const SupabaseFailure({
    required this.error,
    required this.cause,
    this.code,
    this.rawMessage,
  });

  /// Safe to surface. Its [AppError.message] never contains a driver message,
  /// a table name, a column name, an endpoint or a token.
  final AppError error;

  /// What went wrong, mechanically.
  final SupabaseFailureCause cause;

  /// The code the server reported, verbatim: a five-character SQLSTATE such as
  /// `23505`, a PostgREST code such as `PGRST116`, or an HTTP status rendered
  /// as a string. Null when nothing usable was reported.
  ///
  /// Safe to LOG. Do not render it.
  final String? code;

  /// The original message, redacted of anything token-shaped.
  ///
  /// **Never display this.** It exists so telemetry keeps the real detail that
  /// [AppError.message] deliberately drops.
  final String? rawMessage;

  /// True when this failure is the expected outcome of replaying an idempotent
  /// write whose first attempt already landed.
  ///
  /// Artifact 06 section 1: every queued command upserts on a stable
  /// `client_uuid`, so a duplicate key on a REPLAY means the row is already
  /// there. A queue that sees this should mark the command DONE.
  ///
  /// The caller supplies the missing half of the judgement: this getter says
  /// "the server rejected this as a duplicate", and only the caller knows
  /// whether the write was idempotent and whether this was a retry. A first
  /// attempt that hits 23505 is a genuine conflict, not a replay.
  bool get isIdempotentReplay => cause == SupabaseFailureCause.uniqueViolation;

  /// True when exactly one row was required and none came back. Distinct from
  /// an empty list, which is not an error at all.
  bool get isNoRowsFound => cause == SupabaseFailureCause.noRowsFound;

  /// True when the client and the database disagree about the schema. The
  /// caller must surface this. Degrading it to an empty result reports the
  /// fleet as smaller than it is.
  bool get isSchemaMismatch => cause == SupabaseFailureCause.schemaMismatch;

  /// True when a pager has read past the end of the result set.
  bool get isRangeExhausted =>
      cause == SupabaseFailureCause.rangeNotSatisfiable;

  /// True when the account is real but is not allowed to do this.
  bool get isPermissionDenied =>
      cause == SupabaseFailureCause.rowLevelSecurity ||
      cause == SupabaseFailureCause.forbidden;

  /// True when the request never got an answer, so the caller cannot know
  /// whether a write applied.
  bool get isConnectivity =>
      cause == SupabaseFailureCause.offline ||
      cause == SupabaseFailureCause.timeout;

  /// Convenience passthrough.
  bool get isRetryable => error.isRetryable;

  @override
  String toString() =>
      'SupabaseFailure(${cause.name}${code == null ? '' : ', $code'}): '
      '${error.message}';
}

/// Classify anything thrown by a Supabase call.
///
/// Never throws. An input it cannot recognise becomes
/// [SupabaseFailureCause.unknown] with a generic sentence, because a mapper
/// that throws while mapping an error destroys the original.
SupabaseFailure classifySupabaseError(Object error) {
  if (error is SupabaseFailure) {
    return error;
  }
  if (error is AppError) {
    return SupabaseFailure(
      error: error,
      cause: _causeForKind(error.kind),
      rawMessage: error.technical,
    );
  }
  if (error is PostgrestException) {
    return _fromPostgrest(error);
  }
  if (error is AuthException) {
    return _fromAuth(error);
  }
  if (error is StorageException) {
    return _fromStorage(error);
  }
  if (error is TimeoutException) {
    return _timedOut(error, error.message);
  }
  if (error is SocketException) {
    return _offline(error, error.message);
  }
  if (error is HttpException) {
    return _offline(error, error.message);
  }
  if (error is TlsException) {
    // Covers HandshakeException. Usually a captive portal or a wrong device
    // clock, both of which clear on their own, so it stays retryable.
    return _offline(error, error.message);
  }
  if (error is IOException) {
    return _offline(error, error.toString());
  }
  return _fromUnrecognised(error);
}

/// Map anything thrown by a Supabase call straight to an [AppError].
///
/// Use this at a boundary that only needs to show something. Use
/// [classifySupabaseError] anywhere the DECISION differs by cause - a queue
/// deciding whether a 23505 means success, a pager deciding whether a PGRST103
/// means end-of-data, a repository deciding whether to surface a schema
/// mismatch rather than an empty list.
AppError mapSupabaseError(Object error) => classifySupabaseError(error).error;

// ---------------------------------------------------------------------------
// PostgREST / Postgres
// ---------------------------------------------------------------------------

SupabaseFailure _fromPostgrest(PostgrestException error) {
  final String code = (error.code ?? '').trim().toUpperCase();
  final String raw = error.message;

  // A transport failure can surface wrapped in a PostgrestException with no
  // usable code. Check the text before the code table so it is not swallowed
  // by the generic server branch.
  if (code.isEmpty && _looksLikeConnectivity(raw)) {
    return _offline(error, raw);
  }

  switch (code) {
    case '23505':
      return _failure(
        error: error,
        raw: raw,
        code: code,
        cause: SupabaseFailureCause.uniqueViolation,
        kind: AppErrorKind.conflict,
        // Deliberately not the generic "this record changed on the server"
        // wording: a duplicate key is a specific, different situation and the
        // most likely reader of this sentence is somebody who pressed Save
        // twice.
        message: 'This has already been saved.',
      );

    case '42P10':
      return _failure(
        error: error,
        raw: raw,
        code: code,
        cause: SupabaseFailureCause.onConflictInferenceFailed,
        kind: AppErrorKind.server,
        message:
            'This could not be saved because of a server setup problem. '
            'Your work is still on this device. Report this.',
      );

    case '23503':
      return _failure(
        error: error,
        raw: raw,
        code: code,
        cause: SupabaseFailureCause.foreignKeyViolation,
        kind: AppErrorKind.validation,
        message: 'A record this depends on is missing, or is still in use.',
      );

    case '23502':
      return _failure(
        error: error,
        raw: raw,
        code: code,
        cause: SupabaseFailureCause.notNullViolation,
        kind: AppErrorKind.validation,
        message: 'A required field is missing.',
      );

    case '23514':
      return _failure(
        error: error,
        raw: raw,
        code: code,
        cause: SupabaseFailureCause.checkViolation,
        kind: AppErrorKind.validation,
        message: 'That value is not allowed here.',
      );

    case '22P02':
    case '22003':
    case '22007':
    case '22008':
      return _failure(
        error: error,
        raw: raw,
        code: code,
        cause: SupabaseFailureCause.invalidInput,
        kind: AppErrorKind.validation,
        message: 'One of the values entered is not in the expected format.',
      );

    case 'PGRST116':
      return _failure(
        error: error,
        raw: raw,
        code: code,
        cause: SupabaseFailureCause.noRowsFound,
        kind: AppErrorKind.validation,
        message: 'That record could not be found. It may have been removed.',
      );

    case 'PGRST103':
      return _failure(
        error: error,
        raw: raw,
        code: code,
        cause: SupabaseFailureCause.rangeNotSatisfiable,
        kind: AppErrorKind.validation,
        message: 'There are no more results.',
      );

    case '42501':
      return _failure(
        error: error,
        raw: raw,
        code: code,
        cause: SupabaseFailureCause.rowLevelSecurity,
        kind: AppErrorKind.authorization,
        // No table name, no policy name, no role name. A refusal explains that
        // it is a refusal; it does not describe the wall.
        message: 'You do not have permission to do this.',
      );

    case '403':
      return _failure(
        error: error,
        raw: raw,
        code: code,
        cause: SupabaseFailureCause.forbidden,
        kind: AppErrorKind.authorization,
        message: 'You do not have permission to do this.',
      );

    case 'PGRST301':
    case '401':
      return _failure(
        error: error,
        raw: raw,
        code: code,
        cause: code == '401'
            ? SupabaseFailureCause.unauthenticated
            : SupabaseFailureCause.jwtExpired,
        kind: AppErrorKind.authentication,
        message: 'Your session has ended. Sign in again to continue.',
      );

    case '42P01': // undefined_table
    case '42703': // undefined_column
    case '42883': // undefined_function
    case '42P02': // undefined_parameter
    case 'PGRST202': // function not found in schema cache
    case 'PGRST204': // column not found in schema cache
    case 'PGRST205': // table not found in schema cache
    case '404':
      return _schemaMismatch(error, raw, code);

    case 'P0001':
    case '22023':
      // A PL/pgSQL guard refused this on purpose. The RPCs in this system raise
      // sentences written for a person ("An inspection approval needs a
      // signature"), so the server's own wording is better than anything
      // invented here - provided it carries no database fingerprints.
      return _failure(
        error: error,
        raw: raw,
        code: code,
        cause: SupabaseFailureCause.serverRaise,
        kind: AppErrorKind.validation,
        message: _passThroughOrDefault(
          raw,
          'That action was refused. Check the details and try again.',
        ),
      );

    case '40001': // serialization_failure
    case '40P01': // deadlock_detected
      return _failure(
        error: error,
        raw: raw,
        code: code,
        cause: SupabaseFailureCause.serverError,
        kind: AppErrorKind.conflict,
        message: 'Another change landed at the same time. Try again.',
        retryable: true,
      );

    case '429':
      return _failure(
        error: error,
        raw: raw,
        code: code,
        cause: SupabaseFailureCause.rateLimited,
        kind: AppErrorKind.server,
        message: 'The server is busy. Wait a moment and try again.',
        retryable: true,
      );

    case '57014': // query_canceled, typically a statement timeout
      return _timedOut(error, raw, code: code);

    case '500':
    case '502':
    case '503':
    case '504':
    case '53300': // too_many_connections
    case '53400': // configuration_limit_exceeded
      return _failure(
        error: error,
        raw: raw,
        code: code,
        cause: SupabaseFailureCause.serverError,
        kind: AppErrorKind.server,
        message: 'The server is temporarily unavailable. Try again shortly.',
        retryable: true,
      );
  }

  return _postgrestByClass(error, raw, code);
}

/// Fall back to the SQLSTATE class (its first two characters) when the exact
/// code is not one this file names. Getting the CLASS right is far better than
/// calling everything unknown: class 23 is always an integrity violation and
/// class 42 is always the client asking for something that is not there.
SupabaseFailure _postgrestByClass(
  PostgrestException error,
  String raw,
  String code,
) {
  if (code.startsWith('PGRST')) {
    return _failure(
      error: error,
      raw: raw,
      code: code,
      cause: SupabaseFailureCause.serverError,
      kind: AppErrorKind.server,
      message: 'The request could not be completed. Try again shortly.',
      retryable: true,
    );
  }

  if (code.length >= 2) {
    final String sqlClass = code.substring(0, 2);
    switch (sqlClass) {
      case '08': // connection_exception
        return _offline(error, raw, code: code);
      case '22': // data_exception
        return _failure(
          error: error,
          raw: raw,
          code: code,
          cause: SupabaseFailureCause.invalidInput,
          kind: AppErrorKind.validation,
          message: 'One of the values entered is not in the expected format.',
        );
      case '23': // integrity_constraint_violation
        return _failure(
          error: error,
          raw: raw,
          code: code,
          cause: SupabaseFailureCause.checkViolation,
          kind: AppErrorKind.validation,
          message: 'That change conflicts with a rule on this record.',
        );
      case '42': // syntax_error_or_access_rule_violation
        return _schemaMismatch(error, raw, code);
      case '53': // insufficient_resources
      case '57': // operator_intervention
      case '58': // system_error
        return _failure(
          error: error,
          raw: raw,
          code: code,
          cause: SupabaseFailureCause.serverError,
          kind: AppErrorKind.server,
          message: 'The server is temporarily unavailable. Try again shortly.',
          retryable: true,
        );
    }
  }

  return _failure(
    error: error,
    raw: raw,
    code: code.isEmpty ? null : code,
    cause: SupabaseFailureCause.unknown,
    kind: AppErrorKind.unknown,
    message: _passThroughOrDefault(raw, _genericMessage),
  );
}

SupabaseFailure _schemaMismatch(Object error, String raw, String code) {
  return _failure(
    error: error,
    raw: raw,
    code: code.isEmpty ? null : code,
    cause: SupabaseFailureCause.schemaMismatch,
    kind: AppErrorKind.server,
    // Loud on purpose. Artifact 01: a column PostgREST cannot find fails the
    // WHOLE request, and a failed read rendered as an empty result is a wrong
    // answer that looks right.
    message:
        'This version of the app cannot read that data from the server. '
        'Update the app, then try again.',
  );
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

SupabaseFailure _fromAuth(AuthException error) {
  final String raw = error.message;
  final String status = (error.statusCode ?? '').trim();
  final String lower = raw.toLowerCase();

  // gotrue reports a failed fetch as an AuthException. Treating that as
  // "your session has ended" would sign a technician out of an application
  // they cannot sign back into without a signal - the exact lockout recorded
  // in PROJECT_MEMORY. It is a network failure and must stay one.
  if (_looksLikeConnectivity(raw) ||
      _runtimeTypeName(error).contains('Retryable')) {
    return _offline(error, raw, code: status.isEmpty ? null : status);
  }

  if (lower.contains('invalid login credentials') ||
      lower.contains('invalid credentials') ||
      lower.contains('invalid_grant')) {
    return _failure(
      error: error,
      raw: raw,
      code: status.isEmpty ? null : status,
      cause: SupabaseFailureCause.unauthenticated,
      kind: AppErrorKind.authentication,
      // Deliberately does not say which half was wrong. Naming the username as
      // valid is account enumeration.
      message: 'Those sign-in details were not recognised.',
    );
  }

  if (lower.contains('email not confirmed') ||
      lower.contains('user not found') ||
      lower.contains('user already registered')) {
    return _failure(
      error: error,
      raw: raw,
      code: status.isEmpty ? null : status,
      cause: SupabaseFailureCause.unauthenticated,
      kind: AppErrorKind.authentication,
      message: 'That account cannot sign in. Contact your administrator.',
    );
  }

  if (status == '429' || lower.contains('rate limit')) {
    return _failure(
      error: error,
      raw: raw,
      code: status.isEmpty ? null : status,
      cause: SupabaseFailureCause.rateLimited,
      kind: AppErrorKind.authentication,
      message: 'Too many attempts. Wait a moment and try again.',
      retryable: true,
    );
  }

  if (status == '403') {
    return _failure(
      error: error,
      raw: raw,
      code: status,
      cause: SupabaseFailureCause.forbidden,
      kind: AppErrorKind.authorization,
      message: 'You do not have permission to do this.',
    );
  }

  return _failure(
    error: error,
    raw: raw,
    code: status.isEmpty ? null : status,
    cause: SupabaseFailureCause.jwtExpired,
    kind: AppErrorKind.authentication,
    message: 'Your session has ended. Sign in again to continue.',
  );
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

SupabaseFailure _fromStorage(StorageException error) {
  final String raw = error.message;
  final String status = (error.statusCode ?? '').trim();

  if (_looksLikeConnectivity(raw)) {
    return _offline(error, raw, code: status.isEmpty ? null : status);
  }

  switch (status) {
    case '404':
      return _failure(
        error: error,
        raw: raw,
        code: status,
        cause: SupabaseFailureCause.storageNotFound,
        kind: AppErrorKind.storage,
        message: 'That file could not be found on the server.',
      );
    case '401':
      return _failure(
        error: error,
        raw: raw,
        code: status,
        cause: SupabaseFailureCause.unauthenticated,
        kind: AppErrorKind.authentication,
        message: 'Your session has ended. Sign in again to continue.',
      );
    case '403':
      return _failure(
        error: error,
        raw: raw,
        code: status,
        cause: SupabaseFailureCause.forbidden,
        kind: AppErrorKind.authorization,
        message: 'You do not have permission to use that file.',
      );
    case '409':
      return _failure(
        error: error,
        raw: raw,
        code: status,
        cause: SupabaseFailureCause.uniqueViolation,
        kind: AppErrorKind.conflict,
        message: 'That file has already been uploaded.',
      );
    case '413':
      return _failure(
        error: error,
        raw: raw,
        code: status,
        cause: SupabaseFailureCause.checkViolation,
        kind: AppErrorKind.storage,
        message: 'That file is too large to upload.',
      );
    case '429':
      return _failure(
        error: error,
        raw: raw,
        code: status,
        cause: SupabaseFailureCause.rateLimited,
        kind: AppErrorKind.storage,
        message: 'The server is busy. Wait a moment and try again.',
        retryable: true,
      );
  }

  return _failure(
    error: error,
    raw: raw,
    code: status.isEmpty ? null : status,
    cause: SupabaseFailureCause.serverError,
    kind: AppErrorKind.storage,
    // Photos are evidence. A storage failure must never read as "saved".
    message: 'That file could not be transferred. It is still on this device.',
    retryable: true,
  );
}

// ---------------------------------------------------------------------------
// Everything else
// ---------------------------------------------------------------------------

/// Recognise by runtime type NAME rather than by type, so this file does not
/// have to import `package:http` (not a declared dependency) or depend on the
/// exact shape of `FunctionException` in a given `supabase_flutter` patch.
SupabaseFailure _fromUnrecognised(Object error) {
  final String typeName = _runtimeTypeName(error);
  final String raw = error.toString();

  const Set<String> connectivityTypes = <String>{
    'ClientException',
    'AuthRetryableFetchException',
    'ConnectionException',
    'WebSocketException',
  };

  if (connectivityTypes.contains(typeName) || _looksLikeConnectivity(raw)) {
    return _offline(error, raw);
  }

  if (typeName == 'FunctionException') {
    // An edge function returned a non-2xx. `chat-ai` is the only one the mobile
    // app invokes; a failure there is never worth a raw dump on screen.
    return _failure(
      error: error,
      raw: raw,
      code: null,
      cause: SupabaseFailureCause.serverError,
      kind: AppErrorKind.server,
      message: 'That service is unavailable right now. Try again shortly.',
      retryable: true,
    );
  }

  return _failure(
    error: error,
    raw: raw,
    code: null,
    cause: SupabaseFailureCause.unknown,
    kind: AppErrorKind.unknown,
    message: _genericMessage,
  );
}

SupabaseFailure _offline(Object error, String raw, {String? code}) {
  return SupabaseFailure(
    error: AppError.network(technical: _technical(raw, code), cause: error),
    cause: SupabaseFailureCause.offline,
    code: code,
    rawMessage: _redact(raw),
  );
}

SupabaseFailure _timedOut(Object error, String? raw, {String? code}) {
  final String text = raw ?? 'timeout';
  return SupabaseFailure(
    error: AppError(
      kind: AppErrorKind.network,
      // Deliberately different wording from AppError.network. A timeout means
      // the request MAY have applied, and telling somebody their work is
      // safely queued when it might already be on the server invites a
      // duplicate. Idempotency is what actually makes the retry safe.
      message:
          'The server did not answer in time. Check the record before '
          'trying again.',
      technical: _technical(text, code),
      cause: error,
      isRetryable: true,
    ),
    cause: SupabaseFailureCause.timeout,
    code: code,
    rawMessage: _redact(text),
  );
}

SupabaseFailure _failure({
  required Object error,
  required String raw,
  required String? code,
  required SupabaseFailureCause cause,
  required AppErrorKind kind,
  required String message,
  bool retryable = false,
}) {
  return SupabaseFailure(
    error: AppError(
      kind: kind,
      message: message,
      technical: _technical(raw, code),
      cause: error,
      isRetryable: retryable,
    ),
    cause: cause,
    code: code,
    rawMessage: _redact(raw),
  );
}

SupabaseFailureCause _causeForKind(AppErrorKind kind) {
  switch (kind) {
    case AppErrorKind.network:
      return SupabaseFailureCause.offline;
    case AppErrorKind.authentication:
      return SupabaseFailureCause.unauthenticated;
    case AppErrorKind.authorization:
      return SupabaseFailureCause.forbidden;
    case AppErrorKind.conflict:
      return SupabaseFailureCause.uniqueViolation;
    case AppErrorKind.validation:
    case AppErrorKind.storage:
    case AppErrorKind.sync:
    case AppErrorKind.server:
    case AppErrorKind.unknown:
      return SupabaseFailureCause.unknown;
  }
}

// ---------------------------------------------------------------------------
// Message hygiene
// ---------------------------------------------------------------------------

const String _genericMessage = 'Something went wrong. Please try again.';

/// The longest a server sentence may be before it stops reading as a sentence
/// and starts reading as a dump. Ported from `mobile/lib/safeError.ts`.
const int _maxPassThroughLength = 140;

/// Substrings that mark a message as exposing backend, database or transport
/// internals. Ported from `mobile/lib/safeError.ts`, which carries the same
/// list for the same reason.
const List<String> _leakMarkers = <String>[
  'invalid input syntax',
  'violates',
  'constraint',
  'relation ',
  'column ',
  'table ',
  'syntax error',
  'permission denied for',
  'function ',
  'operator ',
  'type uuid',
  'duplicate key',
  'null value in',
  'foreign key',
  'row-level security',
  'row level security',
  ' rls',
  'jwt',
  'schema cache',
  'pgrst',
  'supabase',
  'postgres',
  'postgrest',
  '/rest/v1',
  '/auth/v1',
  '/storage/v1',
  'http',
  'econn',
  'fetch',
  'xhr',
  'stack',
  'select ',
  'insert ',
  'update ',
  'delete from',
  'pg_',
  'sqlstate',
  'exception',
];

/// True when a message must not be shown to a user as it stands.
bool isLeakyMessage(String message) {
  final String lower = message.toLowerCase();
  for (final String marker in _leakMarkers) {
    if (lower.contains(marker)) {
      return true;
    }
  }
  // A uuid in a user-facing sentence is always a leak of an internal id.
  return _uuidPattern.hasMatch(lower);
}

/// Show the server's own sentence when it is short, clean and clearly written
/// for a person; otherwise fall back.
///
/// This is what preserves the deliberate wording of the PL/pgSQL guards - the
/// approval RPCs raise sentences such as "An inspection approval needs a
/// signature", which is far more useful than anything this file could invent.
String _passThroughOrDefault(String raw, String fallback) {
  final String trimmed = raw.trim();
  if (trimmed.isEmpty) {
    return fallback;
  }
  if (trimmed.length > _maxPassThroughLength) {
    return fallback;
  }
  if (isLeakyMessage(trimmed)) {
    return fallback;
  }
  return trimmed;
}

/// True when a message describes a failure to reach the server rather than a
/// refusal by it.
bool _looksLikeConnectivity(String message) {
  final String lower = message.toLowerCase();
  const List<String> markers = <String>[
    'socketexception',
    'failed host lookup',
    'network is unreachable',
    'no address associated with hostname',
    'connection refused',
    'connection reset',
    'connection closed',
    'connection terminated',
    'software caused connection abort',
    'broken pipe',
    'handshake',
    'certificate',
    'timed out',
    'timeout',
    'failed to fetch',
    'network error',
    'network request failed',
    'clientexception',
    'unreachable',
    'offline',
  ];
  for (final String marker in markers) {
    if (lower.contains(marker)) {
      return true;
    }
  }
  return false;
}

final RegExp _uuidPattern = RegExp(
  r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
  caseSensitive: false,
);

/// Anything shaped like a JWT. Access tokens turn up inside auth error text,
/// and spec section 59 forbids sending a token to telemetry.
final RegExp _jwtPattern = RegExp(
  r'eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*',
);

/// Anything shaped like a bearer credential in a header dump.
final RegExp _bearerPattern = RegExp(
  r'(?:bearer|apikey|authorization)\s*[:=]\s*\S+',
  caseSensitive: false,
);

/// Strip credentials before a message is allowed anywhere near telemetry.
///
/// This is a defence, not a licence: [SupabaseFailure.rawMessage] and
/// [AppError.technical] are still log-only and must never reach a screen.
String _redact(String raw) {
  if (raw.isEmpty) {
    return raw;
  }
  return raw
      .replaceAll(_jwtPattern, '[redacted-token]')
      .replaceAll(_bearerPattern, '[redacted-credential]');
}

String _technical(String raw, String? code) {
  final String redacted = _redact(raw.trim());
  if (code == null || code.isEmpty) {
    return redacted;
  }
  return redacted.isEmpty ? code : '$code: $redacted';
}

String _runtimeTypeName(Object error) => error.runtimeType.toString();
