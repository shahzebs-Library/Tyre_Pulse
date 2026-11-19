/// Sign-in identifier tidying shared by the login screen and the repository.
///
/// A person signs in with an email, a username, an employee id, or - for a
/// company other than the original one - `<company code>/<username>`. The
/// server does the real resolution (`public._resolve_sign_in_profile`, behind
/// `get_email_by_identifier` and the `sign-in` edge function's
/// `resolve_sign_in_user` call): a bare name is looked up first, so today's
/// users sign in exactly as before, and only then is the text split on the
/// first slash. This file only tidies what was typed so the same account is
/// always asked for in the same spelling (the lockout counter is keyed on that
/// text). It never decides who someone is.
///
/// Mirrors `public._split_sign_in_identifier` and the web
/// `src/lib/signInIdentifier.js`: a backslash counts as a slash, the code is
/// the part before the FIRST slash, both parts are trimmed, and a slash at the
/// very start does not make a code.
library;

/// The parts of a typed identifier. [companyCode] is null when the text
/// names no company (no slash, a leading slash, or an email).
final class SignInIdentifierParts {
  const SignInIdentifierParts({required this.companyCode, required this.name});

  final String? companyCode;
  final String? name;

  /// True when both a company code and a name are present.
  bool get hasCompanyCode => companyCode != null && name != null;
}

/// Tidies a typed identifier. Emails pass through trimmed. Otherwise a
/// backslash becomes a slash and spaces around the first slash are removed,
/// so `ACME \ ali` and `ACME/ali` ask for the same account.
String normalizeSignInIdentifier(String raw) {
  final String value = raw.trim();
  if (value.isEmpty || value.contains('@')) return value;
  final String s = value.replaceAll(r'\', '/');
  final int at = s.indexOf('/');
  if (at <= 0) return s;
  final String code = s.substring(0, at).trim();
  final String name = s.substring(at + 1).trim();
  if (code.isEmpty) return name;
  return '$code/$name';
}

/// Splits a typed identifier into its company code and name.
SignInIdentifierParts splitSignInIdentifier(String raw) {
  final String value = raw.trim();
  if (value.isEmpty) {
    return const SignInIdentifierParts(companyCode: null, name: null);
  }
  if (value.contains('@')) {
    return SignInIdentifierParts(companyCode: null, name: value);
  }
  final String s = value.replaceAll(r'\', '/');
  final int at = s.indexOf('/');
  if (at <= 0) {
    final String name = s.replaceFirst(RegExp(r'^/+'), '').trim();
    return SignInIdentifierParts(
      companyCode: null,
      name: name.isEmpty ? null : name,
    );
  }
  final String code = s.substring(0, at).trim();
  final String name = s.substring(at + 1).trim();
  return SignInIdentifierParts(
    companyCode: code.isEmpty ? null : code,
    name: name.isEmpty ? null : name,
  );
}
