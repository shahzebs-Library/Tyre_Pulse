import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/features/fleet_verification/data/fleet_verification_repository.dart';
import 'package:tyre_pulse/features/fleet_verification/domain/fleet_verification_rules.dart';
import 'package:tyre_pulse/features/fleet_verification/presentation/fleet_verification_copy.dart';

void main() {
  group('normalisers mirror SQL + web', () {
    test('plate', () {
      expect(normalizePlate(' 1234  abc '), '1234 ABC');
      expect(normalizePlate('  '), isNull);
      expect(plateKey('2041  XXB'), '2041XXB');
      expect(plateKey('KAA 4746'), isNot(plateKey('4746 KAA')));
    });
    test('chassis maps Cyrillic and strips separators', () {
      expect(normalizeChassis(' lzg-РС 1.23 '), 'LZGPC123');
      expect(normalizeChassis('АВЕКМНОРСТХУ'), 'ABEKMHOPCTXY');
      expect(chassisHasInvalidVinChars('LZG0OQ'), isTrue);
      expect(chassisHasInvalidVinChars('LZG123'), isFalse);
    });
    test('photo path is unique per verification', () {
      expect(
        verificationPhotoPath(
          orgId: 'ABC-1',
          country: 'ksa',
          assetNo: 'tm514',
          verificationId: 'V-1',
        ),
        'abc-1/KSA/TM514/verify/v-1.jpg',
      );
    });
  });

  group('preview', () {
    const VerificationVehicle v =
        VerificationVehicle(id: 'v1', assetNo: 'TM514');
    test('blank fields fill and apply', () {
      final VerificationPreview p = previewVerification(
        vehicle: v,
        outcome: FleetVerificationOutcome.present,
        observedPlate: '1234 abc',
        observedChassis: 'LZG123',
        hasPhoto: true,
      );
      expect(p.status, 'auto_applied');
      expect(
        p.applyNow,
        <String>['registration_no', 'chassis_no', 'image_path'],
      );
    });
    test('different plate waits, blank chassis still fills', () {
      final VerificationPreview p = previewVerification(
        vehicle: const VerificationVehicle(
          id: 'v1',
          assetNo: 'TM514',
          registrationNo: '9999 ZZZ',
        ),
        outcome: FleetVerificationOutcome.present,
        observedPlate: '1234 ABC',
        observedChassis: 'LZG123',
        hasPhoto: true,
      );
      expect(p.status, 'pending');
      expect(p.flags, contains('plate_changed'));
      expect(p.applyNow, <String>['chassis_no']);
    });
    test('duplicate on another machine waits and does not fill', () {
      final VerificationPreview p = previewVerification(
        vehicle: v,
        outcome: FleetVerificationOutcome.present,
        observedPlate: '1234 ABC',
        others: const <VerificationVehicle>[
          VerificationVehicle(id: 'v2', registrationNo: '1234ABC'),
        ],
      );
      expect(p.flags, <String>['duplicate_plate']);
      expect(p.applyNow, isEmpty);
    });
    test('not found waits', () {
      expect(
        previewVerification(
          vehicle: v,
          outcome: FleetVerificationOutcome.notFound,
        ).flags,
        <String>['not_found'],
      );
    });
  });

  test('roles', () {
    expect(
      canVerifyOnSite(
        UserRole.fromDatabase('Fleet Supervisor'),
        isSuperAdmin: false,
      ),
      isTrue,
    );
    expect(
      canVerifyOnSite(
        UserRole.fromDatabase('Fleet Incharge'),
        isSuperAdmin: false,
      ),
      isTrue,
    );
    expect(
      canVerifyOnSite(UserRole.fromDatabase('Admin'), isSuperAdmin: false),
      isTrue,
    );
    expect(
      canVerifyOnSite(UserRole.fromDatabase('Manager'), isSuperAdmin: false),
      isFalse,
    );
    expect(
      canVerifyOnSite(UserRole.fromDatabase('Driver'), isSuperAdmin: true),
      isTrue,
    );
  });

  test('error classification', () {
    expect(classifyVerificationError('PGRST202'), SendOutcome.notSetUp);
    expect(classifyVerificationError('42501'), SendOutcome.failed);
    expect(classifyVerificationError('PT409'), SendOutcome.retryLater);
    expect(classifyVerificationError(null), SendOutcome.retryLater);
  });

  test('rpc params send other country only for other_country', () {
    final QueuedVerification q = QueuedVerification(
      id: 'id1',
      vehicleId: 'v1',
      assetNo: 'TM514',
      outcome: 'present',
      createdAt: DateTime(2026),
      otherCountry: 'UAE',
      observedPlate: '  ',
      lat: 1,
      lng: 2,
    );
    final Map<String, dynamic> p = q.rpcParams();
    expect(p['p_client_uuid'], 'id1');
    expect(p['p_other_country'], isNull);
    expect(p['p_observed_plate'], isNull);
    expect(QueuedVerification.fromJson(q.toJson()).toJson(), q.toJson());
  });

  test('copy has every key in ar and ur', () {
    final Set<String> en = FleetVerificationCopy.values['en']!.keys.toSet();
    expect(FleetVerificationCopy.values['ar']!.keys.toSet(), en);
    expect(FleetVerificationCopy.values['ur']!.keys.toSet(), en);
  });
}
