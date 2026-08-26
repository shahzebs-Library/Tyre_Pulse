/// Pure Home-hub layout rules - which sections and tiles are visible.
///
/// Deliberately dependency-free (no `BuildContext`, no `WidgetRef`, no I/O):
/// [visibleHomeSections] takes the FULL tile catalog and a plain
/// `bool Function(ModuleKey)`, and returns the subset a caller with that
/// access should see. `presentation/home_screen.dart` is the only caller that
/// supplies a real access predicate (`ref.watch(canAccessModuleProvider(m))`
/// per tile); a test supplies a fake one and asserts the filtering directly,
/// with no widget tree and no provider container involved.
library;

import 'package:tyre_pulse/core/permissions/module_registry.dart';

/// One quick-action tile's UNGATED description.
///
/// Visibility is decided entirely by [visibleHomeSections] against [module] -
/// it is never stored on the tile itself, so the same catalog can be reused
/// against any access snapshot.
class HomeTileSpec {
  const HomeTileSpec({required this.id, required this.module});

  /// A stable identifier for this tile, independent of [module].
  ///
  /// Two tiles may legitimately share a [module] - "Checklists" and
  /// "Checklist History" both gate on [ModuleKey.checklists] but are
  /// different destinations - so [id] is what a caller keys widgets and
  /// route lookups on, never [module] alone.
  final String id;

  /// The module this tile is gated on.
  ///
  /// Every value used here corresponds to a `routeId` with a genuinely
  /// registered screen builder in the shared screen registry, verified by
  /// reading every `*_screen_registrations.dart` file and `main.dart`'s own
  /// `.withAll(...)` chain before this catalog was written - see the
  /// destinations map in `presentation/home_screen.dart`, which is the only
  /// place [id] is turned into a route push. A tile whose destination is not
  /// registered would render `TpScreenNotAvailable` on tap, which is exactly
  /// the "control that does nothing" this file exists to rule out.
  final ModuleKey module;
}

/// One heading with the tiles that belong under it.
class HomeSectionSpec {
  const HomeSectionSpec({required this.id, required this.tiles});

  /// A stable identifier for this section, turned into a localised heading by
  /// the caller (never stored here - this file has no [BuildContext] to
  /// localise with).
  final String id;

  final List<HomeTileSpec> tiles;
}

/// Filters [sections] down to the tiles [canAccess] admits for their
/// [HomeTileSpec.module], then drops any section left with no tiles at all.
///
/// A heading rendered over zero tiles reads as a promise the page does not
/// keep - the same reasoning `home_screen.dart`'s own stopgap-era comment
/// gives for its "nothing is available to you here yet" fallback, generalised
/// from one tile to a whole catalog of sections.
List<HomeSectionSpec> visibleHomeSections(
  List<HomeSectionSpec> sections,
  bool Function(ModuleKey module) canAccess,
) {
  final List<HomeSectionSpec> result = <HomeSectionSpec>[];
  for (final HomeSectionSpec section in sections) {
    final List<HomeTileSpec> tiles = section.tiles
        .where((HomeTileSpec tile) => canAccess(tile.module))
        .toList(growable: false);
    if (tiles.isEmpty) continue;
    result.add(HomeSectionSpec(id: section.id, tiles: tiles));
  }
  return List<HomeSectionSpec>.unmodifiable(result);
}

/// True when [sections], filtered through [canAccess], has no tile at all -
/// the signal `home_screen.dart` uses to decide between rendering the section
/// list and rendering its dashed "nothing available" card.
bool homeHasNoVisibleTiles(
  List<HomeSectionSpec> sections,
  bool Function(ModuleKey module) canAccess,
) => visibleHomeSections(sections, canAccess).isEmpty;
