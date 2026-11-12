/// A durable, device-local store for the in-progress handover draft.
///
/// One JSON file per signing-in user, written atomically (`.tmp` + rename) so a
/// process kill mid-write never corrupts it - the same discipline the
/// submission queue uses. A draft is the only copy of work being filled, so it
/// is never wiped by a schema change and is cleared only when the handover has
/// been submitted (or the user explicitly discards it). An unreadable store is
/// treated as "no draft" for the READ (a draft the user has not started yet is
/// the same, harmless, state), never silently overwritten.
library;

import 'dart:io';

import 'package:path_provider/path_provider.dart';
import 'package:tyre_pulse/features/handover/domain/handover_draft.dart';

abstract interface class HandoverDraftStore {
  /// The saved draft for [userKey], or null when there is none or it could not
  /// be read.
  Future<HandoverDraft?> read(String userKey);

  /// Saves [draft] for [userKey], overwriting any previous one.
  Future<void> save(String userKey, HandoverDraft draft);

  /// Discards the draft for [userKey]. A no-op when there is none.
  Future<void> clear(String userKey);
}

final class FileHandoverDraftStore implements HandoverDraftStore {
  FileHandoverDraftStore({Directory? overrideDirectory})
      : _overrideDirectory = overrideDirectory;

  final Directory? _overrideDirectory;

  static const String _folderName = 'handover_drafts';

  Future<Directory> _directory() async {
    final Directory base =
        _overrideDirectory ?? await getApplicationDocumentsDirectory();
    final Directory dir = Directory(
      '${base.path}${Platform.pathSeparator}$_folderName',
    );
    if (!dir.existsSync()) {
      await dir.create(recursive: true);
    }
    return dir;
  }

  File _fileFor(Directory dir, String userKey) =>
      File('${dir.path}${Platform.pathSeparator}${_safe(userKey)}.json');

  @override
  Future<HandoverDraft?> read(String userKey) async {
    if (userKey.trim().isEmpty) return null;
    try {
      final Directory dir = await _directory();
      final File file = _fileFor(dir, userKey);
      if (!file.existsSync()) return null;
      return HandoverDraft.fromJsonString(await file.readAsString());
    } on Object {
      return null;
    }
  }

  @override
  Future<void> save(String userKey, HandoverDraft draft) async {
    if (userKey.trim().isEmpty) return;
    final Directory dir = await _directory();
    final File target = _fileFor(dir, userKey);
    final File temp = File('${target.path}.tmp');
    await temp.writeAsString(draft.toJsonString(), flush: true);
    await temp.rename(target.path);
  }

  @override
  Future<void> clear(String userKey) async {
    if (userKey.trim().isEmpty) return;
    try {
      final Directory dir = await _directory();
      final File file = _fileFor(dir, userKey);
      if (file.existsSync()) {
        await file.delete();
      }
    } on Object {
      // Best effort: a draft that cannot be deleted is harmless; the next save
      // overwrites it.
    }
  }

  static String _safe(String value) =>
      value.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
}
