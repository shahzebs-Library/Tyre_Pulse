// Parity with mobile/app/(app)/workshop.tsx `allowsPhoto` and
// mobile/lib/workshopApi.ts `noteWithPhotos`, plus the never-block GPS guard.
import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/workshop/domain/workshop_evidence.dart';
import 'package:tyre_pulse/features/workshop/domain/workshop_live.dart';

void main() {
  group('workshopActionAllowsPhoto', () {
    test('only Report Problem and Request Parts offer a photo', () {
      final Set<String> withPhoto = <String>{
        for (final WorkshopTechAction a in kWorkshopTechActions)
          if (workshopActionAllowsPhoto(a)) a.event,
      };
      expect(withPhoto, <String>{'report_problem', 'request_parts'});
    });

    test('both photo actions also collect a note, so the dialog shows', () {
      for (final WorkshopTechAction a in kWorkshopTechActions) {
        if (workshopActionAllowsPhoto(a)) expect(a.needsNote, isTrue);
      }
    });

    test('mobile caps the attachment at three', () {
      expect(kWorkshopMaxPhotos, 3);
    });
  });

  group('workshopNoteWithPhotos', () {
    test('no note and no refs is null, not an empty string', () {
      expect(workshopNoteWithPhotos(null, null), isNull);
      expect(workshopNoteWithPhotos('   ', const <String>[]), isNull);
      expect(workshopNoteWithPhotos(null, const <String>['', ' ']), isNull);
    });

    test('a note alone is trimmed and passed through', () {
      expect(workshopNoteWithPhotos('  Hub leaking  ', null), 'Hub leaking');
    });

    test('refs alone become the Photos line', () {
      expect(
        workshopNoteWithPhotos(null, const <String>['tp-storage://a/1.jpg']),
        'Photos: tp-storage://a/1.jpg',
      );
    });

    test('note, then refs joined by " | " on their own line', () {
      expect(
        workshopNoteWithPhotos('Seal torn', const <String>[
          'tp-storage://tyre-photos/modules/workshop/u/1.jpg',
          '',
          'tp-storage://tyre-photos/modules/workshop/u/2.jpg',
        ]),
        'Seal torn\nPhotos: tp-storage://tyre-photos/modules/workshop/u/1.jpg'
        ' | tp-storage://tyre-photos/modules/workshop/u/2.jpg',
      );
    });
  });

  group('WorkshopGpsReading.tryCreate', () {
    test('a real fix is kept', () {
      final WorkshopGpsReading? r = WorkshopGpsReading.tryCreate(24.7, 46.6);
      expect(r?.lat, 24.7);
      expect(r?.lng, 46.6);
    });

    test('missing, non-finite or out-of-range is no reading (never 0,0)', () {
      expect(WorkshopGpsReading.tryCreate(null, 46.6), isNull);
      expect(WorkshopGpsReading.tryCreate(24.7, null), isNull);
      expect(WorkshopGpsReading.tryCreate(double.nan, 46.6), isNull);
      expect(WorkshopGpsReading.tryCreate(91, 46.6), isNull);
      expect(WorkshopGpsReading.tryCreate(24.7, 181), isNull);
    });
  });

  group('captureWorkshopGps never blocks and never throws', () {
    test('passes a fix through', () async {
      final WorkshopGpsReading? r = await captureWorkshopGps(
        () async => const WorkshopGpsReading(lat: 1, lng: 2),
      );
      expect(r?.lat, 1);
    });

    test('a throwing locator resolves to null', () async {
      expect(
        await captureWorkshopGps(() async => throw StateError('denied')),
        isNull,
      );
    });

    test('a hanging locator resolves to null at the timeout', () async {
      final Completer<WorkshopGpsReading?> never =
          Completer<WorkshopGpsReading?>();
      final WorkshopGpsReading? r = await captureWorkshopGps(
        () => never.future,
        timeout: const Duration(milliseconds: 20),
      );
      expect(r, isNull);
    });
  });
}
