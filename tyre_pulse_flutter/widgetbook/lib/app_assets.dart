
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// The field app loads its artwork with unqualified keys such as
/// `assets/vehicle_photos/...`. Inside this catalogue those files belong to
/// the `tyre_pulse` dependency, so Flutter bundles them under
/// `packages/tyre_pulse/`. This bundle adds that prefix so every catalogue
/// entry shows the real vehicle artwork.
class TyrePulseAssetBundle extends CachingAssetBundle {
  TyrePulseAssetBundle([AssetBundle? parent]) : _parent = parent ?? rootBundle;

  final AssetBundle _parent;

  static String _resolve(String key) =>
      key.startsWith('assets/') ? 'packages/tyre_pulse/$key' : key;

  @override
  Future<ByteData> load(String key) => _parent.load(_resolve(key));

  @override
  Future<ImmutableBuffer> loadBuffer(String key) =>
      _parent.loadBuffer(_resolve(key));
}

/// Wraps a catalogue entry so asset lookups resolve to the app package.
Widget withAppAssets(Widget child) =>
    DefaultAssetBundle(bundle: TyrePulseAssetBundle(), child: child);
