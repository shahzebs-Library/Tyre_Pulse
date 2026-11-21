/// One place that builds the physical inventory outbox for this device and
/// decides WHOSE outbox may be flushed, shared by the foreground app
/// (`physicalCaptureOutboxProvider`, `PhysicalOutboxSyncBinding`) and the
/// headless background isolate (`core/sync/background_sync.dart`).
///
/// # The user rule
///
/// A flush only ever runs for the account that is signed in RIGHT NOW, and in
/// the background only when that account is also the one the device's cached
/// workspace belongs to. A shared phone therefore never sends, or even reads,
/// another person's captures: the outbox slot is keyed by user id
/// (`PhysicalCaptureOutbox.slotFor`) and this runner refuses any other id.
///
/// # Safe to run from two isolates
///
/// The foreground screen and the background worker may flush at the same
/// time. Nothing is duplicated because the server keys the capture and every
/// photo by its own client_uuid, a photo's storage path is deterministic
/// (`piPhotoPath`) and an object already at that path counts as uploaded
/// (`PhysicalInventoryRepository.upload`). A capture is removed from the phone
/// only after the server confirmed the capture and every photo.
library;

import 'dart:io';

import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/features/inventory/data/count_photo_capture.dart';
import 'package:tyre_pulse/features/inventory/data/physical_capture_outbox.dart';
import 'package:tyre_pulse/features/inventory/data/physical_inventory_repository.dart';

/// The secure-store slot that holds this device's inventory device id
/// (written by `inventoryDeviceIdProvider`).
const String inventoryDeviceIdSlot = 'inventory_device_id_v1';

/// Reads a photo file from disk. "Gone" and "could not read right now" are
/// different outcomes (see [PhotoRead]).
Future<PhotoRead> readPhysicalPhotoFile(String path) async {
  final File f = File(path);
  if (!f.existsSync()) return const PhotoMissing();
  try {
    return PhotoBytes(await f.readAsBytes());
  } on Object catch (e) {
    return PhotoReadError(e);
  }
}

/// The device outbox, reading and deleting real photo files. Files are
/// deleted only after the server confirmed them (inside `flush`).
PhysicalCaptureOutbox buildDevicePhysicalOutbox(SecureKeyValueStore store) =>
    PhysicalCaptureOutbox(
      store,
      readBytes: readPhysicalPhotoFile,
      deleteFile: (String p) => CountPhotoCapture.discardUploaded(<String>[p]),
    );

/// The saved device id, or null when none was saved yet or the store could
/// not be read. Never creates one: only the foreground provider does that.
Future<String?> readSavedInventoryDeviceId(SecureKeyValueStore store) async {
  try {
    final read = await store.read(inventoryDeviceIdSlot);
    final String? v = read.isOk ? read.value : null;
    return (v == null || v.isEmpty) ? null : v;
  } on Object {
    return null;
  }
}

/// Why [flushPhysicalOutboxFor] did not flush.
enum PhysicalFlushSkip { notSignedIn, otherUser, noOrganisation }

/// The outcome of [flushPhysicalOutboxFor]: either a flush result or the
/// reason it was skipped.
final class PhysicalFlushOutcome {
  const PhysicalFlushOutcome.flushed(OutboxFlushResult this.result)
      : skipped = null;
  const PhysicalFlushOutcome.skipped(PhysicalFlushSkip this.skipped)
      : result = null;

  final OutboxFlushResult? result;
  final PhysicalFlushSkip? skipped;
}

/// Flushes the outbox of [signedInUserId] only.
///
/// [expectedUserId], when given, is the user the caller's context belongs to
/// (the background worker passes the cached workspace's user). A mismatch
/// means another person signed in since: nothing is read or sent.
/// [orgId] is `profiles.org_id` (the tenant the server checks photo paths
/// against); without it no photo path can be built, so nothing is sent.
Future<PhysicalFlushOutcome> flushPhysicalOutboxFor({
  required PhysicalCaptureOutbox outbox,
  required PhysicalInventoryRepository repository,
  required String? signedInUserId,
  required String? orgId,
  String? expectedUserId,
  String? deviceId,
}) async {
  if (signedInUserId == null || signedInUserId.isEmpty) {
    return const PhysicalFlushOutcome.skipped(PhysicalFlushSkip.notSignedIn);
  }
  if (expectedUserId != null && expectedUserId != signedInUserId) {
    return const PhysicalFlushOutcome.skipped(PhysicalFlushSkip.otherUser);
  }
  if (orgId == null || orgId.isEmpty) {
    return const PhysicalFlushOutcome.skipped(PhysicalFlushSkip.noOrganisation);
  }
  final OutboxFlushResult r = await outbox.flush(
    userId: signedInUserId,
    orgId: orgId,
    repository: repository,
    deviceId: deviceId,
  );
  return PhysicalFlushOutcome.flushed(r);
}

/// The background worker's entry: builds the device outbox over [store],
/// reads the saved device id and flushes [signedInUserId]'s outbox when it is
/// also [workspaceUserId]. Never throws - a background run has no screen to
/// report to, and everything that was not confirmed stays on the phone for
/// the next run (periodic, connectivity or foreground). Returns null when the
/// flush itself failed.
Future<PhysicalFlushOutcome?> flushPhysicalOutboxInBackground({
  required SecureKeyValueStore store,
  required PhysicalInventoryRepository repository,
  required String? signedInUserId,
  required String workspaceUserId,
  required String? orgId,
  PhysicalCaptureOutbox? outbox,
}) async {
  // The user rule first, before anything of this device is read.
  if (signedInUserId == null || signedInUserId.isEmpty) {
    return const PhysicalFlushOutcome.skipped(PhysicalFlushSkip.notSignedIn);
  }
  if (signedInUserId != workspaceUserId) {
    return const PhysicalFlushOutcome.skipped(PhysicalFlushSkip.otherUser);
  }
  try {
    return await flushPhysicalOutboxFor(
      outbox: outbox ?? buildDevicePhysicalOutbox(store),
      repository: repository,
      signedInUserId: signedInUserId,
      expectedUserId: workspaceUserId,
      orgId: orgId,
      deviceId: await readSavedInventoryDeviceId(store),
    );
  } on Object {
    return null;
  }
}
