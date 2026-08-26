/// Values stored in the local database as TEXT, plus the retention and retry
/// policy the offline queue runs under.
///
/// These are plain `String` constants rather than Dart enums on purpose. The
/// stored form must match artifact 05 exactly (`checklist_draft`, not
/// `checklistDraft`), and a Dart enum name cannot carry an underscore without
/// fighting the linter. Constants keep the on-disk vocabulary and the Dart
/// source identical, which is what a reader auditing this against artifact 05
/// needs.
///
/// Source: docs/flutter-migration/05-local-database-schema.md sections 2.7,
/// 2.10, 2.11, 2.12, 2.13, 2.14 and 8.1.
library;

/// The six states a queued command may hold. Artifact 05 section 2.12.
///
/// The React Native queue has only three (`pending`, `synced`, `failed`). The
/// two additions matter:
///
/// - [processing] means the sync engine has claimed the row. A crash mid-flight
///   leaves the row visibly stuck rather than silently re-runnable, and the
///   engine can reclaim a claim older than a timeout.
/// - [blocked] means nothing is wrong with the row, it simply may not run yet:
///   a `dependsOn` predecessor has not succeeded, or the row was captured in a
///   workspace that is no longer active. That is not a failure and must not be
///   reported as one.
abstract final class CommandStatus {
  static const String pending = 'pending';
  static const String processing = 'processing';
  static const String retry = 'retry';
  static const String blocked = 'blocked';
  static const String failed = 'failed';
  static const String synced = 'synced';

  /// Every value, for validation at the repository boundary.
  static const List<String> all = <String>[
    pending,
    processing,
    retry,
    blocked,
    failed,
    synced,
  ];

  /// The statuses the sync engine may claim. [blocked] is deliberately absent:
  /// a blocked row is waiting on a decision, not on a turn.
  static const List<String> claimable = <String>[pending, retry];
}

/// The six-state photo machine from artifact 05 section 4.1.
///
/// The local file may only be deleted in state [verified]: the owning command
/// row reached the server carrying this photo's `tp-storage://` reference. An
/// object sitting in a bucket that no database row references is unreachable,
/// so [uploaded] is NOT far enough.
abstract final class MediaUploadState {
  /// Copied out of the OS cache directory into the durable folder. Not yet
  /// attached to a command.
  static const String local = 'local';

  /// Attached to a `pending_commands` row and awaiting its turn.
  static const String queued = 'queued';

  /// Claimed by the uploader.
  static const String uploading = 'uploading';

  /// Storage accepted the object and `remoteRef` is set. The local file still
  /// may not be deleted.
  static const String uploaded = 'uploaded';

  /// The owning command reached `synced` carrying this reference. Only now is
  /// the local file safe to remove.
  static const String verified = 'verified';

  /// Refused after its attempts, or the local file is gone.
  static const String failed = 'failed';

  static const List<String> all = <String>[
    local,
    queued,
    uploading,
    uploaded,
    verified,
    failed,
  ];

  /// The states the uploader may claim work from.
  static const List<String> claimable = <String>[queued, uploading];
}

/// How a sync failure is classified. Artifact 05 section 2.14.
///
/// This, and never the message text, decides whether a retry happens. Anything
/// not positively recognised as a server verdict is treated as transient,
/// because the cost of guessing "transient" is a retry and the cost of guessing
/// "definitive" is a field worker signed out of an app they cannot sign back
/// into.
abstract final class SyncErrorClass {
  static const String network = 'network';
  static const String auth = 'auth';
  static const String permission = 'permission';
  static const String validation = 'validation';
  static const String conflict = 'conflict';
  static const String unknown = 'unknown';

  static const List<String> all = <String>[
    network,
    auth,
    permission,
    validation,
    conflict,
    unknown,
  ];

  /// Classes worth retrying unchanged. A validation or permission refusal will
  /// refuse identically on the next attempt.
  static const List<String> retryable = <String>[network, unknown];
}

/// What a photo or a signature belongs to. Artifact 05 sections 2.10 and 2.11.
///
/// There is deliberately no `approval` kind. Artifact 06 section 4 establishes
/// that `CHECKLIST_APPROVAL` is a decision, not an observation, and must go
/// through `decide_checklist_approval` while online. A signature sitting in a
/// local table waiting to approve something IS a decision queued offline, which
/// spec section 14 forbids. The absence of the value is the enforcement.
abstract final class OwnerKind {
  static const String checklistDraft = 'checklist_draft';
  static const String inspectionDraft = 'inspection_draft';
  static const String pendingCommand = 'pending_command';

  /// Kinds a draft photo may belong to. A photo never belongs to a command:
  /// queue media lives in `pending_media_uploads`, in its own folder, with its
  /// own sweep. Artifact 05 section 4.3.
  static const List<String> draftOwners = <String>[
    checklistDraft,
    inspectionDraft,
  ];

  static const List<String> signatureOwners = <String>[
    checklistDraft,
    inspectionDraft,
    pendingCommand,
  ];
}

/// The two payload shapes a signature may take, and where it came from.
///
/// Both formats are accepted deliberately: the checklist path emits a
/// self-contained `<svg>` document and the canvas pad emits a `data:image/...`
/// URL. Anything else is not a mark this app draws, and storing it would put an
/// arbitrary string in front of a reader as though it were a signature. That
/// refusal is the guard against the recorded placeholder defect.
abstract final class SignatureFormat {
  static const String svg = 'svg';
  static const String dataUrl = 'dataurl';

  static const List<String> all = <String>[svg, dataUrl];
}

