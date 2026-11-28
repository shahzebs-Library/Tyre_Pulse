/// Keeps retrying the physical inventory outbox until the network really
/// works, instead of trying once at the moment the phone says it is online.
///
/// # Why
///
/// Field report 2026-11-27 (Store Keeper, airplane mode): a count recorded
/// offline went into the outbox, but after the phone came back online it
/// never reached `physical_inventory_captures`. The outbox was only flushed on
/// sign-in, on app resume and ONCE on the offline -> online connectivity edge.
/// That edge fires when the radio reconnects, before DNS and the first
/// request work, so the one attempt failed as "offline" and nothing tried
/// again until the app was sent to the background and reopened.
///
/// [trigger] runs one flush attempt and, while [attempt] reports that work is
/// still waiting because the network did not answer, retries after each of
/// [retryDelays]. Calls made while a run is in progress are folded into it
/// (one more attempt at the end), so two triggers never flush in parallel.
library;

/// One flush. Returns true when captures are still waiting because the
/// network did not answer (or the flush itself failed), i.e. a retry helps.
typedef OutboxFlushAttempt = Future<bool> Function();

final class OutboxAutoFlusher {
  OutboxAutoFlusher({
    required OutboxFlushAttempt attempt,
    this.retryDelays = defaultRetryDelays,
    Future<void> Function(Duration delay)? sleep,
  })  : _attempt = attempt,
        _sleep = sleep ?? Future<void>.delayed;

  static const List<Duration> defaultRetryDelays = <Duration>[
    Duration(seconds: 3),
    Duration(seconds: 10),
    Duration(seconds: 30),
    Duration(seconds: 60),
    Duration(minutes: 2),
  ];

  final OutboxFlushAttempt _attempt;
  final List<Duration> retryDelays;
  final Future<void> Function(Duration delay) _sleep;

  bool _running = false;
  bool _again = false;
  bool _disposed = false;

  bool get running => _running;

  Future<bool> _safeAttempt() async {
    try {
      return await _attempt();
    } on Object {
      return true;
    }
  }

  /// Flushes now and retries while the network does not answer.
  Future<void> trigger() async {
    if (_disposed) return;
    if (_running) {
      _again = true;
      return;
    }
    _running = true;
    try {
      int retry = 0;
      while (!_disposed) {
        _again = false;
        final bool waiting = await _safeAttempt();
        if (_disposed) break;
        if (!waiting) {
          if (_again) continue;
          break;
        }
        if (retry >= retryDelays.length) break;
        await _sleep(retryDelays[retry++]);
      }
    } finally {
      _running = false;
    }
  }

  void dispose() => _disposed = true;
}
