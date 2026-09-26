// Parity with mobile/lib/photoUpload.ts `uploadModulePhoto` (path shape) and
// mobile/lib/workshopApi.ts `resolveWorkshopPhotos` (drop on failure).
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_photo_capture.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_photo_uploader.dart';

final class _FakeUploader implements WorkshopPhotoUploader {
  _FakeUploader({this.failOn = const <String>{}});

  final Set<String> failOn;
  final List<(String, String, int)> calls = <(String, String, int)>[];

  @override
  Future<String> upload({
    required String localPath,
    required String userId,
    required int index,
  }) async {
    calls.add((localPath, userId, index));
    if (failOn.contains(localPath)) throw StateError('offline');
    return 'tp-storage://tyre-photos/modules/workshop/$index.jpg';
  }
}

void main() {
  group('workshopPhotoObjectPath', () {
    test('mirrors modules/workshop/<uid8>/<ms>_<i>_<rand>.<ext>', () {
      expect(
        workshopPhotoObjectPath(
          userId: 'f3a70480-1111-2222-3333-444444444444',
          localPath: '/docs/workshop_photos/workshop_1.jpg',
          index: 2,
          epochMs: 1758900000000,
          rand: 'ab12',
        ),
        'modules/workshop/f3a70480/1758900000000_2_ab12.jpg',
      );
    });

    test('png stays png; heic and unknown become jpg', () {
      String ext(String p) => workshopPhotoObjectPath(
            userId: 'u',
            localPath: p,
            index: 0,
            epochMs: 1,
            rand: 'r',
          ).split('.').last;
      expect(ext('/a/x.PNG'), 'png');
      expect(ext('/a/x.heic'), 'jpg');
      expect(ext('/a/x'), 'jpg');
    });

    test('an empty user id is filed under anon, not an empty segment', () {
      expect(
        workshopPhotoObjectPath(
          userId: '',
          localPath: 'x.jpg',
          index: 0,
          epochMs: 1,
          rand: 'r',
        ),
        'modules/workshop/anon/1_0_r.jpg',
      );
    });
  });

  group('resolveWorkshopPhotos', () {
    test('uploads local paths in order and reports what was confirmed',
        () async {
      final _FakeUploader up = _FakeUploader();
      final WorkshopPhotoResolution r = await resolveWorkshopPhotos(
        uploader: up,
        photos: const <String>['/a/1.jpg', '/a/2.jpg'],
        userId: 'tech-1',
      );
      expect(r.refs, <String>[
        'tp-storage://tyre-photos/modules/workshop/0.jpg',
        'tp-storage://tyre-photos/modules/workshop/1.jpg',
      ]);
      expect(r.dropped, 0);
      expect(r.uploadedLocalPaths, <String>['/a/1.jpg', '/a/2.jpg']);
      expect(up.calls.first.$2, 'tech-1');
    });

    test('a failed upload drops only that photo and never throws', () async {
      final WorkshopPhotoResolution r = await resolveWorkshopPhotos(
        uploader: _FakeUploader(failOn: <String>{'/a/2.jpg'}),
        photos: const <String>['/a/1.jpg', '/a/2.jpg', '/a/3.jpg'],
        userId: 'tech-1',
      );
      expect(r.refs, hasLength(2));
      expect(r.dropped, 1);
      // The unconfirmed local copy is not reported as safe to delete.
      expect(r.uploadedLocalPaths, isNot(contains('/a/2.jpg')));
    });

    test('already-permanent refs pass through without an upload', () async {
      final _FakeUploader up = _FakeUploader();
      final WorkshopPhotoResolution r = await resolveWorkshopPhotos(
        uploader: up,
        photos: const <String>['tp-storage://tyre-photos/x.jpg', '  '],
        userId: 'tech-1',
      );
      expect(r.refs, <String>['tp-storage://tyre-photos/x.jpg']);
      expect(up.calls, isEmpty);
      expect(r.uploadedLocalPaths, isEmpty);
    });
  });

  test('capture keeps only allowed extensions', () {
    expect(workshopPhotoExtension('IMG.JPEG'), '.jpeg');
    expect(workshopPhotoExtension('a.png'), '.png');
    expect(workshopPhotoExtension('a.gif'), '.jpg');
    expect(workshopPhotoExtension('noext'), '.jpg');
  });
}
