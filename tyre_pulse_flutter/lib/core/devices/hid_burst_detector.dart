/// Tells a handheld scanner's "keyboard wedge" output apart from a person
/// typing.
///
/// A rugged handheld (or an RFID reader in keyboard mode) types the whole
/// code in a few milliseconds and finishes with Enter. A person cannot type
/// that fast. So a run of characters each arriving within [maxGap] of the
/// last, at least [minLength] long, ended by Enter, is a scan; anything else
/// is discarded. Pure Dart: timestamps are passed in, so it is tested without
/// a clock or a widget binding.
library;

final class HidBurstDetector {
  HidBurstDetector({
    this.maxGap = const Duration(milliseconds: 60),
    this.minLength = 4,
    this.maxLength = 256,
  });

  /// Longest pause allowed between two characters of one scan.
  final Duration maxGap;

  /// Shortest code accepted. Keeps a stray key plus Enter from opening a
  /// lookup.
  final int minLength;

  /// Longest code kept. A stuck key must not grow the buffer forever.
  final int maxLength;

  final StringBuffer _buffer = StringBuffer();
  Duration? _lastAt;

  /// The characters collected so far (for tests and diagnostics).
  String get pending => _buffer.toString();

  /// Feeds one printable character typed at [at]. A gap longer than [maxGap]
  /// starts a new burst with this character.
  void addCharacter(String character, Duration at) {
    if (character.isEmpty) return;
    final Duration? last = _lastAt;
    if (last != null && at - last > maxGap) {
      _buffer.clear();
    }
    if (_buffer.length + character.length > maxLength) {
      _buffer.clear();
    }
    _buffer.write(character);
    _lastAt = at;
  }

  /// Feeds the terminator (Enter/Tab) at [at]. Returns the scanned code when
  /// the burst qualifies, else null. The buffer is cleared either way.
  String? addTerminator(Duration at) {
    final Duration? last = _lastAt;
    final String code = _buffer.toString().trim();
    reset();
    if (last == null || at - last > maxGap) return null;
    if (code.length < minLength) return null;
    return code;
  }

  void reset() {
    _buffer.clear();
    _lastAt = null;
  }
}
