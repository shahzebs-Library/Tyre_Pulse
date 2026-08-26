/// Confirms every user-facing string in the English reference ARB exists,
/// and is non-empty, in the Arabic and Urdu translations too.
///
/// Spec section 51: the product ships English, Arabic and Urdu with every
/// string sourced from an ARB file. A key present in English but missing
/// from a translated file silently degrades at runtime; an EMPTY
/// translation is worse still, because it renders nothing at all with no
/// signal that anything is wrong. This file reads the three committed ARB
/// sources directly and checks them against each other, so a translation
/// gap is caught here rather than noticed later as a blank label on a
/// phone screen.
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Locates an ARB file the same defensive way
/// `module_registry_drift_test.dart` locates its cross-package reference
/// file: `flutter test` runs with the package root as the working
/// directory (see `.github/workflows/flutter-ci.yml`), so the file is
/// normally under `lib/l10n/` directly. The second candidate covers a
/// repository-root working directory instead.
File _locateArbFile(String fileName) {
  for (final String relative in <String>[
    'lib${Platform.pathSeparator}l10n${Platform.pathSeparator}$fileName',
    'tyre_pulse_flutter${Platform.pathSeparator}lib'
        '${Platform.pathSeparator}l10n${Platform.pathSeparator}$fileName',
  ]) {
    final File file = File(relative);
    if (file.existsSync()) {
      return file;
    }
  }
  fail(
    'Could not find lib/l10n/$fileName from the working directory '
    '${Directory.current.path}.',
  );
}

Map<String, dynamic> _readArb(String fileName) {
  return jsonDecode(_locateArbFile(fileName).readAsStringSync())
      as Map<String, dynamic>;
}

/// The translatable keys in an ARB map: everything except the `@key`
/// metadata entries, which describe a sibling key rather than naming a
/// string of their own.
Set<String> _translatableKeys(Map<String, dynamic> arb) {
  return arb.keys.where((String key) => !key.startsWith('@')).toSet();
}

