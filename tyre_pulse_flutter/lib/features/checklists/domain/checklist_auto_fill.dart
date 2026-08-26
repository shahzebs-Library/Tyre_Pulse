/// `autoFrom` - register prefill (spec section 30, artifact section 4b),
/// plus [isFieldLocked] and the meter-regression warning.
///
/// Mirrors `AUTO_FILL_SOURCES`/`resolveAutoFill`/`isFieldLocked`/
/// `autoFillAnswers` in `mobile/lib/checklistMarks.ts:246-308` (the web
/// mirror `src/lib/checklist/checklistMarks.js` is pinned identical by
/// `src/test/checklistMarks.test.js`'s own drift test, so there is no
/// mobile/web divergence to choose between here, unlike `checklist_i18n.dart`).
///
/// A COMPLETELY SEPARATE mechanism from `autoValue`
/// (`checklist_auto_value.dart`) - see that file's library comment. This
/// one is keyed on the picked ASSET; that one on the signed-in user and
/// today's date.
library;

import 'package:tyre_pulse/features/checklists/domain/checklist_asset_context.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_template.dart';

/// The owner's own fallback rule for the two identity fields, stated
/// verbatim at `checklistMarks.ts:254-256`: "the registration number IS
/// the fleet number." An empty string counts as "not supplied", matching
/// JS `||` (not `??`) - so a field carrying `''` still falls through to
/// its sibling rather than winning on presence alone.
String? _preferring(String? primary, String? secondary) {
  if (primary != null && primary.isNotEmpty) return primary;
  return secondary;
}

/// The 8 known `autoFrom` tokens, mapped to what each reads off
/// [ChecklistAssetContext]. A token this map does not know resolves to
/// nothing rather than to a guess (E8) - adding a source is therefore a
/// template edit (naming an existing token) or a code change (adding a new
/// entry here), never an inference.
final Map<String, Object? Function(ChecklistAssetContext)> kChecklistAutoFillSources =
    <String, Object? Function(ChecklistAssetContext)>{
      'asset.site': (ChecklistAssetContext a) => a.site,
      'asset.fleet_no': (ChecklistAssetContext a) =>
          _preferring(a.fleetNumber, a.registrationNo),
      'asset.registration': (ChecklistAssetContext a) =>
          _preferring(a.registrationNo, a.fleetNumber),
      'asset.chassis_no': (ChecklistAssetContext a) =>
          _preferring(a.chassisNo, a.serialNo),
      'asset.current_km': (ChecklistAssetContext a) => a.currentKm,
      'asset.vehicle_type': (ChecklistAssetContext a) => a.vehicleType,
      'asset.make': (ChecklistAssetContext a) => a.make,
      'asset.model': (ChecklistAssetContext a) => a.model,
    };

/// The value [asset] supplies for [field]'s `autoFrom` token, or `''` when
/// it supplies nothing at all - no token (E8's own `'asset.invented'`), no
/// asset, an unknown token, or a blank/whitespace-only register value.
String resolveAutoFill(ChecklistField? field, ChecklistAssetContext? asset) {
  final String? token = field?.autoFrom;
  if (token == null || token.isEmpty || asset == null) return '';
  final Object? Function(ChecklistAssetContext)? fn = kChecklistAutoFillSources[token];
  if (fn == null) return '';
  final Object? v = fn(asset);
  if (v == null) return '';
  final String s = v.toString().trim();
  return s;
}

/// READ-ONLY IS CONDITIONAL, and that is the whole point (artifact section
/// 4b): `field.locked` locks the field ALWAYS, whatever the value;
/// `field.readOnly` locks it ONLY ONCE the value is non-blank. Otherwise
/// false.
///
/// RECORDED: `fleet_number` is populated on a minority of the real fleet
/// (398 of 1,030 KSA assets, none of the UAE/Egypt ones). An
/// unconditionally read-only field would be permanently blank and
/// unfillable for most of the fleet, so the field starts editable and
/// becomes locked the moment the register successfully fills it.
bool isFieldLocked(ChecklistField? field, Object? value) {
  if (field?.locked ?? false) return true;
  if (!(field?.readOnly ?? false)) return false;
  final String s = value?.toString().trim() ?? '';
  return s.isNotEmpty;
}

/// Applies [asset] to [template]'s current [answers]. Returns ONLY the
/// fields it actually filled, so a caller MERGES rather than replaces - a
/// value the user typed before picking the asset is never silently
/// overwritten by a blank (F5 - an asset the register knows nothing about
/// fills nothing, silently: the returned map is simply empty).
///
/// The write rule is asymmetric (F3/F4) and load-bearing: a `readOnly`
/// field ALWAYS takes the register value - that IS its source of truth,
/// even overwriting something already there (F4); an ordinary editable
/// field fills ONLY when the user has not already typed something (F3).
Map<String, String> autoFillAnswers(
  ChecklistTemplate? template,
  ChecklistAssetContext? asset,
  Map<String, Object?> current,
) {
  final Map<String, String> patch = <String, String>{};
  for (final ChecklistField field in answerableFields(template)) {
    if (field.autoFrom == null || field.autoFrom!.isEmpty) continue;
    final String v = resolveAutoFill(field, asset);
    if (v.isEmpty) continue;
    final String existing = current[field.id]?.toString().trim() ?? '';
    if (field.readOnly || existing.isEmpty) patch[field.id] = v;
  }
  return patch;
}

/// Is [value] a LOWER meter reading than [previous]? WARNING ONLY, never a
/// block, and deliberately so: a meter really can be replaced, and the
/// register value being compared against is itself often stale. Returns
/// `false` whenever either side is not a real, non-blank number, because
/// "we have nothing to compare against" is not "the reading is wrong".
///
/// Carried per artifact section 4b/section 11 known gap 5: implemented
/// because it is fully specified and cheap, but no live template is known
/// to use `compareTo` yet, and the WARNING UI this would drive is
/// explicitly out of this phase's scope.
bool meterRegression(Object? value, Object? previous) {
  final double? v = value is num
      ? value.toDouble()
      : (value is String ? double.tryParse(value.trim()) : null);
  final double? p = previous is num
      ? previous.toDouble()
      : (previous is String ? double.tryParse(previous.trim()) : null);
  if (v == null || p == null) return false;
  final String vs = value?.toString().trim() ?? '';
  final String ps = previous?.toString().trim() ?? '';
  if (vs.isEmpty || ps.isEmpty) return false;
  return v < p;
}
