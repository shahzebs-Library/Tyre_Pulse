/// Safe client-built PostgREST search-filter text.
///
/// Ported from `escapeLike` / `orIlike` in `mobile/lib/queryFilters.ts`,
/// which the production register's search box depends on directly. A
/// `.or()` filter string is PostgREST's own small grammar: comma separates
/// clauses and parentheses group them, so a user-typed comma or paren would
/// otherwise be read as filter SYNTAX rather than as characters to search
/// for. Separately, `ilike` treats `%`, `_` and backslash as pattern
/// metacharacters, and this application's own history (recorded here
/// because it explains why `*` is stripped too, which is not an `ilike`
/// metacharacter on its own) treated `*` as an informal wildcard alias
/// elsewhere in the product, so a literal `*` is stripped defensively rather
/// than risk it being read as one here.
///
/// This is a client-side safety net, not a search engine: it turns any typed
/// term into a plain literal substring match. It does not index anything and
/// it does not replace a server-side search RPC, should this register ever
/// need one at fleet scale.
library;

/// Characters that either delimit a PostgREST `.or()` list (comma,
/// parentheses) or act as `ilike` pattern metacharacters (`%`, `_`,
/// backslash), plus the informal `*` wildcard. Hyphens, dots and single
/// spaces are KEPT: they are common inside a real asset number or serial.
final RegExp _unsafeLikeChars = RegExp(r'[,()%_\\*]');

/// The longest term this register will search for. Matches the production
/// limit: it exists to keep a pasted paragraph from becoming a pointless
/// query, not to reject any real asset number, serial or brand.
const int kMaxSearchTermLength = 100;

/// Strips `.or()`/`ilike`-significant characters, collapses whitespace and
/// caps the length. Returns `''` for a blank or whitespace-only [term], so a
/// caller can treat an empty result as "no search filter" without a second
/// check.
///
/// Idempotent: escaping an already-escaped term is a no-op.
String escapeLikeTerm(String term) {
  final String stripped = term.replaceAll(_unsafeLikeChars, '');
  final String collapsed = stripped.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (collapsed.length <= kMaxSearchTermLength) return collapsed;
  return collapsed.substring(0, kMaxSearchTermLength);
}

/// Builds a safe, comma-joined `col.ilike.%term%` expression for a
/// PostgREST `.or()` filter across [columns], from the raw, unescaped
/// [term].
///
/// Returns null when the escaped term is empty or no columns were given, so
/// the caller can skip the `.or()` filter entirely rather than send a
/// filter that matches nothing or is malformed.
String? orIlikeFilter(List<String> columns, String term) {
  final String safe = escapeLikeTerm(term);
  if (safe.isEmpty) return null;
  final List<String> cols = columns
      .where((String column) => column.isNotEmpty)
      .toList();
  if (cols.isEmpty) return null;
  return cols.map((String column) => '$column.ilike.%$safe%').join(',');
}
