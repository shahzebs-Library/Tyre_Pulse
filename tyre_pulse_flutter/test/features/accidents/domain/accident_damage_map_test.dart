import 'dart:convert';
import 'dart:ui' show Rect;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_damage_map.dart';

void main() {
  group('kAccidentDamageZones catalog integrity', () {
    test('every zone id is unique across the whole catalog', () {
      final List<String> ids =
          kAccidentDamageZones.map((AccidentDamageZone z) => z.id).toList();
      expect(
        ids.toSet().length,
        ids.length,
        reason: 'duplicate zone id(s) found',
      );
    });

    test('every zone stays within its own 0..1 canvas', () {
      for (final AccidentDamageZone zone in kAccidentDamageZones) {
        expect(zone.left, greaterThanOrEqualTo(0), reason: zone.id);
        expect(zone.top, greaterThanOrEqualTo(0), reason: zone.id);
        expect(
          zone.left + zone.width,
          lessThanOrEqualTo(1.0001),
          reason: zone.id,
        );
        expect(
          zone.top + zone.height,
          lessThanOrEqualTo(1.0001),
          reason: zone.id,
        );
      }
    });

    test('no two zones on the same view overlap', () {
      for (final AccidentDamageView view in AccidentDamageView.values) {
        final List<AccidentDamageZone> zones = accidentDamageZonesFor(view);
        for (var i = 0; i < zones.length; i++) {
          for (var j = i + 1; j < zones.length; j++) {
            final Rect a = zones[i].toRect();
            final Rect b = zones[j].toRect();
            final bool overlap = a.left < b.right &&
                b.left < a.right &&
                a.top < b.bottom &&
                b.top < a.bottom;
            expect(
              overlap,
              isFalse,
              reason: 'on $view, ${zones[i].id} overlaps ${zones[j].id}',
            );
          }
        }
      }
    });

    test('every view has at least one zone', () {
      for (final AccidentDamageView view in AccidentDamageView.values) {
        expect(accidentDamageZonesFor(view), isNotEmpty, reason: '$view');
      }
    });
  });

  group('accidentDamageZoneAt', () {
    test('a tap inside a registered zone resolves to it', () {
      final AccidentDamageZone bumper = kAccidentDamageZones.firstWhere(
        (AccidentDamageZone z) => z.id == 'front_bumper',
      );
      final double dx = bumper.left + bumper.width / 2;
      final double dy = bumper.top + bumper.height / 2;
      final AccidentDamageZone? hit =
          accidentDamageZoneAt(AccidentDamageView.front, dx, dy);
      expect(hit?.id, 'front_bumper');
    });

    test('a tap outside every zone resolves to null', () {
      // (0, 0) on the front view sits above the windshield band and left of
      // every registered zone.
      expect(accidentDamageZoneAt(AccidentDamageView.front, 0, 0), isNull);
    });

    test('a tap never resolves to a zone registered on a different view', () {
      final AccidentDamageZone bumper = kAccidentDamageZones.firstWhere(
        (AccidentDamageZone z) => z.id == 'front_bumper',
      );
      final double dx = bumper.left + bumper.width / 2;
      final double dy = bumper.top + bumper.height / 2;
      expect(
        accidentDamageZoneAt(AccidentDamageView.rear, dx, dy)?.id,
        isNot('front_bumper'),
      );
    });
  });

  group('accidentDamageViewOfZone', () {
    test('resolves a real zone id to its view', () {
      expect(accidentDamageViewOfZone('left_mirror'), AccidentDamageView.left);
      expect(accidentDamageViewOfZone('top_roof'), AccidentDamageView.top);
    });

    test('an unknown id resolves to null, never a guessed view', () {
      expect(accidentDamageViewOfZone('not_a_real_zone'), isNull);
    });
  });

  group('AccidentDamageMap', () {
    const AccidentDamageMark frontBumperMinor = AccidentDamageMark(
      zoneId: 'front_bumper',
      severity: AccidentDamageSeverity.minor,
    );
    const AccidentDamageMark leftDoorSevere = AccidentDamageMark(
      zoneId: 'left_front_door',
      severity: AccidentDamageSeverity.severe,
      note: 'Caved in',
    );

    test('starts empty', () {
      const AccidentDamageMap map = AccidentDamageMap.empty();
      expect(map.isEmpty, isTrue);
      expect(map.count, 0);
      expect(map.markFor('front_bumper'), isNull);
    });

    test('withMark adds a new mark and can be looked up by zone id', () {
      final AccidentDamageMap map =
          const AccidentDamageMap.empty().withMark(frontBumperMinor);
      expect(map.count, 1);
      expect(map.hasMark('front_bumper'), isTrue);
      expect(
        map.markFor('front_bumper')?.severity,
        AccidentDamageSeverity.minor,
      );
    });

    test(
        'withMark on an already-marked zone replaces it rather than duplicating',
        () {
      final AccidentDamageMap map =
          const AccidentDamageMap.empty().withMark(frontBumperMinor).withMark(
                frontBumperMinor.copyWith(
                  severity: AccidentDamageSeverity.severe,
                ),
              );
      expect(map.count, 1);
      expect(
        map.markFor('front_bumper')?.severity,
        AccidentDamageSeverity.severe,
      );
    });

    test('withoutMark removes exactly the named zone and leaves the rest', () {
      final AccidentDamageMap map = const AccidentDamageMap.empty()
          .withMark(frontBumperMinor)
          .withMark(leftDoorSevere)
          .withoutMark('front_bumper');
      expect(map.count, 1);
      expect(map.hasMark('front_bumper'), isFalse);
      expect(map.hasMark('left_front_door'), isTrue);
    });

    test('withoutMark on a zone that was never marked is a no-op', () {
      final AccidentDamageMap map =
          const AccidentDamageMap.empty().withMark(frontBumperMinor);
      expect(map.withoutMark('left_front_door').count, 1);
    });

    test('countForView counts only marks whose zone belongs to that view', () {
      final AccidentDamageMap map = const AccidentDamageMap.empty()
          .withMark(frontBumperMinor) // front
          .withMark(leftDoorSevere); // left
      String viewOf(String id) => accidentDamageViewOfZone(id)?.name ?? '';
      expect(map.countForView(viewOf, AccidentDamageView.front), 1);
      expect(map.countForView(viewOf, AccidentDamageView.left), 1);
      expect(map.countForView(viewOf, AccidentDamageView.rear), 0);
    });

    test('fromMarks collapses a duplicate zone id to the last one supplied',
        () {
      final AccidentDamageMap map =
          AccidentDamageMap.fromMarks(<AccidentDamageMark>[
        frontBumperMinor,
        frontBumperMinor.copyWith(severity: AccidentDamageSeverity.moderate),
      ]);
      expect(map.count, 1);
      expect(
        map.markFor('front_bumper')?.severity,
        AccidentDamageSeverity.moderate,
      );
    });

    test('copyWith keeps every field not explicitly overridden', () {
      final AccidentDamageMark next = leftDoorSevere.copyWith();
      expect(next.zoneId, leftDoorSevere.zoneId);
      expect(next.severity, leftDoorSevere.severity);
      expect(next.note, leftDoorSevere.note);
    });

    test('legacy version-one JSON remains readable with truthful defaults', () {
      final AccidentDamageMap map = AccidentDamageMap.fromJson(
        const <String, Object?>{
          'version': 1,
          'marks': <Map<String, Object?>>[
            <String, Object?>{
              'zone_id': 'front_bumper',
              'severity': 'severe',
              'note': 'Legacy draft',
            },
          ],
        },
      );

      expect(map.count, 1);
      expect(map.marks.single.damageType, AccidentDamageType.other);
      expect(map.marks.single.effectiveView, AccidentDamageView.front);
      expect(map.marks.single.suggestion, isNull);
      expect(map.marks.single.photoCount, 0);
    });

    test('version-two fields make a stable JSON round trip', () {
      final DateTime reviewedAt = DateTime.utc(2026, 8, 31, 9, 30);
      final AccidentDamageMap original = AccidentDamageMap.fromMarks(
        <AccidentDamageMark>[
          AccidentDamageMark(
            zoneId: 'left_410_520',
            view: AccidentDamageView.left,
            normalizedX: .41,
            normalizedY: .52,
            areaLabel: 'Cab door',
            damageType: AccidentDamageType.cracked,
            severity: AccidentDamageSeverity.moderate,
            note: 'Runs to lower hinge',
            photoReferences: const <String>[
              'photo_damage_closeup:local-1',
              'evidence:server-2',
            ],
            suggestion: AccidentDamageSuggestion(
              source: 'finder-v2',
              confidence: .87,
              suggestedType: AccidentDamageType.scratch,
              suggestedArea: 'Front door',
              decision: AccidentDamageSuggestionDecision.corrected,
              reviewedBy: 'operator-17',
              reviewedAt: reviewedAt,
              correctionNote: 'Crack visible under paint',
            ),
          ),
        ],
      );

      final Object? decoded = jsonDecode(jsonEncode(original.toJson()));
      final AccidentDamageMap restored = AccidentDamageMap.fromJson(
        decoded! as Map<String, Object?>,
      );

      expect(original.toJson()['version'], 2);
      expect(restored, original);
      expect(restored.marks.single.photoCount, 2);
      expect(
        restored.marks.single.suggestion?.decision,
        AccidentDamageSuggestionDecision.corrected,
      );
    });

    test('suggestion review preserves the machine proposal for audit', () {
      const AccidentDamageSuggestion proposal = AccidentDamageSuggestion(
        source: 'finder-local',
        confidence: .72,
        suggestedType: AccidentDamageType.dent,
        suggestedArea: 'Cab',
      );
      final AccidentDamageSuggestion reviewed = proposal.reviewed(
        decision: AccidentDamageSuggestionDecision.corrected,
        reviewedAt: DateTime.utc(2026, 8, 31),
        reviewedBy: 'fleet-user',
        correctionNote: 'Damage is on the cargo bed',
      );

      expect(reviewed.suggestedType, AccidentDamageType.dent);
      expect(reviewed.suggestedArea, 'Cab');
      expect(reviewed.decision, AccidentDamageSuggestionDecision.corrected);
      expect(reviewed.reviewedBy, 'fleet-user');
      expect(reviewed.isReviewed, isTrue);
    });

    test('photo reference view cannot be mutated by a consumer', () {
      const AccidentDamageMark mark = AccidentDamageMark(
        zoneId: 'rear_500_500',
        severity: AccidentDamageSeverity.minor,
        photoReferences: <String>['photo_damage_closeup:1'],
      );

      expect(
        () => mark.photoReferences.add('photo_damage_closeup:2'),
        throwsUnsupportedError,
      );
      expect(mark.photoCount, 1);
    });

    test('marker numbering remains stable when an existing mark is edited', () {
      final AccidentDamageMap map = const AccidentDamageMap.empty()
          .withMark(frontBumperMinor)
          .withMark(leftDoorSevere)
          .withMark(
            frontBumperMinor.copyWith(
              damageType: AccidentDamageType.dent,
              severity: AccidentDamageSeverity.moderate,
            ),
          );

      expect(map.markerNumberFor('front_bumper'), 1);
      expect(map.markerNumberFor('left_front_door'), 2);
      expect(map.markerNumberFor('unknown'), isNull);
    });

    test('value equality and hash code do not depend on insertion order', () {
      final AccidentDamageMap first = AccidentDamageMap.fromMarks(
        const <AccidentDamageMark>[frontBumperMinor, leftDoorSevere],
      );
      final AccidentDamageMap second = AccidentDamageMap.fromMarks(
        const <AccidentDamageMark>[leftDoorSevere, frontBumperMinor],
      );

      expect(first, second);
      expect(first.hashCode, second.hashCode);
    });
  });
}

extension on AccidentDamageZone {
  Rect toRect() => Rect.fromLTRB(left, top, left + width, top + height);
}
