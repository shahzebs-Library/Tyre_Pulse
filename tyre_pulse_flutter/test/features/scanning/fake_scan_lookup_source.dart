import 'package:tyre_pulse/features/scanning/domain/scan_lookup.dart';

/// A hand-written fake [ScanLookupSource], not a mock, so the RECORDED CALL
/// LIST is part of what a test can assert.
///
/// `resolveScanLookup`'s ordering rule ("asset before tyre, exact before
/// fuzzy, stop at the first hit") is a rule about which steps are NOT
/// called, and a call list is the only way to test that - the same
/// reasoning `test/core/workspace/workspace_switch_test.dart`'s
/// `FakeDependencies` documents for its own call list.
final class FakeScanLookupSource implements ScanLookupSource {
  /// Every method call, in order, as `methodName:code`.
  final List<String> calls = <String>[];

  /// What [findAssetByExactNumber] returns for a given code.
  final Map<String, AssetLookupRecord> exactAssetByCode =
      <String, AssetLookupRecord>{};

  /// What [findAssetByNumberIgnoringCase] returns for a given code.
  final Map<String, AssetLookupRecord> assetByNumberIgnoringCase =
      <String, AssetLookupRecord>{};

  /// What [findAssetByFleetNumberIgnoringCase] returns for a given code.
  final Map<String, AssetLookupRecord> assetByFleetNumberIgnoringCase =
      <String, AssetLookupRecord>{};

  /// What [findTyreBySerial] returns for a given code.
  final Map<String, TyreLookupRecord> tyreBySerial =
      <String, TyreLookupRecord>{};

  /// When set, every method throws this instead of returning. Configure it
  /// alone - a test that also populates one of the maps above is asserting
  /// two different things about the same call at once.
  Object? errorToThrow;

  @override
  Future<AssetLookupRecord?> findAssetByExactNumber(String code) async {
    calls.add('exact:$code');
    _throwIfConfigured();
    return exactAssetByCode[code];
  }

  @override
  Future<AssetLookupRecord?> findAssetByNumberIgnoringCase(String code) async {
    calls.add('numberIgnoringCase:$code');
    _throwIfConfigured();
    return assetByNumberIgnoringCase[code];
  }

  @override
  Future<AssetLookupRecord?> findAssetByFleetNumberIgnoringCase(
    String code,
  ) async {
    calls.add('fleetNumberIgnoringCase:$code');
    _throwIfConfigured();
    return assetByFleetNumberIgnoringCase[code];
  }

  @override
  Future<TyreLookupRecord?> findTyreBySerial(String code) async {
    calls.add('tyreSerial:$code');
    _throwIfConfigured();
    return tyreBySerial[code];
  }

  /// Rethrows a configured failure with its own static type, so the throw
  /// satisfies `only_throw_errors` - mirrors
  /// `workspace_switch_test.dart`'s `FakeDependencies._raiseIfSet`.
  void _throwIfConfigured() {
    final Object? error = errorToThrow;
    if (error == null) {
      return;
    }
    if (error is Error) {
      throw error;
    }
    if (error is Exception) {
      throw error;
    }
    throw StateError('fake configured with an unthrowable value: $error');
  }
}
