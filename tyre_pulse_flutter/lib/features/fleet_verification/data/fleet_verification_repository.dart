/// "Verify on site" - offline-safe outbox and Supabase calls.
///
/// # Why a feature-local outbox, not a new `CommandType`
///
/// The shared queue (`core/sync/command_registry.dart`) is being edited by
/// another lane this round, so this feature does not add a command there.
/// It keeps a small durable outbox of its own (SharedPreferences, per user)
/// with the same guarantees the shared queue gives an RPC command:
///
/// * the verification id is minted ONCE when the supervisor saves and is the
///   RPC's `p_client_uuid`, so a replay after a lost response is a no-op
///   server-side (`submit_fleet_verification` is idempotent on it);
/// * the photo stays on the device until it is uploaded to its own unique
///   path (`<org>/<COUNTRY>/<ASSET>/verify/<id>.jpg`), and only then is the
///   verification sent - the server refuses a photo path that is not
///   uploaded yet (PT409), which the outbox treats as "try again";
/// * a refusal that can never succeed (permission 42501, bad input 22023) is
///   kept on the device as failed with the server's sentence, never retried
///   blindly and never silently dropped.
///
/// Moving this onto the shared queue later = add `CommandType.fleetVerification`
/// (operation rpc, `submit_fleet_verification`, requiresMediaReady) and a
/// media pusher like `JobCompletionEvidenceCommandPusher`.
library;

import 'dart:convert';
import 'dart:io';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/features/fleet_verification/domain/fleet_verification_rules.dart';
import 'package:uuid/uuid.dart';

const String fleetVerificationBucket = 'vehicle-photos';

/// One saved verification, waiting to reach the server or already failed.
final class QueuedVerification {
  const QueuedVerification({
    required this.id,
    required this.vehicleId,
    required this.assetNo,
    required this.outcome,
    required this.createdAt,
    this.orgId,
    this.country,
    this.observedAssetNo,
    this.observedPlate,
    this.observedChassis,
    this.otherCountry,
    this.note,
    this.lat,
    this.lng,
    this.accuracyM,
    this.localPhotoPath,
    this.photoPath,
    this.attempts = 0,
    this.failedMessage,
  });