void main() {
  late final Map<String, dynamic> en;
  late final Map<String, dynamic> ar;
  late final Map<String, dynamic> ur;

  setUpAll(() {
    en = _readArb('app_en.arb');
    ar = _readArb('app_ar.arb');
    ur = _readArb('app_ur.arb');
  });

  group('the loader is not vacuously trusting an empty read', () {
    test('every ARB actually decoded content, not an empty map', () {
      // Guards the guard: if _readArb ever silently returned {} (a wrong
      // path, a parse that decoded something unexpected), every test
      // below would pass vacuously instead of catching a real gap.
      expect(en, isNotEmpty);
      expect(ar, isNotEmpty);
      expect(ur, isNotEmpty);
      expect(_translatableKeys(en), isNotEmpty);
      expect(_translatableKeys(ar), isNotEmpty);
      expect(_translatableKeys(ur), isNotEmpty);
    });
  });

  group('english is the reference locale', () {
    test('english carries at least as many translatable keys as the others',
        () {
      // Measured directly against the committed files, not assumed: today
      // en/ar/ur are exactly equal at 66 keys each, so English trivially
      // qualifies as the reference. If a future edit ever makes a
      // translated file the larger one, that is the signal this file's
      // "english is the reference" premise needs re-pointing at whichever
      // file is actually the superset - do not just raise the pinned
      // count below without checking which file changed.
      final int enCount = _translatableKeys(en).length;
      expect(enCount, greaterThanOrEqualTo(_translatableKeys(ar).length));
      expect(enCount, greaterThanOrEqualTo(_translatableKeys(ur).length));
    });
  });

  group('key counts, pinned against the real committed files', () {
    // Was 66/66/66. Four features landed keys concurrently, each accounted
    // for here rather than folded into one unexplained jump - the parallel
    // migration phase 3 run had one agent per feature package, and all four
    // reached this shared file:
    // - `features/assets` (the vehicles list and detail screens) added 25
    //   keys, vehiclesTitle through vehiclesTruncatedNotice.
    // - a serial-search feature added 28 keys, serialSearchTitle through
    //   serialSearchUndoConfirmMessage.
    // - `features/records` added 24 keys, recordsTitle through the rest of
    //   that prefix.
    // - `features/scanning` added 15 keys, scannerTitle through the rest of
    //   that prefix.
    // 66 + 25 + 28 + 24 + 15 = 158.
    // - `features/tyre_diagram` (Phase 4, the vehicle tyre diagram widget)
    //   added 13 keys: tyreDiagramFrontLabel through tyreDiagramTyreCount
    //   (the diagram's own chrome - front label, tap hint, tyre count,
    //   pending lead-in, tyreless/empty messages, the pressure detail
    //   suffix) plus tyreConditionGood through tyreConditionMissing (the
    //   six-value condition legend/accessibility-label vocabulary).
    // 158 + 13 = 171.
    // - `features/inspections` (Phase 5, the inspection capture wizard,
    //   detail screen and the scoped "My Inspections" history surface)
    //   added 71 keys: inspectionNavTitle through
    //   inspectionHistorySubmittedSection - the wizard's step track and
    //   header (vehicle/site/odometer/hour-meter picking, resuming a
    //   draft), the tyre-position editor sheet (condition/pressure/tread/
    //   serial/photo/notes), the signature pad's saved-preview/redraw
    //   pair, the review and submit-outcome screens, the read-only detail
    //   screen (including its own queued-vs-synced banner), and the
    //   history list's empty/section states.
    // 171 + 71 = 242. Bumping this pin is the expected maintenance action
    // for a real key addition; this comment exists so the next person to
    // touch it can tell that apart from a mistake. Per this file's own
    // earlier note: if a future edit ever makes a translated file the
    // larger one, re-derive which file is the reference before touching
    // this number - do not just raise it blind.
    test('en, ar and ur each carry exactly 242 translatable keys today', () {
      expect(_translatableKeys(en).length, 242);
      expect(_translatableKeys(ar).length, 242);
      expect(_translatableKeys(ur).length, 242);
    });
  });

  group('every english key exists in the translated files', () {
    test('nothing is missing from app_ar.arb', () {
      final List<String> missing =
          _translatableKeys(en).difference(_translatableKeys(ar)).toList()
            ..sort();
      expect(missing, isEmpty, reason: 'app_ar.arb is missing: $missing');
    });

    test('nothing is missing from app_ur.arb', () {
      final List<String> missing =
          _translatableKeys(en).difference(_translatableKeys(ur)).toList()
            ..sort();
      expect(missing, isEmpty, reason: 'app_ur.arb is missing: $missing');
    });
  });

  group('neither translated file carries a key english does not have', () {
    // A stray key in ar/ur is never read by AppLocalizations - it is only
    // ever generated from the template file's own keys - and its
    // presence is a sign the template and a translation have drifted
    // apart in the other direction.
    test('app_ar.arb has no extra keys', () {
      final List<String> extra =
          _translatableKeys(ar).difference(_translatableKeys(en)).toList()
            ..sort();
      expect(
        extra,
        isEmpty,
        reason: 'app_ar.arb has keys not in app_en.arb: $extra',
      );
    });

    test('app_ur.arb has no extra keys', () {
      final List<String> extra =
          _translatableKeys(ur).difference(_translatableKeys(en)).toList()
            ..sort();
      expect(
        extra,
        isEmpty,
        reason: 'app_ur.arb has keys not in app_en.arb: $extra',
      );
    });
  });

  group('no translation is an empty string', () {
    // An empty translation is worse than a missing key: a missing key at
    // least surfaces during generation or falls back to a placeholder; an
    // empty one silently renders nothing on screen with no signal
    // anything is wrong.
    void expectNoEmptyValues(String label, Map<String, dynamic> arb) {
      final List<String> empties = <String>[];
      for (final MapEntry<String, dynamic> entry in arb.entries) {
        if (entry.key.startsWith('@')) {
          continue;
        }
        final dynamic value = entry.value;
        if (value is String && value.trim().isEmpty) {
          empties.add(entry.key);
        }
      }
      expect(
        empties,
        isEmpty,
        reason: '$label has empty translations for: $empties',
      );
    }

    test('app_en.arb', () {
      expectNoEmptyValues('app_en.arb', en);
    });

    test('app_ar.arb', () {
      expectNoEmptyValues('app_ar.arb', ar);
    });

    test('app_ur.arb', () {
      expectNoEmptyValues('app_ur.arb', ur);
    });
  });
}
