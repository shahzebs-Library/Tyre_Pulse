/// Object names and the "not provisioned yet" test shared by the mock-screen
/// case repositories.
///
/// These tables are verified against `docs/accident-module/02_DATA_MODEL.sql`
/// (live since V417) and the AUTHORED, NOT YET APPLIED migration
/// `supabase/migrations/20260916130000_accident_mock_field_parity.sql`. The
/// core registry in `lib/core/network/supabase_tables.dart` is a shared file
/// this feature must not edit, so the accident case names live here until the
/// registry is extended. A repository that reads a column or table the
/// migration adds MUST treat [isMissingSchema] as "not provisioned yet" and
/// keep the base fields working.
library;

import 'package:supabase_flutter/supabase_flutter.dart' show PostgrestException;
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';

abstract final class AccidentCaseTables {
  /// One row per accident. Base columns are live; payer, responsible_company,
  /// recovery_required, third_party_*, taqdeer_required and field_audit are
  /// added by the authored migration.
  static const String liabilityAssessments = 'accident_liability_assessments';

  /// One row per authority_type (police | najm | taqdeer). Live.
  static const String authorityReports = 'accident_authority_reports';

  /// Uploaded documents and photos keyed by requirement_key. Live.
  static const String evidence = 'accident_evidence';

  /// M6 checklist rows, unique on (accident_id, item_key). Authored migration.
  static const String fleetValidationItems = 'accident_fleet_validation_items';

  /// Case timeline entries (channel in_app, direction internal). Live.
  static const String communications = 'accident_case_communications';

  /// SLA clocks per workstream. Live.
  static const String slaInstances = 'accident_sla_instances';
}

/// The private bucket every accident document and photo lives in. Matches the
/// queued evidence path in `lib/core/sync/supabase_command_pusher.dart`.
const String accidentEvidenceBucket = 'accident-photos';

const Set<String> _missingSchemaCodes = <String>{
  '42703', // undefined_column
  '42P01', // undefined_table
  '42883', // undefined_function
  'PGRST202',
  'PGRST204',
  'PGRST205',
};

/// True when the server does not carry the column, table or function the
/// client asked for. The caller degrades to an honest "not provisioned yet"
/// state; it never renders the failure as an empty result.
bool isMissingSchema(Object error) {
  if (error is SupabaseFailure) return error.isSchemaMismatch;
  if (error is PostgrestException) {
    final String code = (error.code ?? '').trim().toUpperCase();
    return _missingSchemaCodes.contains(code);
  }
  return false;
}

/// Reads a text column defensively. PostgREST rows are `Map<String, dynamic>`;
/// every value goes through one of these helpers so no widget or repository
/// calls a method on `dynamic`.
String? accidentRowText(Object? value) {
  if (value == null) return null;
  final String text = value.toString().trim();
  return text.isEmpty ? null : text;
}

num? accidentRowNum(Object? value) {
  if (value is num) return value.isFinite ? value : null;
  if (value is String) return num.tryParse(value.trim());
  return null;
}

bool? accidentRowBool(Object? value) {
  if (value is bool) return value;
  if (value is String) {
    final String lower = value.trim().toLowerCase();
    if (lower == 'true' || lower == 't') return true;
    if (lower == 'false' || lower == 'f') return false;
  }
  return null;
}

DateTime? accidentRowDate(Object? value) {
  if (value is DateTime) return value;
  if (value is String) return DateTime.tryParse(value.trim());
  return null;
}

Map<String, Object?> accidentRowMap(Object? value) {
  if (value is Map<Object?, Object?>) {
    return <String, Object?>{
      for (final MapEntry<Object?, Object?> entry in value.entries)
        if (entry.key is String) entry.key! as String: entry.value,
    };
  }
  return const <String, Object?>{};
}
