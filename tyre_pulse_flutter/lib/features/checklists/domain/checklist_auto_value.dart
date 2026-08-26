/// `autoValue` - context prefill (spec section 30, artifact section 4a).
///
/// Mirrors `AUTO_VALUES`/`isAutoField`/`resolveAutoValue` in
/// `fieldTypes.js:53-65` and `checklistFields.ts:33-42` (identical on both
/// stacks).
///
/// This is a COMPLETELY SEPARATE mechanism from `autoFrom` (register
/// prefill, `checklist_auto_fill.dart`) and must not be merged with it: this
/// one is keyed on the signed-in OPERATOR and TODAY'S DATE; that one is
/// keyed on the picked ASSET.
///
/// WHEN IT RESOLVES: once, at template open, and the field then renders
/// read-only. The registry comment says so directly - "prefills ... both
/// render read-only" (`fieldTypes.js:174-175`). [resolveAutoValue] is
/// therefore a PURE "what would this field's value be right now" function;
/// the DECISION of when to call it (once, at open, never on a later resume)
/// belongs to whatever screen consumes this engine, per the draft-engine
/// reasoning quoted in artifact section 4a - out of this phase's scope.
/// Calling it again on a resumed draft and overwriting the stored answer
/// would silently rewrite a record of when the work was actually done.
library;

import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';

/// The two known `autoValue` tokens.
const List<String> kChecklistAutoValues = <String>['current_user', 'today'];

/// Whether [field] is auto-filled. Tests the PROPERTY (`field.autoValue`),
/// NOT the type - `{type: 'user'}` is NOT an auto field just because `user`
/// happens to also be a reference type (E5).
bool isAutoField(ChecklistField? field) =>
    field?.autoValue != null && kChecklistAutoValues.contains(field!.autoValue);

/// The context an auto-filling caller supplies: the signed-in operator's
/// display name, and an optional ISO `today` override (mainly for tests -
/// see the library comment on why a real caller should not need one).
final class ChecklistAutoValueContext {
  const ChecklistAutoValueContext({this.userName, this.today});

  final String? userName;

  /// ISO `YYYY-MM-DD`. When `null`, [resolveAutoValue] uses the current UTC
  /// date, mirroring the source's own `new Date().toISOString().slice(0,10)`
  /// - `toISOString()` is always UTC, so "today" here is the UTC calendar
  /// date, not the device's local one.
  final String? today;
}

String _todayIso() {
  final DateTime now = DateTime.now().toUtc();
  final String y = now.year.toString().padLeft(4, '0');
  final String m = now.month.toString().padLeft(2, '0');
  final String d = now.day.toString().padLeft(2, '0');
  return '$y-$m-$d';
}

/// The value [field] should carry, from [ctx]. `''` when [field] is not
/// auto (E4).
String resolveAutoValue(
  ChecklistField? field, [
  ChecklistAutoValueContext ctx = const ChecklistAutoValueContext(),
]) {
  if (field?.autoValue == 'current_user') return ctx.userName ?? '';
  if (field?.autoValue == 'today') return ctx.today ?? _todayIso();
  return '';
}