/// Where a mark came from. Printed, not decoration: otherwise "my signature
/// came from somewhere" is indistinguishable from "the app signed for me".
abstract final class SignatureSource {
  static const String drawn = 'drawn';
  static const String saved = 'saved';
  static const String none = 'none';

  static const List<String> all = <String>[drawn, saved, none];
}

/// A cached permission row is either a grant or a revoke.
///
/// A revoke always beats a grant, and a cache miss is never an allow: an empty
/// local table means "permissions have not loaded", which renders the role
/// default, not a blank app and not an open one.
abstract final class PermissionEffect {
  static const String grant = 'grant';
  static const String revoke = 'revoke';

  static const List<String> all = <String>[grant, revoke];
}

/// The reserved field key for a template-level signature pad.
///
/// It is a reserved VALUE rather than a nullable column on purpose. SQLite
/// treats NULLs as distinct in a unique index, so a nullable `fieldKey` would
/// let several unnamed signatures coexist under one owner - quietly restoring
/// the shared slot that let three trades overwrite one another.
const String primarySignatureFieldKey = '__primary__';

/// Mirrors `user_signatures_len_chk` in MIGRATIONS_V601. A value the server
/// column would refuse must be refused here too, or the screen offers to save
/// something the server throws away.
const int signatureMaxLength = 200000;

/// Retry policy for the offline queue. Ported unchanged from the React Native
/// implementation. Artifact 05 section 2.12.
abstract final class QueueRetryPolicy {
  /// After this many failed attempts the row goes `failed`, stays in the table,
  /// and waits for a person. It is never discarded.
  static const int maxRetries = 8;

  static const Duration baseBackoff = Duration(seconds: 30);
  static const Duration maxBackoff = Duration(minutes: 30);

  /// A claim older than this is considered abandoned by a crashed sync run and
  /// may be reclaimed. Without it a crash mid-flight strands the row in
  /// `processing` forever.
  static const Duration claimTimeout = Duration(minutes: 5);

  /// `30s * 2^attempts`, capped at 30 minutes.
  ///
  /// [attemptsAlreadyMade] is the retry count BEFORE this failure is recorded,
  /// so the first retry waits 30 seconds, the second 60, and so on.
  static Duration backoffFor(int attemptsAlreadyMade) {
    if (attemptsAlreadyMade <= 0) {
      return baseBackoff;
    }
    // Clamped before shifting: 2^32 seconds overflows nothing useful and the
    // cap applies long before this bound is reached.
    final int exponent = attemptsAlreadyMade > 16 ? 16 : attemptsAlreadyMade;
    final int seconds = baseBackoff.inSeconds << exponent;
    if (seconds >= maxBackoff.inSeconds) {
      return maxBackoff;
    }
    return Duration(seconds: seconds);
  }
}

/// Count-based caps. Artifact 05 section 8.1.
///
/// Count, not age, wherever the source says so. Age-based deletion of unsynced
/// or diagnostic data punishes the offline device hardest, which is exactly
/// backwards for a field app: it deletes the diagnosis of the device whose
/// failures matter most.
///
/// Note what is NOT here: `pending_commands` has no cap. Nothing that has not
/// reached the server is pruned automatically, by age, by count or by a cap.
abstract final class RetentionLimits {
  /// Ported from `MAX_DRAFTS` in the React Native checklist draft store.
  static const int checklistDrafts = 25;

  /// The same rule for the inspection draft table.
  static const int inspectionDrafts = 25;

  /// Keep the newest failures for diagnostics.
  static const int syncFailures = 200;

  /// A list nobody scrolls past 50.
  static const int recentSearches = 50;

  /// `cached_tyres` is populated on demand, not mirrored. A cap keeps the
  /// working set warm without copying the whole tyre history onto the handset.
  static const int cachedTyres = 2000;
}

/// The named facts `sync_metadata` holds. Artifact 05 section 2.15.
///
/// Keys are built rather than typed at the call site so a repository cannot
/// invent a near-miss spelling that then reads back as absent.
abstract final class SyncMetadataKeys {
  /// Per cached table, so staleness is per feed and not one global timestamp.
  static String cacheLastFullSyncAt(String table) =>
      'cache.$table.lastFullSyncAt';

  /// What the last sync actually stored, so a truncated page is detectable.
  static String cacheRowCount(String table) => 'cache.$table.rowCount';

  /// True when a paged read hit its ceiling. Must be surfaced, never
  /// swallowed: a silently short list reads to a user as "that asset was never
  /// created".
  static String cacheTruncated(String table) => 'cache.$table.truncated';

  static const String syncLockHolder = 'sync.lockHolder';
  static const String syncLockAcquiredAt = 'sync.lockAcquiredAt';
  static const String syncLastRunAt = 'sync.lastRunAt';
  static const String syncLastResult = 'sync.lastResult';
  static const String profileCached = 'profile.cached';
  static const String schemaMigratedAt = 'schema.migratedAt';
  static const String queueDrainedForUpgradeAt = 'queue.drainedForUpgradeAt';
}

/// Bounded fan-out for photo uploads. Artifact 05 section 4.4.
///
/// A `Future.wait` over every tyre position decoded one full-size bitmap per
/// tyre at once - 13 on a Tr-Mixer, roughly 600 MB peak - which is a hard
/// native out-of-memory crash on the 2 GB handsets this fleet uses. The
/// inspector lost the work with no error and the queue then replayed the crash.
const int uploadConcurrency = 2;

/// A row that has crashed the app twice must go `failed` and be reported,
/// rather than retried a third time into the same crash loop.
const int maxUploadAttempts = 3;
