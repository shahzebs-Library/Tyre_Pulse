/// Asset-number CLASS (prefix) helpers for the fleet register.
///
/// Ported from `mobile/lib/assetClasses.ts`, byte-for-byte in behaviour. Asset
/// numbers encode the equipment class in their leading letters (`TM` = transit
/// mixer, `MP` = mobile pump, `WL` = wheel loader, ...). Only SOME classes
/// carry tyres; generators (`GN`), batching plants (`BP`), ice plants (`IP`),
/// stationary/placing pumps (`SP`/`PB`) and so on never do, and they are what
/// pushes the full register past the practical size a technician wants to
/// scroll.
///
/// [tyreAssetClasses] is every class with at least one `tyre_records` row in
/// ANY country, measured live against the production database (recorded in
/// the source file as of 2026-08-06: TM/MP/PL/WL/BH/SL, plus LP in KSA and MB
/// in Egypt). Filtering the register to these by default is what keeps each
/// country's list well under the PostgREST response cap while every other
/// class stays one tap away via its own chip.
///
/// # Never guess a class for a code that does not match
///
/// [assetClassOf] returns `null`, not an invented "OTHER" bucket, for an
/// asset number with no recognisable leading letters. A class is a claim
/// about what KIND of machine this is, and inventing one for a code the
/// register does not explain would be exactly the kind of fabrication
/// AGENTS.md forbids. [classChips] then SKIPS such rows when building the
/// chip list - they are absent from every chip's count, never folded into a
/// misleading catch-all.
library;

/// Every asset class with at least one recorded tyre in any country.
///
/// Order matters: it is the priority order [classChips] sorts tyre-carrying
/// chips by, matching the production list exactly.
const List<String> tyreAssetClasses = <String>[
  'TM',
  'MP',
  'PL',
  'WL',
  'BH',
  'SL',
  'LP',
  'MB',
];

final Set<String> _tyreAssetClassSet = tyreAssetClasses.toSet();

/// Matches the leading run of ASCII letters at the start of a TRIMMED asset
/// number. Ported verbatim from the TypeScript `/^[A-Za-z]+/` test.
final RegExp _leadingLettersPattern = RegExp(r'^[A-Za-z]+');

/// The leading letters of [assetNo], uppercased - `'TM514'` becomes `'TM'`.
///
/// Returns null when [assetNo] is null, blank, or does not start with a
/// letter (for example a code that begins with a digit). A null here is the
/// honest answer "this code names no class the fleet register explains", and
/// callers must not substitute a guess for it.
String? assetClassOf(String? assetNo) {
  final String trimmed = (assetNo ?? '').trim();
  final RegExpMatch? match = _leadingLettersPattern.firstMatch(trimmed);
  if (match == null) {
    return null;
  }
  return match.group(0)!.toUpperCase();
}

/// Whether [assetNo] belongs to a class that carries tyres.
///
/// False for both "this class never carries tyres" (a generator, a batching
/// plant) and "this code names no recognisable class at all" - the two are
/// different facts, but neither one means the asset should be offered under
/// the tyre-carrying filter.
bool isTyreAsset(String? assetNo) {
  final String? cls = assetClassOf(assetNo);
  return cls != null && _tyreAssetClassSet.contains(cls);
}

/// One chip: a class, how many loaded rows carry it, and whether it is a
/// tyre-carrying class.
class AssetClassChip {
  const AssetClassChip({
    required this.assetClass,
    required this.count,
    required this.isTyreClass,
  });

  final String assetClass;
  final int count;
  final bool isTyreClass;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is AssetClassChip &&
          other.assetClass == assetClass &&
          other.count == count &&
          other.isTyreClass == isTyreClass);

  @override
  int get hashCode => Object.hash(assetClass, count, isTyreClass);

  @override
  String toString() =>
      'AssetClassChip($assetClass: $count, tyre: $isTyreClass)';
}

/// Builds the chip list from the loaded fleet's asset numbers: one chip per
/// class actually present, tyre classes first (in [tyreAssetClasses] order),
/// then the rest by count descending, ties broken alphabetically.
///
/// A row whose [assetClassOf] is null - no recognisable class - contributes
/// to NO chip. That is a deliberate omission, not a bug: a class chip is a
/// claim about a group of machines, and there is no group to name for a code
/// the register does not explain.
List<AssetClassChip> classChips(Iterable<String?> assetNumbers) {
  final Map<String, int> counts = <String, int>{};
  for (final String? assetNo in assetNumbers) {
    final String? cls = assetClassOf(assetNo);
    if (cls == null) {
      continue;
    }
    counts.update(cls, (int value) => value + 1, ifAbsent: () => 1);
  }

  final List<AssetClassChip> chips = counts.entries
      .map(
        (MapEntry<String, int> entry) => AssetClassChip(
          assetClass: entry.key,
          count: entry.value,
          isTyreClass: _tyreAssetClassSet.contains(entry.key),
        ),
      )
      .toList();

  chips.sort((AssetClassChip a, AssetClassChip b) {
    if (a.isTyreClass != b.isTyreClass) {
      return a.isTyreClass ? -1 : 1;
    }
    if (a.isTyreClass && b.isTyreClass) {
      return tyreAssetClasses
          .indexOf(a.assetClass)
          .compareTo(tyreAssetClasses.indexOf(b.assetClass));
    }
    final int byCount = b.count.compareTo(a.count);
    if (byCount != 0) {
      return byCount;
    }
    return a.assetClass.compareTo(b.assetClass);
  });

  return chips;
}
