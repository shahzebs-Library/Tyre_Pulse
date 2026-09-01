/// Coverage for the pure, I/O-free parts of the inspection-approvals data
/// layer: [inspectionApprovalCountryFilter], [buildReturnedNote] and
/// [InspectionApprovalItem.fromRow].
///
/// [SupabaseInspectionApprovalRepository] itself is NOT instantiated here.
/// No test file anywhere in this project constructs a real `SupabaseClient`
/// against a concrete `Supabase*RemoteRepository` implementation - every
/// `Supabase*RemoteRepository` in this codebase is exercised only through a
/// hand-written fake of its own interface at the point of USE (see
/// `test/features/inspections/data/inspection_sync_engine_test.dart`'s own
/// `_FakeRemoteRepository`). This feature builds no controller/engine on
/// top of [InspectionApprovalRepository] that would need such a fake, so
/// this file covers exactly the logic that IS independently testable: the
/// query-scoping decision, the note-merging decision, and the row decoder -
/// each a plain function/factory over plain Dart values, with no Supabase
/// type in sight.
///
/// [buildReturnedNote]'s four cases below are a direct port of
/// `mobile/__tests__/inspectionApprovals.test.ts`'s own pinned behaviour
/// for `decideInspection`'s notes echo (`mobile/` is READ-ONLY reference
/// material) - that file mocks the Supabase client to assert the RPC call
/// shape and the `notes` patch; this file asserts the same DECISION (what
/// the merged note should read) without needing that mock at all, because
/// the decision itself was extracted into a pure function specifically so
/// it could be tested this way.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_item.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_repository.dart';

