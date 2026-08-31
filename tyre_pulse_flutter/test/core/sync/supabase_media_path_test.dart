import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/sync/supabase_command_pusher.dart';
import 'package:tyre_pulse/features/accidents/data/accident_photo_capture.dart';

void main() {
  group('accident evidence storage contract', () {
    test('uses the canonical private accident namespace', () {
      expect(
        storageObjectPath(
          bucket: 'accident-photos',
          fileName: 'accident_1000.jpg',
          userId: '12345678-abcd-4321-abcd-123456789abc',
        ),
        'accidents/12345678/accident_1000.jpg',
      );
    });

    test('does not change established paths for other media buckets', () {
      expect(
        storageObjectPath(
          bucket: 'tyre-photos',
          fileName: 'tyre_1000.jpg',
          userId: null,
        ),
        'tyre_1000.jpg',
      );
    });

    test('requires an authenticated owner for accident evidence', () {
      expect(
        () => storageObjectPath(
          bucket: 'accident-photos',
          fileName: 'accident_1000.jpg',
          userId: null,
        ),
        throwsStateError,
      );
    });

    test('refuses object-path injection', () {
      expect(
        () => storageObjectPath(
          bucket: 'accident-photos',
          fileName: '../evidence.jpg',
          userId: '12345678-abcd',
        ),
        throwsArgumentError,
      );
    });

    test('sets only bucket-supported image MIME types', () {
      expect(storageContentType('a.JPG'), 'image/jpeg');
      expect(storageContentType('a.jpeg'), 'image/jpeg');
      expect(storageContentType('a.png'), 'image/png');
      expect(storageContentType('a.webp'), 'image/webp');
      expect(storageContentType('a.heic'), isNull);
    });

    test('capture accepts supported types and rejects HEIC without relabeling',
        () {
      expect(accidentEvidenceExtension('evidence.jpeg'), '.jpeg');
      expect(accidentEvidenceExtension('evidence.PNG'), '.png');
      expect(accidentEvidenceExtension('evidence.webp'), '.webp');
      expect(
        () => accidentEvidenceExtension('evidence.heic'),
        throwsUnsupportedError,
      );
      expect(
        () => accidentEvidenceExtension('evidence.pdf'),
        throwsUnsupportedError,
      );
      expect(
        () => accidentEvidenceExtension('evidence'),
        throwsUnsupportedError,
      );
    });
  });
}
