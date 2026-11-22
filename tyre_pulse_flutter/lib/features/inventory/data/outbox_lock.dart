/// Mutual exclusion for the physical inventory outbox.
///
/// The outbox lives in ONE secure-storage slot per user, and
/// `SecureKeyValueStore.updateValue` is a plain read, transform, write. The
/// capture screen, the app-wide binding and the background worker
/// (`background_sync.dart`, a separate isolate and, on some devices, a
/// separate process) each build their own `PhysicalCaptureOutbox` over that
/// slot. Without a lock shared by all of them, one writer can read the list,
/// another can add a capture, and the first then writes its older list back:
/// the new capture is gone from the phone for good. Every outbox mutation runs
/// inside [OutboxLock.run], held only around that one read-modify-write and
/// never across a network call.
///
/// # Why an exclusive-create lock file, not `RandomAccessFile.lock`
///
/// `RandomAccessFile.lock` is an `fcntl` record lock on Android and iOS. Those
/// locks belong to the PROCESS, not the isolate, so two isolates in the same
/// process (the foreground app and a Workmanager background engine started
/// while the app is open) would both "hold" it at once, and closing any
/// descriptor of the file releases every lock the process has on it. Creating
/// a file with `exclusive: true` is an atomic `O_CREAT | O_EXCL` in the
/// kernel, so it excludes isolates and processes alike. Each holder writes a
/// random token into the file and deletes it only while it still holds that
/// token; a file older than [FileOutboxLock.staleAfter] (a holder that was
/// killed mid-write) is broken so the outbox can never stay locked forever.
library;

import 'dart:async';
import 'dart:io';
import 'dart:math';

/// Runs [run]'s body while no other outbox mutation runs.
abstract interface class OutboxLock {
  Future<T> run<T>(Future<T> Function() body);
}

/// The lock could not be taken in time. The mutation did not happen, so the
/// caller keeps its data (a save is reported as failed, a flush retries).
final class OutboxLockTimeout implements Exception {
  const OutboxLockTimeout(this.path);
  final String path;

  @override
  String toString() => 'OutboxLockTimeout($path)';
}

/// Serialises callers inside one isolate (an async queue). Used by tests and
/// as the in-isolate half of [FileOutboxLock].
final class IsolateOutboxLock implements OutboxLock {
  Future<void> _tail = Future<void>.value();

  @override
  Future<T> run<T>(Future<T> Function() body) {
    final Future<void> previous = _tail;
    final Completer<void> done = Completer<void>();
    _tail = done.future;
    return previous.then((_) => body()).whenComplete(done.complete);
  }
}

/// Serialises callers across isolates and processes through an exclusively
/// created lock file at [resolvePath] (resolved lazily, so a headless isolate
/// can build the outbox before `path_provider` is asked anything).
final class FileOutboxLock implements OutboxLock {
  FileOutboxLock(
    this._resolvePath, {
    this.staleAfter = const Duration(seconds: 60),
    this.timeout = const Duration(seconds: 20),
    this.poll = const Duration(milliseconds: 20),
  });

  final Future<String> Function() _resolvePath;
  final Duration staleAfter;
  final Duration timeout;
  final Duration poll;

  // One in-isolate queue per lock path, so callers in this isolate wait in
  // order instead of polling the file against each other.
  static final Map<String, IsolateOutboxLock> _local =
      <String, IsolateOutboxLock>{};
  static final Random _random = Random.secure();

  @override
  Future<T> run<T>(Future<T> Function() body) async {
    final String path = await _resolvePath();
    final IsolateOutboxLock local =
        _local.putIfAbsent(path, IsolateOutboxLock.new);
    return local.run(() async {
      final String token = await _acquire(path);
      try {
        return await body();
      } finally {
        await _release(path, token);
      }
    });
  }

  String _newToken() =>
      '$pid-${DateTime.now().microsecondsSinceEpoch}-${_random.nextInt(1 << 32)}';

  Future<String> _acquire(String path) async {
    final File file = File(path);
    await file.parent.create(recursive: true);
    final String token = _newToken();
    final Stopwatch waited = Stopwatch()..start();
    while (true) {
      try {
        await file.create(exclusive: true);
        await file.writeAsString(token, flush: true);
        return token;
      } on FileSystemException {
        // Held by someone else (or vanished between our checks): break it
        // only when its holder is clearly gone, then try again.
        try {
          final FileStat stat = file.statSync();
          if (stat.type != FileSystemEntityType.notFound &&
              DateTime.now().difference(stat.modified) > staleAfter) {
            await file.delete();
            continue;
          }
        } on FileSystemException {
          // Removed by its holder meanwhile; retry straight away.
          continue;
        }
      }
      if (waited.elapsed > timeout) throw OutboxLockTimeout(path);
      await Future<void>.delayed(poll);
    }
  }

  Future<void> _release(String path, String token) async {
    final File file = File(path);
    try {
      // Delete only our own lock: if it was broken as stale and re-taken,
      // the new holder's file is left alone.
      if (await file.readAsString() == token) await file.delete();
    } on FileSystemException {
      // Already gone: nothing to release.
    }
  }
}
