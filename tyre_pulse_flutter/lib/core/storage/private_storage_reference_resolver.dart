/// Resolves Tyre Pulse's opaque private-storage references for display.
///
/// The database stores `tp-storage://<bucket>/<path>`, never a public URL.
/// Both production clients resolve that reference through the authenticated
/// Supabase Storage client when evidence is viewed. This file is the Flutter
/// equivalent: it parses the opaque reference without rewriting it and mints
/// a short-lived URL whose access is still checked by Storage RLS.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';

const String privateStorageReferencePrefix = 'tp-storage://';

/// Fifteen minutes matches the current frozen mobile client and limits the
/// useful lifetime of a copied evidence URL.
const int privateStorageSignedUrlTtlSeconds = 15 * 60;

/// A validated opaque reference split into the two arguments Supabase Storage
/// requires. [path] is kept byte-for-byte as stored; it is evidence identity.
final class PrivateStorageReference {
  const PrivateStorageReference({required this.bucket, required this.path});

  final String bucket;
  final String path;

  static PrivateStorageReference? tryParse(String value) {
    if (!value.startsWith(privateStorageReferencePrefix)) return null;
    final String remainder =
        value.substring(privateStorageReferencePrefix.length);
    final int separator = remainder.indexOf('/');
    if (separator <= 0 || separator == remainder.length - 1) return null;

    final String bucket = remainder.substring(0, separator);
    final String path = remainder.substring(separator + 1);
    if (bucket.trim() != bucket ||
        path.trim().isEmpty ||
        bucket.contains(RegExp(r'[\\\x00-\x1F\x7F]')) ||
        path.contains(RegExp(r'[\x00-\x1F\x7F]'))) {
      return null;
    }
    return PrivateStorageReference(bucket: bucket, path: path);
  }
}

typedef PrivateStorageUrlSigner = Future<String> Function(
  String bucket,
  String path,
  int expiresIn,
);

/// The narrow read-only capability presentation code needs from Storage.
///
/// The injected signer keeps this contract independently testable. Production
/// uses [PrivateStorageReferenceResolver.supabase], which delegates to the
/// application's one authenticated [SupabaseClient].
final class PrivateStorageReferenceResolver with SupabaseGateway {
  const PrivateStorageReferenceResolver(this._sign);

  factory PrivateStorageReferenceResolver.supabase(SupabaseClient client) {
    return PrivateStorageReferenceResolver(
      (String bucket, String path, int expiresIn) =>
          client.storage.from(bucket).createSignedUrl(path, expiresIn),
    );
  }

  final PrivateStorageUrlSigner _sign;

  Future<String> resolve(String value) async {
    final PrivateStorageReference? reference =
        PrivateStorageReference.tryParse(value);
    if (reference == null) {
      throw const FormatException('Invalid private storage reference.');
    }
    return guard<String>(
      () => _sign(
        reference.bucket,
        reference.path,
        privateStorageSignedUrlTtlSeconds,
      ),
    );
  }
}
