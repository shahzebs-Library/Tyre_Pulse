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
/// Submitted inspections live in their own file queue
/// (`InspectionSubmissionQueue`), which has no change notification, so their
/// share of the count is re-read on `inspectionQueuePollInterval`.
///
/// This file MUST NOT import `core/sync/command_registry.dart`,
/// `core/sync/queued_command_repository.dart` or `core/sync/sync_engine.dart`:
/// Profile only ever reads a count through `QueueDao`.
library;

import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/sync/sync_workspace_id.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_submission_queue_reads.dart';
import 'package:tyre_pulse/features/inspections/domain/queued_inspection.dart';
import 'package:tyre_pulse/features/inspections/inspections_providers.dart';
import 'package:tyre_pulse/features/profile/data/saved_signature_repository.dart';
import 'package:tyre_pulse/features/profile/domain/combine_latest.dart';

/// The signed-in user's inspection submissions still in
/// `InspectionSubmissionQueue` (submitted, not yet confirmed delivered), every
/// status included. Re-read now and every [inspectionQueuePollInterval].
///
/// The queue is device-wide, so entries are narrowed to this person: their
/// `createdBy`, or a draft key under their user id (`userId|ASSET...`). An
/// unreadable queue is an ERROR, never an empty list - the same "refuse,
/// never guess" rule the queue itself documents.
final StreamProvider<List<QueuedInspection>>
    pendingInspectionSubmissionsProvider =
    StreamProvider<List<QueuedInspection>>((ref) {
  final WorkspaceContext? workspace = ref.watch(workspaceContextProvider);
  return watchUserInspectionSubmissions(
    ref.watch(inspectionSubmissionQueueProvider),
    userId: workspace?.userId ?? '',
  );
});

