/// Shared fixtures for the local database tests.
///
/// Every test opens an in-memory SQLite database through drift's own executor,
/// so the suite needs no platform plugin, no emulator and no Flutter engine
/// beyond the test host.
library;

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/queue_dao.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/database/query_scope.dart';

/// A fresh database per test. Never shared: a leaked row between tests turns a
/// real failure into somebody else's mystery.
AppDatabase newMemoryDatabase() => AppDatabase(NativeDatabase.memory());

/// A fixed clock. Real times make a backoff assertion flaky for no benefit.
final DateTime testNow = DateTime.utc(2026, 8, 25, 9);

const String workspaceA = 'org-a';
const String workspaceB = 'org-b';
const String testUser = 'user-1';

/// Drift stores a `DateTime` as whole seconds since the epoch and hands it back
/// in local time, so a direct `==` against a UTC value fails even when both
/// name the same instant. Compare the instant.
void expectSameInstant(DateTime actual, DateTime expected) {
  expect(
    actual.toUtc().millisecondsSinceEpoch ~/ 1000,
    expected.toUtc().millisecondsSinceEpoch ~/ 1000,
    reason: 'expected the same instant: $actual vs $expected',
  );
}

const WorkspaceScopeFilter scopeA = WorkspaceScopeFilter(
  workspaceId: workspaceA,
);

const WorkspaceScopeFilter scopeB = WorkspaceScopeFilter(
  workspaceId: workspaceB,
);

/// An asset row for [workspaceId], with everything a picker reads.
CachedAssetsCompanion assetRow({
  required String id,
  required String workspaceId,
  required String assetNo,
  String? country,
  String? site,
  String? registrationNo,
  DateTime? cachedAt,
}) {
  return CachedAssetsCompanion.insert(
    id: id,
    workspaceId: workspaceId,
    assetNo: assetNo,
    assetNoNorm: normaliseLookupKey(assetNo),
    cachedAt: cachedAt ?? testNow,
    country: Value<String?>(country),
    site: Value<String?>(site),
    registrationNo: Value<String?>(registrationNo),
  );
}

/// Enqueues a command with a payload the test can assert on byte for byte.
Future<PendingCommand> seedCommand(
  AppDatabase db, {
  required String id,
  String workspaceId = workspaceA,
  String commandType = 'TYRE_CHANGE',
  String entityType = 'tyre_records',
  String? idempotencyKey,
  String? payloadJson,
  DateTime? now,
  List<QueuedMediaAttachment> attachments = const <QueuedMediaAttachment>[],
}) {
  return db.queueDao.enqueue(
    id: id,
    commandType: commandType,
    entityType: entityType,
    payloadJson: payloadJson ?? '{"asset_no":"TM514","position":"LHF1"}',
    createdBy: testUser,
    workspaceId: workspaceId,
    now: now ?? testNow,
    idempotencyKey: idempotencyKey ?? 'idem-$id',
    attachments: attachments,
  );
}

/// A photo attachment pointing at the QUEUE media folder.
QueuedMediaAttachment queuedPhoto(String fileName, {int orderIndex = 0}) {
  return QueuedMediaAttachment(
    localPath: '/data/user/0/app/files/queue-media/$fileName',
    fileName: fileName,
    orderIndex: orderIndex,
  );
}

/// A minimal but valid signature payload. `<svg` is one of the only two shapes
/// the store accepts; anything else is refused as not-a-signature.
const String testSignatureSvg =
    '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 10"/></svg>';

/// The reserved key for a template-level pad.
const String primaryField = primarySignatureFieldKey;
