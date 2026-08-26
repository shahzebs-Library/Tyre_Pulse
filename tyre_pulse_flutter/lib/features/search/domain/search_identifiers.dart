/// Pure identifier-shape checks that decide which repositories a raw search
/// term is worth trying against.
///
/// # Why this exists at all
///
/// Spec section 34 asks for one search box that "understands" seven kinds of
/// identifier, but a raw typed string carries no tag saying which kind it
/// is. The design this feature takes - see
/// `presentation/global_search_controller.dart`'s own library comment - is
/// NOT to guess a single kind and commit to it; it is to try every
/// identifier type's own NORMALISED lookup in parallel and show whatever
/// answers. That is what keeps this an indexed multi-lookup rather than "a
/// raw client-side substring scan of everything" (the task's own words for
/// what NOT to build).
///
/// The one exception is [isUuidLike]: an inspection is addressed by its
/// server row id, which is a uuid, and handing a non-uuid string to a
/// `.eq('id', ...)` filter on a uuid column does not fail soft - PostgREST
/// raises a real error for a malformed uuid literal. So that one lookup is
/// gated on shape BEFORE it is attempted, the same way a caller would gate
/// any other precondition it can check for free rather than pay for on the
/// server.
library;

/// A permissive RFC 4122 shape check: eight-four-four-four-twelve hex
/// digits, any of the four canonical dash groupings. Deliberately not
/// stricter than that (it does not check the version/variant nibbles) -
/// this only has to decide "is it worth trying id equality", not "is this a
/// version-4 uuid".
final RegExp _uuidPattern = RegExp(
  r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-'
  r'[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
);

/// Whether [raw], once trimmed, has the shape of a uuid.
///
/// An inspection's server id is the ONLY identifier this search feature
/// treats this way - see the library comment for why. A blank or malformed
/// string answers false rather than throwing, so a caller can use this as a
/// plain gate: `if (isUuidLike(term)) ... else skip the inspection lookup`.
bool isUuidLike(String raw) => _uuidPattern.hasMatch(raw.trim());

/// Escapes `\`, `%` and `_` so [term] can be safely interpolated into a
/// Postgres `ILIKE` pattern.
///
/// Kept here, as pure logic with no [SupabaseClient] dependency, rather than
/// private inside `data/global_search_repository.dart`, for two reasons:
/// this makes it directly unit-testable without any network layer at all,
/// and it is exactly the kind of string-shape rule this domain file already
/// exists to hold - the same class of defect the web codebase already found
/// and fixed once in `searchFilter.js`'s own `escapeLike` (an unescaped `%`
/// in a typed term silently widens a narrow search into a match-everything
/// scan), reproduced here for the same reason rather than trusted not to
/// recur.
String escapeLikePattern(String term) {
  return term
      .replaceAll('\\', '\\\\')
      .replaceAll('%', '\\%')
      .replaceAll('_', '\\_');
}
