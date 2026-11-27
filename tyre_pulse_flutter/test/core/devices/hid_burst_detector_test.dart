import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/devices/hid_burst_detector.dart';

Duration _ms(int v) => Duration(milliseconds: v);

String? _type(HidBurstDetector d, String text, {int start = 0, int gap = 8}) {
  int t = start;
  for (final String c in text.split('')) {
    d.addCharacter(c, _ms(t));
    t += gap;
  }
  return d.addTerminator(_ms(t));
}

void main() {
  test('a fast burst ending in Enter is a scan', () {
    expect(_type(HidBurstDetector(), 'TM-514'), 'TM-514');
  });

  test('human typing speed is not a scan', () {
    expect(_type(HidBurstDetector(), 'TM-514', gap: 180), isNull);
  });

  test('too short is ignored', () {
    expect(_type(HidBurstDetector(), 'ab'), isNull);
  });

  test('a pause starts a new burst; only the fast tail counts', () {
    final HidBurstDetector d = HidBurstDetector()
      ..addCharacter('x', _ms(0))
      ..addCharacter('y', _ms(10));
    // 500 ms later the trigger fires.
    expect(_type(d, 'E12345', start: 510), 'E12345');
  });

  test('a late Enter after a burst is not a scan', () {
    final HidBurstDetector d = HidBurstDetector();
    for (final String c in 'ABCDEF'.split('')) {
      d.addCharacter(c, _ms(0));
    }
    expect(d.addTerminator(_ms(400)), isNull);
  });

  test('the buffer is cleared after each terminator', () {
    final HidBurstDetector d = HidBurstDetector();
    expect(_type(d, 'AAAA1'), 'AAAA1');
    expect(d.pending, isEmpty);
    expect(_type(d, 'BBBB2', start: 1000), 'BBBB2');
  });

  test('a stuck key cannot grow the buffer without bound', () {
    final HidBurstDetector d = HidBurstDetector(maxLength: 10);
    for (int i = 0; i < 25; i++) {
      d.addCharacter('Z', _ms(i));
    }
    expect(d.pending.length, lessThanOrEqualTo(10));
  });
}