  factory QueuedVerification.fromJson(Map<String, dynamic> j) =>
      QueuedVerification(
        id: j['id'] as String,
        vehicleId: j['vehicleId'] as String,
        assetNo: j['assetNo'] as String? ?? '',
        outcome: j['outcome'] as String,
        createdAt: DateTime.tryParse(j['createdAt'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
        orgId: j['orgId'] as String?,
        country: j['country'] as String?,
        observedAssetNo: j['observedAssetNo'] as String?,
        observedPlate: j['observedPlate'] as String?,
        observedChassis: j['observedChassis'] as String?,
        otherCountry: j['otherCountry'] as String?,
        note: j['note'] as String?,
        lat: (j['lat'] as num?)?.toDouble(),
        lng: (j['lng'] as num?)?.toDouble(),
        accuracyM: (j['accuracyM'] as num?)?.toDouble(),
        localPhotoPath: j['localPhotoPath'] as String?,
        photoPath: j['photoPath'] as String?,
        attempts: (j['attempts'] as num?)?.toInt() ?? 0,
        failedMessage: j['failedMessage'] as String?,
      );

  final String id;
  final String vehicleId;
  final String assetNo;
  final String outcome;
  final DateTime createdAt;
  final String? orgId;
  final String? country;
  final String? observedAssetNo;
  final String? observedPlate;
  final String? observedChassis;
  final String? otherCountry;
  final String? note;
  final double? lat;
  final double? lng;
  final double? accuracyM;
  final String? localPhotoPath;

  /// The uploaded storage path, set once the photo reached the bucket.
  final String? photoPath;
  final int attempts;

  /// Non-null = the server refused it for good; kept so the person sees why.
  final String? failedMessage;

  bool get failed => failedMessage != null;

  QueuedVerification copyWith({
    String? photoPath,
    int? attempts,
    String? failedMessage,
  }) =>
      QueuedVerification(
        id: id,
        vehicleId: vehicleId,
        assetNo: assetNo,
        outcome: outcome,
        createdAt: createdAt,
        orgId: orgId,
        country: country,
        observedAssetNo: observedAssetNo,
        observedPlate: observedPlate,
        observedChassis: observedChassis,
        otherCountry: otherCountry,
        note: note,
        lat: lat,
        lng: lng,
        accuracyM: accuracyM,
        localPhotoPath: localPhotoPath,
        photoPath: photoPath ?? this.photoPath,
        attempts: attempts ?? this.attempts,
        failedMessage: failedMessage ?? this.failedMessage,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'vehicleId': vehicleId,
        'assetNo': assetNo,
        'outcome': outcome,
        'createdAt': createdAt.toIso8601String(),
        'orgId': orgId,
        'country': country,
        'observedAssetNo': observedAssetNo,
        'observedPlate': observedPlate,
        'observedChassis': observedChassis,
        'otherCountry': otherCountry,
        'note': note,
        'lat': lat,
        'lng': lng,
        'accuracyM': accuracyM,
        'localPhotoPath': localPhotoPath,
        'photoPath': photoPath,
        'attempts': attempts,
        'failedMessage': failedMessage,
      };

  /// The RPC arguments. Pure, so it is unit-tested.
  Map<String, dynamic> rpcParams() => <String, dynamic>{
        'p_client_uuid': id,
        'p_vehicle_id': vehicleId,
        'p_outcome': outcome,
        'p_observed_asset_no': _blankToNull(observedAssetNo),
        'p_observed_plate': _blankToNull(observedPlate),
        'p_observed_chassis': _blankToNull(observedChassis),
        'p_photo_path': photoPath,
        'p_lat': lat,
        'p_lng': lng,
        'p_accuracy_m': accuracyM,
        'p_other_country': outcome == FleetVerificationOutcome.otherCountry.wire
            ? _blankToNull(otherCountry)
            : null,
        'p_note': _blankToNull(note),
      };
}

String? _blankToNull(String? v) {
  final String s = (v ?? '').trim();
  return s.isEmpty ? null : s;
}

/// How a send attempt ended.
enum SendOutcome { sent, retryLater, failed, notSetUp }

/// Local failure reasons, stored with a leading '@' and translated in the UI.
const String failedPhotoMissing = '@photoMissing';
const String failedRetryLimit = '@retryLimit';

/// After this many failed sends a verification stops retrying and is shown
/// as failed, so a phone never retries forever in the background.
const int maxVerificationAttempts = 20;

/// Classifies a server error. Pure, so it is unit-tested.
SendOutcome classifyVerificationError(String? code, [String? message]) {
  if (code == 'PT409' &&
      (message ?? '').toLowerCase().contains('already used')) {
    return SendOutcome.failed;
  }
  switch (code) {
    case 'PGRST202':
    case 'PGRST205':
    case '42883':
    case '42P01':
      return SendOutcome.notSetUp;
    case '42501':
    case '22023':
    case '23514':
      return SendOutcome.failed;
    default:
      // PT409 (photo not uploaded yet / stale), network, 5xx: try again.
      return SendOutcome.retryLater;
  }
}

/// Durable per-user store.
final class FleetVerificationOutbox {
  FleetVerificationOutbox(this._prefs, this._userId);

  final SharedPreferences _prefs;
  final String _userId;

  String get _key => 'fleet_verification_outbox_v1_$_userId';

  List<QueuedVerification> read() {
    final String? raw = _prefs.getString(_key);
    if (raw == null || raw.isEmpty) return <QueuedVerification>[];
    try {
      final List<dynamic> list = jsonDecode(raw) as List<dynamic>;
      return <QueuedVerification>[
        for (final dynamic e in list)
          if (e is Map<String, dynamic>) QueuedVerification.fromJson(e),
      ];
    } on FormatException {
      return <QueuedVerification>[];
    }
  }

  Future<void> write(List<QueuedVerification> items) => _prefs.setString(
        _key,
        jsonEncode(<Map<String, dynamic>>[
          for (final QueuedVerification i in items) i.toJson(),
        ]),
      );

  Future<void> add(QueuedVerification item) async {
    final List<QueuedVerification> all = read()
      ..removeWhere((QueuedVerification i) => i.id == item.id)
      ..add(item);
    await write(all);
  }

  Future<void> replace(QueuedVerification item) async {
    final List<QueuedVerification> all = read();
    final int i = all.indexWhere((QueuedVerification e) => e.id == item.id);
    if (i >= 0) all[i] = item;
    await write(all);
  }

  Future<void> remove(String id) async {
    await write(read()..removeWhere((QueuedVerification i) => i.id == id));
  }
}

/// Server side of the feature.
abstract interface class FleetVerificationRemote {
  Future<void> uploadPhoto(String storagePath, File file);
  Future<Map<String, dynamic>> submit(Map<String, dynamic> params);
  Future<List<VerificationVehicle>> peers({
    required String orgId,
    required String? country,
  });
  Future<String?> imagePath(String vehicleId);

  /// Plate and chassis as on file now (the asset model carries no chassis).
  Future<({String? registrationNo, String? chassisNo})> identity(
    String vehicleId,
  );
  Future<String?> signedUrl(String path);
}

final class SupabaseFleetVerificationRemote implements FleetVerificationRemote {
  SupabaseFleetVerificationRemote(this._client);

  final SupabaseClient _client;

  @override
  Future<void> uploadPhoto(String storagePath, File file) async {
    try {
      await _client.storage.from(fleetVerificationBucket).upload(
            storagePath,
            file,
            fileOptions: const FileOptions(contentType: 'image/jpeg'),
          );
    } on StorageException catch (e) {
      // A retry finds its own photo already uploaded: that is success.
      if (e.statusCode == '409' ||
          e.message.toLowerCase().contains('exist') ||
          e.message.toLowerCase().contains('duplicate')) {
        return;
      }
      rethrow;
    }
  }

  @override
  Future<Map<String, dynamic>> submit(Map<String, dynamic> params) async {
    final dynamic res =
        await _client.rpc<dynamic>('submit_fleet_verification', params: params);
    return res is Map<String, dynamic> ? res : <String, dynamic>{};
  }

  @override
  Future<List<VerificationVehicle>> peers({
    required String orgId,
    required String? country,
  }) async {
    final List<VerificationVehicle> out = <VerificationVehicle>[];
    for (int from = 0; from < 20000; from += 1000) {
      var q = _client
          .from('vehicle_fleet')
          .select('id,registration_no,chassis_no')
          .eq('organisation_id', orgId);
      q = country == null
          ? q.isFilter('country', null)
          : q.eq('country', country);
      final List<Map<String, dynamic>> rows =
          await q.order('id').range(from, from + 999);
      for (final Map<String, dynamic> r in rows) {
        out.add(
          VerificationVehicle(
            id: r['id'] as String,
            registrationNo: r['registration_no'] as String?,
            chassisNo: r['chassis_no'] as String?,
          ),
        );
      }
      if (rows.length < 1000) break;
    }
    return out;
  }

  @override
  Future<String?> imagePath(String vehicleId) async {
    final Map<String, dynamic>? row = await _client
        .from('vehicle_fleet')
        .select('image_path')
        .eq('id', vehicleId)
        .maybeSingle();
    final String? p = row?['image_path'] as String?;
    return (p == null || p.trim().isEmpty) ? null : p.trim();
  }

  @override
  Future<({String? registrationNo, String? chassisNo})> identity(
    String vehicleId,
  ) async {
    final Map<String, dynamic>? row = await _client
        .from('vehicle_fleet')
        .select('registration_no,chassis_no')
        .eq('id', vehicleId)
        .maybeSingle();
    return (
      registrationNo: row?['registration_no'] as String?,
      chassisNo: row?['chassis_no'] as String?,
    );
  }

  @override
  Future<String?> signedUrl(String path) async {
    try {
      return await _client.storage
          .from(fleetVerificationBucket)
          .createSignedUrl(path, 3600);
    } on Object {
      return null;
    }
  }
}

/// Saves to the outbox, then tries to send everything waiting.
final class FleetVerificationService {
  FleetVerificationService(this._outbox, this._remote, {this.photoDir});

  final FleetVerificationOutbox _outbox;
  final FleetVerificationRemote _remote;

  /// Durable folder for evidence photos (app documents). The picker's file can
  /// live in a cache the OS clears, so the photo is copied here at save time.
  final Future<Directory> Function()? photoDir;

  static const Uuid _uuid = Uuid();
  static String newId() => _uuid.v4();

  List<QueuedVerification> waiting() => _outbox.read();

  Future<void> discard(String id) => _outbox.remove(id);

  /// Saves first (never lost), then sends. Returns this item's outcome.
  Future<SendOutcome> save(QueuedVerification item) async {
    final QueuedVerification durable = await _keepPhoto(item);
    await _outbox.add(durable);
    return sendOne(durable);
  }

  Future<QueuedVerification> _keepPhoto(QueuedVerification item) async {
    final String? local = item.localPhotoPath;
    final Future<Directory> Function()? dirOf = photoDir;
    if (local == null || dirOf == null) return item;
    final File src = File(local);
    if (!src.existsSync()) return item;
    final Directory base = Directory('${(await dirOf()).path}/fleet_verify');
    if (!base.existsSync()) base.createSync(recursive: true);
    final File copy = await src.copy('${base.path}/${item.id}.jpg');
    return QueuedVerification.fromJson(
      <String, dynamic>{...item.toJson(), 'localPhotoPath': copy.path},
    );
  }

  Future<SendOutcome> sendOne(QueuedVerification start) async {
    QueuedVerification item = start;
    if (item.failed) return SendOutcome.failed;
    try {
      final String? local = item.localPhotoPath;
      if (local != null && item.photoPath == null) {
        final File file = File(local);
        if (!file.existsSync()) {
          // Never send a check without the photo it was saved with.
          await _outbox
              .replace(item.copyWith(failedMessage: failedPhotoMissing));
          return SendOutcome.failed;
        }
        final String path = verificationPhotoPath(
          orgId: item.orgId,
          country: item.country,
          assetNo: item.assetNo,
          verificationId: item.id,
        );
        await _remote.uploadPhoto(path, file);
        item = item.copyWith(photoPath: path);
        await _outbox.replace(item);
      }
      await _remote.submit(item.rpcParams());
      await _outbox.remove(item.id);
      if (local != null) {
        try {
          final File f = File(local);
          if (f.existsSync()) f.deleteSync();
        } on Object {
          // Leaving a sent photo behind is harmless.
        }
      }
      return SendOutcome.sent;
    } on PostgrestException catch (e) {
      final SendOutcome o = classifyVerificationError(e.code, e.message);
      if (o == SendOutcome.failed) {
        await _outbox.replace(item.copyWith(failedMessage: e.message));
        return o;
      }
      return _retry(item, o);
    } on Object {
      return _retry(item, SendOutcome.retryLater);
    }
  }

  Future<SendOutcome> _retry(QueuedVerification item, SendOutcome o) async {
    final int attempts = item.attempts + 1;
    if (attempts >= maxVerificationAttempts) {
      await _outbox.replace(
        item.copyWith(attempts: attempts, failedMessage: failedRetryLimit),
      );
      return SendOutcome.failed;
    }
    await _outbox.replace(item.copyWith(attempts: attempts));
    return o;
  }

  /// Sends every waiting (not failed) item. Returns how many reached the server.
  Future<int> flush() async {
    int sent = 0;
    for (final QueuedVerification i in _outbox.read()) {
      if (i.failed) continue;
      if (await sendOne(i) == SendOutcome.sent) sent += 1;
    }
    return sent;
  }
}
