/// Typed application errors.
///
/// Spec section 57: a user must never see `PostgrestException PGRST116`. The
/// user sees a sentence they can act on; the technical detail goes to
/// telemetry. This file is the only place that mapping is decided, so a
/// feature cannot invent its own wording for a conflict.
library;

/// The error categories the spec names, in section 57.
enum AppErrorKind {
  network,
  authentication,
  authorization,
  validation,
  conflict,
  storage,
  sync,
  server,
  unknown,
}

/// An error with a category, a message safe to show a user, and the technical
/// detail kept for telemetry.
///
/// [technical] is deliberately separate from [message]. Anything placed in
/// [technical] may be logged; anything placed in [message] may be displayed.
/// Never put a raw driver message in [message].
class AppError implements Exception {
  const AppError({
    required this.kind,
    required this.message,
    this.technical,
    this.cause,
    this.isRetryable = false,
  });

  /// A failure to reach the server. Retryable by definition: the request never
  /// got an answer, so nothing is known about whether it applied.
  const AppError.network({String? technical, Object? cause})
      : this(
          kind: AppErrorKind.network,
          message: 'No connection to the server. Your work is saved on this '
              'device and will sync when you are back online.',
          technical: technical,
          cause: cause,
          isRetryable: true,
        );

  /// The session is gone or was rejected.
  const AppError.authentication({String? technical, Object? cause})
      : this(
          kind: AppErrorKind.authentication,
          message: 'Your session has ended. Sign in again to continue.',
          technical: technical,
          cause: cause,
        );

  /// The account is real but is not allowed to do this.
  ///
  /// A refusal must be able to explain itself. The production React Native
  /// suite pins this as `deniedIsNotASpinner`; spec section 58 repeats it.
  const AppError.authorization({
    required String message,
    String? technical,
    Object? cause,
  }) : this(
          kind: AppErrorKind.authorization,
          message: message,
          technical: technical,
          cause: cause,
        );

  /// The record changed on the server since it was read. Spec section 57 gives
  /// this exact example, and spec section 14 is why it matters: an approval
  /// replayed hours later can contradict a decision somebody else already made.
  const AppError.conflict({String? technical, Object? cause})
      : this(
          kind: AppErrorKind.conflict,
          message: 'This record changed on the server. Refresh it before '
              'continuing so you are acting on the current version.',
          technical: technical,
          cause: cause,
        );

  final AppErrorKind kind;

  /// Safe to display. Never contains a driver message, a column name, an
  /// endpoint, a token or a row id.
  final String message;

  /// Unsafe to display, safe to log. Spec section 59 forbids sending
  /// passwords, tokens or image content to telemetry, so callers must not put
  /// those here either.
  final String? technical;

  final Object? cause;

  /// Whether retrying the same operation unchanged could plausibly succeed.
  /// A validation or authorization failure is not retryable; a network one is.
  final bool isRetryable;

  @override
  String toString() => 'AppError(${kind.name}): $message'
      '${technical == null ? '' : ' [$technical]'}';
}
