import 'package:drift/drift.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/queue_dao.dart';
import 'package:tyre_pulse/core/database/dao/scoped_media_dao.dart';

import 'database_test_support.dart';

void main() {
  test('claims only active actor evidence and stops on session change',
      () async {
    final db = newMemoryDatabase();
    addTearDown(db.close);
    await db.cacheDao.upsertWorkspace(
      WorkspaceScopesCompanion.insert(
        workspaceId: workspaceA,
        siteIdsJson: '["ALL"]',
        userId: testUser,
        role: 'Technician',
        lastVerifiedAt: testNow,
        isActive: const Value(true),
      ),
    );
    for (final (id, workspace, actor) in [
      ('mine', workspaceA, testUser),
      ('other-org', workspaceB, testUser),
      ('other-user', workspaceA, 'another-user'),
    ]) {
      await db.queueDao.enqueue(
        id: id,
        commandType: 'TYRE_CHANGE',
        entityType: 'tyre_records',
        payloadJson: '{}',
        createdBy: actor,
        workspaceId: workspace,
        now: testNow,
        idempotencyKey: id,
        attachments: <QueuedMediaAttachment>[queuedPhoto('$id.jpg')],
      );
    }
    String? actor = testUser;
    final dao = ScopedMediaDao(
      db,
      workspaceId: workspaceA,
      userId: testUser,
      currentUserId: () => actor,
    );
    expect((await dao.claimNextUploads()).map((p) => p.commandId), ['mine']);
    expect(
      (await db.mediaDao.mediaForCommand('other-org')).single.state,
      'queued',
    );
    expect(
      (await db.mediaDao.mediaForCommand('other-user')).single.state,
      'queued',
    );
    actor = 'another-user';
    expect(await dao.claimNextUploads(), isEmpty);
  });
}
