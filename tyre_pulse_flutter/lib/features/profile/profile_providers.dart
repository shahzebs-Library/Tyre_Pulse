/// Riverpod wiring owned by the Profile screen.
///
/// # Why Profile has its own pending-sync provider
///
/// Profile used to read `homePendingSyncCountProvider`, a one-shot
/// [FutureProvider] that nothing invalidates. Profile is an anchored branch
/// that stays mounted, so its "Pending sync" count and the unsynced-work line
/// under Sign out went stale the moment a sync finished (or a new item was
/// queued) while the screen was open - exactly the line a person reads before
/// deciding whether it is safe to sign out.
///
/// [profilePendingSyncCountProvider] WATCHES the queue instead, through
/// [QueueDao.watchPendingCount] (a Drift watch query over
/// `pending_commands`), so it re-emits on every enqueue, sync and prune.
///
/// This file MUST NOT import `core/sync/command_registry.dart`,
/// `core/sync/queued_command_repository.dart` or `core/sync/sync_engine.dart`:
/// Profile only ever reads a count through `QueueDao`.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/sync/sync_workspace_id.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/profile/data/saved_signature_repository.dart';

/// Every queued command not yet `synced` for the active workspace, live.
///
/// Emits 0 when there is no active [WorkspaceContext] - with nobody signed
/// into a workspace nothing is queued for this screen to report. A database
/// read failure stays an [AsyncError] so the screen renders `-`, never 0.
final StreamProvider<int> profilePendingSyncCountProvider =
    StreamProvider<int>((ref) {
  final WorkspaceContext? workspace = ref.watch(workspaceContextProvider);
  if (workspace == null) return Stream<int>.value(0);
  final AppDatabase db = ref.watch(appDatabaseProvider);
  return db.queueDao.watchPendingCount(
    workspaceId: workspaceIdFor(workspace),
  );
});

/// The signed-in person's own saved signature store (V601).
final Provider<SavedSignatureRepository> savedSignatureRepositoryProvider =
    Provider<SavedSignatureRepository>(
  (ref) => SupabaseSavedSignatureRepository(ref.watch(supabaseClientProvider)),
);

/// What a read of the caller's saved signature found: found, none, or
/// unavailable (the read failed). Profile's "My saved signature" row and its
/// sheet read this, so a failed read says "Could not check" instead of
/// "Not saved" and never hides Remove from a signature that is stored.
final FutureProvider<SavedSignatureLookup> mySavedSignatureLookupProvider =
    FutureProvider<SavedSignatureLookup>((ref) {
  // Re-read when the signed-in person changes.
  ref.watch(workspaceContextProvider.select((w) => w?.userId));
  return ref.watch(savedSignatureRepositoryProvider).lookup();
});

/// The caller's saved signature, or null when none is saved or it could not
/// be read. For the checklist approval pad pre-fill, where both mean "start
/// from a blank pad". Derived from [mySavedSignatureLookupProvider], so
/// invalidating that one refreshes this too.
final FutureProvider<SavedSignature?> mySavedSignatureProvider =
    FutureProvider<SavedSignature?>((ref) async {
  final SavedSignatureLookup lookup =
      await ref.watch(mySavedSignatureLookupProvider.future);
  return lookup.signature;
});

/// Unfinished drafts (checklist + inspection) with real content that are
/// stored on THIS device for the signed-in user - the same "has content"
/// test both draft repositories use, so a template somebody merely opened
/// is not counted. A database failure stays an [AsyncError] so the screen
/// renders `-`, never 0.
final FutureProvider<int> profileDraftCountProvider =
    FutureProvider<int>((ref) async {
  final WorkspaceContext? workspace = ref.watch(workspaceContextProvider);
  final String userId = workspace?.userId.trim() ?? '';
  if (userId.isEmpty) return 0;
  // Re-count whenever the queue moves (a submit detaches a draft).
  ref.watch(profilePendingSyncCountProvider);
  final AppDatabase db = ref.watch(appDatabaseProvider);
  int count = 0;
  for (final draft in await db.draftsDao.checklistDraftsForUser(userId)) {
    if (await db.draftsDao.draftHasContent(
      ownerKind: OwnerKind.checklistDraft,
      ownerKey: draft.draftKey,
      filled: draft.filled,
    )) {
      count += 1;
    }
  }
  for (final draft in await db.draftsDao.inspectionDraftsForUser(userId)) {
    if (await db.draftsDao.draftHasContent(
      ownerKind: OwnerKind.inspectionDraft,
      ownerKey: draft.draftKey,
      filled: draft.filled,
    )) {
      count += 1;
    }
  }
  return count;
});