void main() {
  group('inspection approval projections', () {
    test('full review query requests only live inspection evidence columns',
        () {
      final Set<String> columns =
          inspectionApprovalFullColumns.split(',').toSet();
      expect(
        columns,
        containsAll(<String>{
          'tyre_conditions',
          'photo_data',
          'custom_data',
        }),
      );
      // Verified against the live schema on 2026-09-01. `photos` exists on
      // checklist_submissions, not inspections; selecting it makes every
      // approval detail read fail before the screen can render.
      expect(columns, isNot(contains('photos')));
    });

    test('lean queue query does not download heavy evidence blobs', () {
      final Set<String> columns =
          inspectionApprovalListColumns.split(',').toSet();
      expect(columns, isNot(contains('tyre_conditions')));
      expect(columns, isNot(contains('photos')));
      expect(columns, isNot(contains('photo_data')));
      expect(columns, isNot(contains('custom_data')));
    });
  });

  group('inspectionApprovalCountryFilter', () {
    test('null country means no filter at all', () {
      expect(inspectionApprovalCountryFilter(null), isNull);
    });

    test('an empty or whitespace-only country means no filter', () {
      expect(inspectionApprovalCountryFilter(''), isNull);
      expect(inspectionApprovalCountryFilter('   '), isNull);
    });

    test("the 'All' sentinel means no filter", () {
      expect(inspectionApprovalCountryFilter('All'), isNull);
    });

    test('a real country scopes to it OR a null row country', () {
      expect(
        inspectionApprovalCountryFilter('KSA'),
        'country.eq.KSA,country.is.null',
      );
    });
  });

  group('buildReturnedNote', () {
    // #mirror: mobile/__tests__/inspectionApprovals.test.ts
    // 'echoes the reason into notes so the inspector can read it'.
    test('merges the existing notes with a Returned-by line', () {
      final String merged = buildReturnedNote(
        existingNotes: 'Original observation',
        approverName: 'Sara',
        note: 'Front left tread not recorded',
      );
      expect(merged, contains('Original observation'));
      expect(
        merged,
        contains('Returned by Sara: Front left tread not recorded'),
      );
    });

    test('drops the existing-notes line entirely when there were none', () {
      final String merged = buildReturnedNote(
        existingNotes: null,
        approverName: 'Sara',
        note: 'Front left tread not recorded',
      );
      expect(merged, 'Returned by Sara: Front left tread not recorded');
    });

    test('also drops it when the existing notes are blank once trimmed', () {
      final String merged = buildReturnedNote(
        existingNotes: '   ',
        approverName: 'Sara',
        note: 'A reason',
      );
      expect(merged, 'Returned by Sara: A reason');
    });

    test('falls back to "supervisor" when no approver name is given', () {
      final String merged = buildReturnedNote(
        existingNotes: null,
        approverName: null,
        note: 'A reason',
      );
      expect(merged, 'Returned by supervisor: A reason');
    });

    test('also falls back when the approver name is blank once trimmed', () {
      final String merged = buildReturnedNote(
        existingNotes: null,
        approverName: '   ',
        note: 'A reason',
      );
      expect(merged, 'Returned by supervisor: A reason');
    });
  });

  group('InspectionApprovalItem.fromRow', () {
    test('decodes every column', () {
      final InspectionApprovalItem item = InspectionApprovalItem.fromRow(
        <String, Object?>{
          'id': 'insp-1',
          'title': 'Daily check',
          'site': 'NHC',
          'asset_no': 'TM514',
          'vehicle_type': 'Tr-Mixer',
          'inspector': 'Ahmed',
          'inspection_date': '2026-08-20',
          'created_at': '2026-08-20T09:00:00.000Z',
          'status': 'Done',
          'approval_status': 'pending_approval',
          'notes': 'All good',
          'findings': 'Nothing to report',
          'odometer_km': 45210,
          'hour_meter': 120.5,
          'tyre_conditions': <String, Object?>{
            'F1L': <String, Object?>{
              'position': 'F1L',
              'serial_number': 'SER-001',
              'pressure_psi': 0,
              'tread_depth_mm': '8.5',
              'condition': 'Flat',
              'checked': true,
              'photo_url': 'tp-storage://tyre-photos/inspections/i/F1L.jpg',
              'notes': 'Valve leaking',
              'future_field': <String, Object?>{'kept': true},
            },
          },
          'photos': <Object?>[
            'tp-storage://tyre-photos/inspections/i/general-1.jpg',
          ],
          'photo_data':
              '["tp-storage://tyre-photos/inspections/i/general-2.jpg"]',
          'custom_data': <String, Object?>{
            'photos': <Object?>[
              'tp-storage://tyre-photos/inspections/i/general-2.jpg',
              'https://example.test/general-3.jpg',
            ],
          },
          'inspector_signature': 'data:image/png;base64,aaa',
          'approver_signature': null,
          'approver_email': null,
          'approved_at': null,
        },
      );

      expect(item.id, 'insp-1');
      expect(item.title, 'Daily check');
      expect(item.site, 'NHC');
      expect(item.assetNo, 'TM514');
      expect(item.vehicleType, 'Tr-Mixer');
      expect(item.inspector, 'Ahmed');
      expect(item.inspectionDate, '2026-08-20');
      expect(item.createdAt, '2026-08-20T09:00:00.000Z');
      expect(item.status, 'Done');
      expect(item.approvalStatus, 'pending_approval');
      expect(item.notes, 'All good');
      expect(item.findings, 'Nothing to report');
      expect(item.odometerKm, 45210);
      expect(item.hourMeter, 120.5);
      expect(item.tyreConditions, isA<Map<String, Object?>>());
      expect(item.tyreReadings, hasLength(1));
      final InspectionApprovalTyreReading reading = item.tyreReadings.single;
      expect(reading.position, 'F1L');
      expect(reading.serialNumber, 'SER-001');
      expect(reading.pressurePsi, 0);
      expect(reading.treadDepthMm, '8.5');
      expect(reading.condition, 'Flat');
      expect(reading.checked, isTrue);
      expect(reading.notes, 'Valve leaking');
      expect(
        reading.photoRef,
        'tp-storage://tyre-photos/inspections/i/F1L.jpg',
      );
      expect(reading.raw['future_field'], <String, Object?>{'kept': true});
      expect(
        item.photoEvidence
            .map((InspectionApprovalPhotoEvidence e) => e.reference),
        <String>[
          'tp-storage://tyre-photos/inspections/i/F1L.jpg',
          'tp-storage://tyre-photos/inspections/i/general-1.jpg',
          'tp-storage://tyre-photos/inspections/i/general-2.jpg',
          'https://example.test/general-3.jpg',
        ],
      );
      expect(item.photoEvidence.first.position, 'F1L');
      expect(item.photoEvidence.first.condition, 'Flat');
      expect(item.photoEvidence.first.source, 'tyre_conditions');
      expect(item.inspectorSignature, 'data:image/png;base64,aaa');
      expect(item.approverSignature, isNull);
      expect(item.approverEmail, isNull);
      expect(item.approvedAt, isNull);
    });

    test("every optional column may be absent (the queue's lean select)", () {
      final InspectionApprovalItem item = InspectionApprovalItem.fromRow(
        <String, Object?>{'id': 'insp-2'},
      );

      expect(item.id, 'insp-2');
      expect(item.title, isNull);
      expect(item.site, isNull);
      expect(item.assetNo, isNull);
      expect(item.vehicleType, isNull);
      expect(item.inspector, isNull);
      expect(item.odometerKm, isNull);
      expect(item.hourMeter, isNull);
      expect(item.tyreConditions, isNull);
      expect(item.tyreReadings, isEmpty);
      expect(item.photoEvidence, isEmpty);
      expect(item.isPending, isFalse);
      expect(item.isApproved, isFalse);
    });

    test('a missing id throws a FormatException', () {
      expect(
        () => InspectionApprovalItem.fromRow(<String, Object?>{'x': 1}),
        throwsFormatException,
      );
    });

    test('an empty-string id throws a FormatException', () {
      expect(
        () => InspectionApprovalItem.fromRow(<String, Object?>{'id': ''}),
        throwsFormatException,
      );
    });

    test('a non-string id throws a FormatException', () {
      expect(
        () => InspectionApprovalItem.fromRow(<String, Object?>{'id': 42}),
        throwsFormatException,
      );
    });

    test('numeric columns coerce from an int or a double alike', () {
      final InspectionApprovalItem fromInts = InspectionApprovalItem.fromRow(
        <String, Object?>{'id': 'a', 'odometer_km': 100, 'hour_meter': 5},
      );
      expect(fromInts.odometerKm, 100);
      expect(fromInts.hourMeter, 5.0);

      final InspectionApprovalItem fromDoubles = InspectionApprovalItem.fromRow(
        <String, Object?>{'id': 'b', 'odometer_km': 100.0, 'hour_meter': 5.5},
      );
      expect(fromDoubles.odometerKm, 100);
      expect(fromDoubles.hourMeter, 5.5);
    });

    test('preserves exact submitted position keys, readings, and statuses', () {
      final InspectionApprovalItem item = InspectionApprovalItem.fromRow(
        <String, Object?>{
          'id': 'evidence',
          'tyre_conditions': <String, Object?>{
            // V1 is the current inspection vocabulary. Do not relabel it here.
            'R2Ro': <String, Object?>{
              'pressure_psi': '110',
              'tread_depth_mm': 7,
              'condition': 'Puncture',
              'checked': false,
            },
            // Legacy/canonical keys must survive too.
            'RHRO': <String, Object?>{
              'pressure': 0.0,
              'tread_depth': '0',
              'risk': 'Flat',
            },
          },
        },
      );

      expect(
        item.tyreReadings.map((InspectionApprovalTyreReading e) => e.position),
        <String>['R2Ro', 'RHRO'],
      );
      expect(item.tyreReadings[0].pressurePsi, '110');
      expect(item.tyreReadings[0].treadDepthMm, 7);
      expect(item.tyreReadings[0].condition, 'Puncture');
      expect(item.tyreReadings[0].checked, isFalse);
      expect(item.tyreReadings[1].pressurePsi, 0.0);
      expect(item.tyreReadings[1].treadDepthMm, '0');
      expect(item.tyreReadings[1].condition, 'Flat');
    });

    test('decodes every verified legacy tyre_conditions shape', () {
      final InspectionApprovalItem jsonMap = InspectionApprovalItem.fromRow(
        <String, Object?>{
          'id': 'json-map',
          'tyre_conditions':
              '{"F1L":{"condition":"Damaged","pressure_psi":92}}',
        },
      );
      expect(jsonMap.tyreReadings.single.position, 'F1L');
      expect(jsonMap.tyreReadings.single.pressurePsi, 92);

      final InspectionApprovalItem list = InspectionApprovalItem.fromRow(
        <String, Object?>{
          'id': 'list',
          'tyre_conditions': <Object?>[
            <String, Object?>{
              'position': 'R1Li',
              'condition': 'Worn',
              'pressure_psi': 95,
            },
          ],
        },
      );
      expect(list.tyreReadings.single.position, 'R1Li');
      expect(list.tyreReadings.single.condition, 'Worn');

      final InspectionApprovalItem bareCondition =
          InspectionApprovalItem.fromRow(<String, Object?>{
        'id': 'bare',
        'tyre_conditions': <String, Object?>{'FL': 'Good'},
      });
      expect(bareCondition.tyreReadings.single.position, 'FL');
      expect(bareCondition.tyreReadings.single.condition, 'Good');
    });

    test('keeps photo-only tyre evidence and all verified row photo sources',
        () {
      final InspectionApprovalItem item = InspectionApprovalItem.fromRow(
        <String, Object?>{
          'id': 'photos',
          'tyre_conditions': <String, Object?>{
            'R1Lo': <String, Object?>{
              'photo_uri': 'file:///legacy-local.jpg',
            },
          },
          'photos': <Object?>['tp-storage://bucket/a.jpg', '', 42],
          'photo_data': 'data:image/jpeg;base64,abc',
          'custom_data': <String, Object?>{
            'photos': <Object?>[
              'tp-storage://bucket/a.jpg',
              'https://example.test/b.jpg',
            ],
          },
        },
      );

      expect(item.tyreReadings, hasLength(1));
      expect(item.tyreReadings.single.pressurePsi, isNull);
      expect(item.photoEvidence, hasLength(4));
      expect(item.photoEvidence.first.position, 'R1Lo');
      expect(item.photoEvidence.first.reference, 'file:///legacy-local.jpg');
      expect(
        item.photoEvidence
            .where((InspectionApprovalPhotoEvidence e) => !e.isPositionPhoto)
            .map((InspectionApprovalPhotoEvidence e) => e.source),
        <String>['photos', 'photo_data', 'custom_data.photos'],
      );
    });

    test('malformed optional evidence degrades to empty without throwing', () {
      final InspectionApprovalItem item = InspectionApprovalItem.fromRow(
        <String, Object?>{
          'id': 'malformed',
          'tyre_conditions': '{not-json',
          'photos': <String, Object?>{'unexpected': true},
          'photo_data': 42,
          'custom_data': 'not-a-map',
        },
      );
      expect(item.tyreReadings, isEmpty);
      expect(item.photoEvidence, isEmpty);
    });

    test('decoded evidence collections cannot be mutated by consumers', () {
      final InspectionApprovalItem item = InspectionApprovalItem.fromRow(
        <String, Object?>{
          'id': 'immutable',
          'tyre_conditions': <String, Object?>{
            'FL': <String, Object?>{'condition': 'Good'},
          },
        },
      );
      expect(
        () => item.tyreReadings.add(item.tyreReadings.single),
        throwsUnsupportedError,
      );
      expect(
        () => item.tyreReadings.single.raw['condition'] = 'Flat',
        throwsUnsupportedError,
      );
    });

    group('isPending / isApproved', () {
      test('pending_approval is pending, not approved', () {
        final InspectionApprovalItem item = InspectionApprovalItem.fromRow(
          <String, Object?>{'id': 'a', 'approval_status': 'pending_approval'},
        );
        expect(item.isPending, isTrue);
        expect(item.isApproved, isFalse);
      });

      test('approved is neither pending nor... not approved', () {
        final InspectionApprovalItem item = InspectionApprovalItem.fromRow(
          <String, Object?>{'id': 'a', 'approval_status': 'approved'},
        );
        expect(item.isPending, isFalse);
        expect(item.isApproved, isTrue);
      });

      test('rejected is decided (not pending) and not approved', () {
        final InspectionApprovalItem item = InspectionApprovalItem.fromRow(
          <String, Object?>{'id': 'a', 'approval_status': 'rejected'},
        );
        expect(item.isPending, isFalse);
        expect(item.isApproved, isFalse);
      });

      test('an absent approval_status is decided, never pending', () {
        // A malformed/absent status must not dress up as something still
        // awaiting action - see the field's own doc comment.
        final InspectionApprovalItem item = InspectionApprovalItem.fromRow(
          <String, Object?>{'id': 'a'},
        );
        expect(item.isPending, isFalse);
      });
    });
  });
}
