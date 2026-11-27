import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/features/fleet_verification/data/fleet_verification_repository.dart';
import 'package:tyre_pulse/features/fleet_verification/domain/fleet_verification_rules.dart';

final class _Remote implements FleetVerificationRemote {
  _Remote(this.onSubmit);
  final Future<Map<String, dynamic>> Function(Map<String, dynamic>) onSubmit;
  final List<String> uploads = <String>[];
  @override
  Future<({String? registrationNo, String? chassisNo})> identity(
    String id,
  ) async =>
      (registrationNo: null, chassisNo: null);
  @override
  Future<String?> imagePath(String id) async => null;
  @override
  Future<List<VerificationVehicle>> peers({
    required String orgId,
    required String? country,
  }) async =>
      const <VerificationVehicle>[];
  @override
  Future<String?> signedUrl(String path) async => null;
  @override
  Future<Map<String, dynamic>> submit(Map<String, dynamic> params) =>
      onSubmit(params);
  @override
  Future<void> uploadPhoto(String storagePath, File file) async =>
      uploads.add(storagePath);
}

QueuedVerification _item({String? photo}) => QueuedVerification(
      id: 'id-1',
      vehicleId: 'v1',
      assetNo: 'TM514',
      outcome: 'present',
      createdAt: DateTime(2026),
      orgId: 'org1',
      country: 'KSA',
      localPhotoPath: photo,
    );

void main() {
  late Directory tmp;
  setUp(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    tmp = Directory.systemTemp.createTempSync('fv');
  });
  tearDown(() => tmp.deleteSync(recursive: true));

  Future<FleetVerificationService> service(_Remote r) async =>
      FleetVerificationService(
        FleetVerificationOutbox(await SharedPreferences.getInstance(), 'u1'),
        r,
        photoDir: () async => tmp,
      );

  test(
      'photo is copied to the durable folder, uploaded to its own path, then sent',
      () async {
    final File picked = File('${tmp.path}/picked.jpg')
      ..writeAsBytesSync(<int>[1, 2, 3]);
    Map<String, dynamic>? sent;
    final _Remote r = _Remote((Map<String, dynamic> p) async => sent = p);
    final FleetVerificationService s = await service(r);
    expect(await s.save(_item(photo: picked.path)), SendOutcome.sent);
    expect(r.uploads.single, 'org1/KSA/TM514/verify/id-1.jpg');
    expect(sent!['p_photo_path'], 'org1/KSA/TM514/verify/id-1.jpg');
    expect(s.waiting(), isEmpty);
  });

  test('a missing photo fails, never sends without it', () async {
    final _Remote r = _Remote((_) async => <String, dynamic>{});
    final FleetVerificationService s = await service(r);
    expect(
      await s.save(_item(photo: '${tmp.path}/gone.jpg')),
      SendOutcome.failed,
    );
    expect(s.waiting().single.failedMessage, failedPhotoMissing);
  });

  test('offline never counts as an attempt', () async {
    final _Remote r = _Remote((_) async => throw const SocketException('off'));
    final FleetVerificationService s = await service(r);
    expect(await s.save(_item()), SendOutcome.retryLater);
    for (int i = 0; i < maxVerificationAttempts + 5; i++) {
      await s.flush();
    }
    expect(s.waiting().single.attempts, 0);
    expect(s.waiting().single.failed, isFalse);
  });

  test('server errors count and give up after the cap; Retry resets', () async {
    bool down = true;
    final _Remote r = _Remote((_) async {
      if (down) {
        throw const PostgrestException(message: 'boom', code: '500');
      }
      return <String, dynamic>{};
    });
    final FleetVerificationService s = await service(r);
    await s.save(_item());
    for (int i = 0; i < maxVerificationAttempts; i++) {
      await s.flush();
    }
    expect(s.waiting().single.failedMessage, failedRetryLimit);
    down = false;
    expect(await s.retry('id-1'), SendOutcome.sent);
    expect(s.waiting(), isEmpty);
  });

  test('PT409 id already used is a permanent failure with the reason',
      () async {
    final _Remote r = _Remote(
      (_) async => throw const PostgrestException(
        message: 'This verification id is already used',
        code: 'PT409',
      ),
    );
    final FleetVerificationService s = await service(r);
    expect(await s.save(_item()), SendOutcome.failed);
    expect(s.waiting().single.failedMessage, contains('already used'));
  });

  test('PT409 photo still uploading is retried', () {
    expect(
      classifyVerificationError(
        'PT409',
        'The photo has not finished uploading',
      ),
      SendOutcome.retryLater,
    );
  });

  test('blocking flags fill nothing; Arabic-Indic plate digits fold', () {
    final VerificationPreview p = previewVerification(
      vehicle: const VerificationVehicle(id: 'v1', assetNo: 'TM514'),
      outcome: FleetVerificationOutcome.present,
      observedAssetNo: 'TM515',
      observedChassis: 'LZG123',
    );
    expect(p.applyNow, isEmpty);
    expect(plateKey('٤٢٠٥ sxa'), '4205SXA');
  });
}
