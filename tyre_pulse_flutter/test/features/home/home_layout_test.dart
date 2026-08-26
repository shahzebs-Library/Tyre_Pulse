import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/features/home/home_layout.dart';

void main() {
  group('visibleHomeSections', () {
    const HomeSectionSpec field = HomeSectionSpec(
      id: 'field',
      tiles: <HomeTileSpec>[
        HomeTileSpec(id: 'serial', module: ModuleKey.serial),
        HomeTileSpec(id: 'meter', module: ModuleKey.meter),
      ],
    );
    const HomeSectionSpec fleet = HomeSectionSpec(
      id: 'fleet',
      tiles: <HomeTileSpec>[
        HomeTileSpec(id: 'records', module: ModuleKey.records),
        HomeTileSpec(id: 'vehicles', module: ModuleKey.vehicles),
      ],
    );
    final List<HomeSectionSpec> catalog = <HomeSectionSpec>[field, fleet];

    test('keeps every tile when every module is accessible', () {
      final List<HomeSectionSpec> result = visibleHomeSections(
        catalog,
        (ModuleKey m) => true,
      );
      expect(result, hasLength(2));
      expect(result[0].tiles, hasLength(2));
      expect(result[1].tiles, hasLength(2));
    });

    test('drops a single inaccessible tile without dropping its section', () {
      final List<HomeSectionSpec> result = visibleHomeSections(
        catalog,
        (ModuleKey m) => m != ModuleKey.meter,
      );
      expect(result, hasLength(2));
      final HomeSectionSpec resultField = result.firstWhere(
        (HomeSectionSpec s) => s.id == 'field',
      );
      expect(resultField.tiles.map((HomeTileSpec t) => t.id), <String>[
        'serial',
      ]);
    });

    test(
      'drops a whole section once every one of its tiles is inaccessible',
      () {
        final List<HomeSectionSpec> result = visibleHomeSections(
          catalog,
          (ModuleKey m) => m == ModuleKey.records || m == ModuleKey.vehicles,
        );
        expect(result, hasLength(1));
        expect(result.single.id, 'fleet');
      },
    );

    test('returns an empty list, never a null or a section with no tiles', () {
      final List<HomeSectionSpec> result = visibleHomeSections(
        catalog,
        (ModuleKey m) => false,
      );
      expect(result, isEmpty);
    });

    test('preserves declaration order of both sections and tiles', () {
      final List<HomeSectionSpec> result = visibleHomeSections(
        catalog,
        (ModuleKey m) => true,
      );
      expect(result.map((HomeSectionSpec s) => s.id), <String>[
        'field',
        'fleet',
      ]);
      expect(result[0].tiles.map((HomeTileSpec t) => t.id), <String>[
        'serial',
        'meter',
      ]);
    });

    test('a tile spec with two entries sharing one module both survive', () {
      const HomeSectionSpec shared = HomeSectionSpec(
        id: 'checklists',
        tiles: <HomeTileSpec>[
          HomeTileSpec(id: 'checklists', module: ModuleKey.checklists),
          HomeTileSpec(id: 'checklistHistory', module: ModuleKey.checklists),
        ],
      );
      final List<HomeSectionSpec> result = visibleHomeSections(
        <HomeSectionSpec>[shared],
        (ModuleKey m) => m == ModuleKey.checklists,
      );
      expect(result.single.tiles, hasLength(2));
    });
  });

  group('homeHasNoVisibleTiles', () {
    final List<HomeSectionSpec> catalog = <HomeSectionSpec>[
      const HomeSectionSpec(
        id: 'field',
        tiles: <HomeTileSpec>[
          HomeTileSpec(id: 'serial', module: ModuleKey.serial),
        ],
      ),
    ];

    test('is true when nothing is accessible', () {
      expect(homeHasNoVisibleTiles(catalog, (ModuleKey m) => false), isTrue);
    });

    test('is false once at least one tile is accessible', () {
      expect(homeHasNoVisibleTiles(catalog, (ModuleKey m) => true), isFalse);
    });

    test('is true for an empty catalog regardless of the predicate', () {
      expect(
        homeHasNoVisibleTiles(const <HomeSectionSpec>[], (ModuleKey m) => true),
        isTrue,
      );
    });
  });
}