/// Every queued item not yet sent, live: queued commands not yet `synced`
/// for the active workspace (a Drift watch over `pending_commands`) PLUS
/// this person's inspection submissions not yet `synced`
/// ([pendingInspectionSubmissionsProvider], polled).
///
/// Emits 0 when there is no active [WorkspaceContext] - with nobody signed
/// into a workspace nothing is queued for this screen to report. A read
/// failure of EITHER queue stays an [AsyncError] so the screen renders `-`,
/// never a number that silently left one queue out.
final StreamProvider<int> profilePendingSyncCountProvider =
    StreamProvider<int>((ref) {
  final WorkspaceContext? workspace = ref.watch(workspaceContextProvider);
  if (workspace == null) return Stream<int>.value(0);
  final AppDatabase db = ref.watch(appDatabaseProvider);
  final Stream<int> commands = db.queueDao.watchPendingCount(
    workspaceId: workspaceIdFor(workspace),
  );
  final Stream<int> inspections = watchUserInspectionSubmissions(
    ref.watch(inspectionSubmissionQueueProvider),
    userId: workspace.userId,
  ).map(pendingInspectionCount);
  return combineLatestPair<int, int, int>(
    commands,
    inspections,
    (int a, int b) => a + b,
  ).distinct();
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

/// Which draft table a [ProfileDraftEntry] lives in.
enum ProfileDraftKind { checklist, inspection }

/// One unfinished draft with real content, as the Drafts screen lists it.
final class ProfileDraftEntry {
  const ProfileDraftEntry({
    required this.kind,
    required this.draftKey,
    required this.assetNo,
    required this.filled,
    required this.total,
    required this.updatedAt,
    this.templateId,
    this.templateName,
    this.title,
    this.site,
    this.vehicleType,
  });

  final ProfileDraftKind kind;
  final String draftKey;

  /// Normalised asset number; may be empty for a checklist started before a
  /// machine was picked.
  final String assetNo;
  final int filled;
  final int total;
  final DateTime updatedAt;

  /// Checklist drafts only.
  final String? templateId;
  final String? templateName;
  final String? title;

  final String? site;

  /// Inspection drafts only.
  final String? vehicleType;
}

/// Unfinished drafts (checklist + inspection) with real content that are
/// stored on THIS device for the signed-in user, newest first - the same
/// "has content" test both draft repositories use, so a template somebody
/// merely opened is not listed. A database failure stays an [AsyncError] so
/// the screen shows an error, never an empty list.
final FutureProvider<List<ProfileDraftEntry>> profileDraftEntriesProvider =
    FutureProvider<List<ProfileDraftEntry>>((ref) async {
  final WorkspaceContext? workspace = ref.watch(workspaceContextProvider);
  final String userId = workspace?.userId.trim() ?? '';
  if (userId.isEmpty) return const <ProfileDraftEntry>[];
  // Re-read whenever the queue moves (a submit detaches a draft).
  ref.watch(profilePendingSyncCountProvider);
  final AppDatabase db = ref.watch(appDatabaseProvider);
  final List<ProfileDraftEntry> entries = <ProfileDraftEntry>[];
  for (final draft in await db.draftsDao.checklistDraftsForUser(userId)) {
    if (await db.draftsDao.draftHasContent(
      ownerKind: OwnerKind.checklistDraft,
      ownerKey: draft.draftKey,
      filled: draft.filled,
    )) {
      entries.add(
        ProfileDraftEntry(
          kind: ProfileDraftKind.checklist,
          draftKey: draft.draftKey,
          assetNo: draft.assetNo,
          filled: draft.filled,
          total: draft.total,
          updatedAt: draft.updatedAt,
          templateId: draft.templateId,
          templateName: draft.templateName,
          title: draft.title,
          site: draft.site,
        ),
      );
    }
  }
  for (final draft in await db.draftsDao.inspectionDraftsForUser(userId)) {
    if (await db.draftsDao.draftHasContent(
      ownerKind: OwnerKind.inspectionDraft,
      ownerKey: draft.draftKey,
      filled: draft.filled,
    )) {
      entries.add(
        ProfileDraftEntry(
          kind: ProfileDraftKind.inspection,
          draftKey: draft.draftKey,
          assetNo: draft.assetNo,
          filled: draft.filled,
          total: draft.total,
          updatedAt: draft.updatedAt,
          site: draft.site,
          vehicleType: draft.vehicleType,
        ),
      );
    }
  }
  entries.sort(
    (ProfileDraftEntry a, ProfileDraftEntry b) =>
        b.updatedAt.compareTo(a.updatedAt),
  );
  return entries;
});

/// How many [profileDraftEntriesProvider] lists: the Profile tile and the
/// Offline drafts row. A database failure stays an [AsyncError] so the
/// screen renders `-`, never 0.
final FutureProvider<int> profileDraftCountProvider =
    FutureProvider<int>((ref) async {
  final List<ProfileDraftEntry> entries =
      await ref.watch(profileDraftEntriesProvider.future);
  return entries.length;
});

/// Discards one draft through the existing draft delete path
/// (`DraftsDao.discardChecklistDraft` / `discardInspectionDraft`), then
/// deletes the photo files that belonged only to it. Rows first, files
/// after, exactly as those methods require.
final Provider<Future<void> Function(ProfileDraftEntry entry)>
    profileDraftDiscardProvider =
    Provider<Future<void> Function(ProfileDraftEntry entry)>((ref) {
  final AppDatabase db = ref.watch(appDatabaseProvider);
  return (ProfileDraftEntry entry) async {
    final List<String> paths = switch (entry.kind) {
      ProfileDraftKind.checklist =>
        await db.draftsDao.discardChecklistDraft(entry.draftKey),
      ProfileDraftKind.inspection =>
        await db.draftsDao.discardInspectionDraft(entry.draftKey),
    };
    for (final String path in paths) {
      try {
        final File file = File(path);
        if (file.existsSync()) await file.delete();
      } on Object {
        // Best effort: the rows are already gone, so a leftover file is
        // orphaned storage, not lost work.
      }
    }
  };
});
