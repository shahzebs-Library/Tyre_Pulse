import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/media_dao.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';

/// Restricts the shared sync engine to evidence captured by its active actor.
/// The scope is checked again each claim so an account/workspace change cannot
/// drain retained evidence from a previous session.
final class ScopedMediaDao extends MediaDao {
  ScopedMediaDao(
    super.database, {
    required this.workspaceId,
    required this.userId,
    required this.currentUserId,
  });

  final String workspaceId;
  final String userId;
  final String? Function() currentUserId;

  @override
  Future<List<PendingMediaUpload>> claimNextUploads({
    int limit = uploadConcurrency,
    String? workspaceId,
    String? createdBy,
  }) async {
    final active = await attachedDatabase.cacheDao.activeWorkspace();
    if (currentUserId() != userId ||
        active?.userId != userId ||
        active?.workspaceId != this.workspaceId) {
      return <PendingMediaUpload>[];
    }
    return super.claimNextUploads(
      limit: limit,
      workspaceId: this.workspaceId,
      createdBy: userId,
    );
  }
}
