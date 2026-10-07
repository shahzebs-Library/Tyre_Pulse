import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/workshop_status/domain/workshop_status_record.dart';
import 'package:tyre_pulse/features/workshop_status/domain/workshop_status_vocab.dart';
import 'package:tyre_pulse/features/workshop_status/presentation/workshop_status_list_screen.dart';

WorkshopStatusRecord _r(Map<String, dynamic> extra) =>
    WorkshopStatusRecord.fromRow(<String, dynamic>{
      'id': 'id-1',
      'updated_at': '2026-10-07T08:12:33.123456+00:00',
      'asset_no': 'TM514',
      ...extra,
    });

void main() {
  final DateTime now = DateTime(2026, 10, 7, 15);

  group('fromRow', () {
    test('keeps updated_at as the exact server string', () {
      expect(
        _r(<String, dynamic>{}).updatedAtRaw,
        '2026-10-07T08:12:33.123456+00:00',
      );
    });

    test('blank text reads as null and dates are date-only', () {
      final WorkshopStatusRecord r = _r(<String, dynamic>{
        'site': '  ',
        'expected_part_date': '2026-10-09T00:00:00',
        'ooc_since': '2026-10-01',
      });
      expect(r.site, isNull);
      expect(r.expectedPartDate, '2026-10-09');
      expect(r.oocSince, '2026-10-01');
    });
  });

  group('days down', () {
    test('from ooc_since in whole days', () {
      expect(_r(<String, dynamic>{'ooc_since': '2026-10-01'}).daysDown(now), 6);
      expect(_r(<String, dynamic>{'ooc_since': '2026-10-07'}).daysDown(now), 0);
    });

    test('falls back to the Excel figure', () {
      expect(_r(<String, dynamic>{'excel_down_days': 12.7}).daysDown(now), 12);
      expect(_r(<String, dynamic>{'excel_down_days': '4'}).daysDown(now), 4);
    });

    test('is null, never 0, when unmeasurable', () {
      expect(_r(<String, dynamic>{}).daysDown(now), isNull);
      expect(
        _r(<String, dynamic>{'ooc_since': '2026-12-01'}).daysDown(now),
        isNull,
      );
      expect(
        _r(<String, dynamic>{'excel_down_days': -3}).daysDown(now),
        isNull,
      );
    });
  });

  group('freshness', () {
    test('judged on the last manual update only', () {
      expect(_r(<String, dynamic>{}).freshness(now), WorkshopFreshness.never);
      final DateTime localMorning = DateTime(2026, 10, 7, 9);
      expect(
        _r(<String, dynamic>{
          'last_manual_update_at': localMorning.toUtc().toIso8601String(),
        }).freshness(now),
        WorkshopFreshness.today,
      );
      expect(
        _r(<String, dynamic>{
          'last_manual_update_at':
              DateTime(2026, 10, 6, 9).toUtc().toIso8601String(),
        }).freshness(now),
        WorkshopFreshness.stale,
      );
    });
  });

  test('responsible match is case-insensitive and never matches blank', () {
    final WorkshopStatusRecord r =
        _r(<String, dynamic>{'responsible_user_id': 'ABC-1'});
    expect(r.isResponsible('abc-1'), isTrue);
    expect(r.isResponsible(''), isFalse);
    expect(_r(<String, dynamic>{}).isResponsible(''), isFalse);
  });

  test('released is the upload-only stage, shown as Released', () {
    expect(
      _r(<String, dynamic>{'current_stage': kWorkshopReleasedStage}).isReleased,
      isTrue,
    );
    expect(kWorkshopSelectableStages, isNot(contains(kWorkshopReleasedStage)));
  });

  group('diff patch', () {
    final WorkshopStatusRecord r = _r(<String, dynamic>{
      'current_stage': 'Waiting for Parts',
      'remarks': 'old',
      'responsible_user_id': 'aaa',
      'expected_part_date': '2026-10-09',
    });

    test('carries only changed fields, normalised', () {
      final Map<String, String?> form = workshopFormFromRecord(r)
        ..[WorkshopStatusFields.remarks] = '  new  '
        ..[WorkshopStatusFields.currentStage] = 'Waiting for Parts'
        ..[WorkshopStatusFields.responsibleUserId] = 'AAA';
      expect(workshopDiffPatch(r, form), <String, String?>{
        WorkshopStatusFields.remarks: 'new',
      });
    });

    test('a cleared field is sent as null', () {
      final Map<String, String?> form = workshopFormFromRecord(r)
        ..[WorkshopStatusFields.expectedPartDate] = null
        ..[WorkshopStatusFields.remarks] = '   ';
      expect(workshopDiffPatch(r, form), <String, String?>{
        WorkshopStatusFields.expectedPartDate: null,
        WorkshopStatusFields.remarks: null,
      });
    });

    test('unknown keys (who / when) never ride along', () {
      final Map<String, String?> form = <String, String?>{
        'last_updated_by_name': 'Me',
        'updated_at': 'now',
        'last_manual_update_at': 'now',
      };
      expect(workshopDiffPatch(r, form), isEmpty);
    });

    test('nothing changed is an empty patch', () {
      expect(workshopDiffPatch(r, workshopFormFromRecord(r)), isEmpty);
    });
  });

  group('validation', () {
    test('Other requires a detailed reason', () {
      expect(
        workshopValidateForm(<String, String?>{
          WorkshopStatusFields.delayReason: 'Other',
        })[WorkshopStatusFields.detailedReason],
        WorkshopFieldError.detailRequired,
      );
      expect(
        workshopValidateForm(<String, String?>{
          WorkshopStatusFields.delayReason: 'Other',
          WorkshopStatusFields.detailedReason: 'Crane broke',
        }),
        isEmpty,
      );
    });

    test('values must come from the lists', () {
      final Map<String, WorkshopFieldError> e =
          workshopValidateForm(<String, String?>{
        WorkshopStatusFields.currentStage: kWorkshopReleasedStage,
        WorkshopStatusFields.partsStatus: 'Lost',
      });
      expect(
        e[WorkshopStatusFields.currentStage],
        WorkshopFieldError.notInList,
      );
      expect(e[WorkshopStatusFields.partsStatus], WorkshopFieldError.notInList);
    });

    test('dates: real, realistic, release not before part', () {
      expect(
        workshopValidateForm(<String, String?>{
          WorkshopStatusFields.expectedPartDate: '2026-02-30',
        })[WorkshopStatusFields.expectedPartDate],
        WorkshopFieldError.invalidDate,
      );
      expect(
        workshopValidateForm(<String, String?>{
          WorkshopStatusFields.expectedPartDate: '1999-01-01',
        })[WorkshopStatusFields.expectedPartDate],
        WorkshopFieldError.dateRange,
      );
      expect(
        workshopValidateForm(<String, String?>{
          WorkshopStatusFields.expectedPartDate: '2026-10-10',
          WorkshopStatusFields.expectedReleaseDate: '2026-10-09',
        })[WorkshopStatusFields.expectedReleaseDate],
        WorkshopFieldError.releaseBeforePart,
      );
    });

    test('length limits', () {
      expect(
        workshopValidateForm(<String, String?>{
          WorkshopStatusFields.mrNumber: 'x' * 101,
          WorkshopStatusFields.remarks: 'x' * 4001,
        }),
        <String, WorkshopFieldError>{
          WorkshopStatusFields.mrNumber: WorkshopFieldError.tooLong,
          WorkshopStatusFields.remarks: WorkshopFieldError.tooLong,
        },
      );
    });
  });

  test('permissions fail closed', () {
    expect(WorkshopStatusPermissions.fromJson(null).view, isFalse);
    expect(WorkshopStatusPermissions.fromJson('x').update, isFalse);
    final WorkshopStatusPermissions p =
        WorkshopStatusPermissions.fromJson(const <String, dynamic>{
      'view': true,
      'update': 'true',
      'assign': true,
    });
    expect(p.view, isTrue);
    expect(p.update, isFalse);
    expect(p.assign, isTrue);
  });

  group('list filter', () {
    final List<WorkshopStatusRecord> records = <WorkshopStatusRecord>[
      WorkshopStatusRecord.fromRow(const <String, dynamic>{
        'id': 'a',
        'asset_no': 'TM100',
        'ooc_since': '2026-10-05',
        'responsible_user_id': 'me',
      }),
      WorkshopStatusRecord.fromRow(const <String, dynamic>{
        'id': 'b',
        'asset_no': 'MP200',
        'ooc_since': '2026-09-01',
        'site': 'NHC',
      }),
      WorkshopStatusRecord.fromRow(const <String, dynamic>{
        'id': 'c',
        'asset_no': 'BH300',
      }),
    ];

    test('Mine keeps only my vehicles', () {
      expect(
        filterWorkshopRecords(
          records,
          scope: WorkshopStatusScope.mine,
          query: '',
          userId: 'ME',
          now: now,
        ).map((WorkshopStatusRecord r) => r.id),
        <String>['a'],
      );
    });

    test('All sorts longest down first, unmeasurable last', () {
      expect(
        filterWorkshopRecords(
          records,
          scope: WorkshopStatusScope.all,
          query: '',
          userId: 'me',
          now: now,
        ).map((WorkshopStatusRecord r) => r.id),
        <String>['b', 'a', 'c'],
      );
    });

    test('search matches asset and site', () {
      expect(
        filterWorkshopRecords(
          records,
          scope: WorkshopStatusScope.all,
          query: 'nhc',
          userId: 'me',
          now: now,
        ).map((WorkshopStatusRecord r) => r.id),
        <String>['b'],
      );
    });
  });
}
