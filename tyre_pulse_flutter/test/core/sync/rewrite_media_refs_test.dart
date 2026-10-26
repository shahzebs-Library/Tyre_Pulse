import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/sync/sync_engine.dart';

void main() {
  const Map<String, String> refs = <String, String>{
    '/data/a.jpg': 'tp-storage://checklist-photos/a.jpg',
    '/data/b.jpg': 'tp-storage://checklist-photos/b.jpg',
  };

  test('rewrites local paths inside a keyed photo bag', () {
    final Object? out = rewriteMediaRefs(
      <String, Object?>{
        'check0': <String>['/data/a.jpg', '/data/b.jpg'],
        'check1': <String>['https://example.com/keep.jpg'],
      },
      refs,
    );
    expect(out, <String, Object?>{
      'check0': <String>[
        'tp-storage://checklist-photos/a.jpg',
        'tp-storage://checklist-photos/b.jpg',
      ],
      'check1': <String>['https://example.com/keep.jpg'],
    });
  });

  test('rewrites a flat list and leaves other values alone', () {
    expect(
      rewriteMediaRefs(<Object?>['/data/a.jpg', 3, null, 'note'], refs),
      <Object?>['tp-storage://checklist-photos/a.jpg', 3, null, 'note'],
    );
  });

  test('only exact path matches are replaced', () {
    expect(rewriteMediaRefs('see /data/a.jpg here', refs), 'see /data/a.jpg here');
  });
}
