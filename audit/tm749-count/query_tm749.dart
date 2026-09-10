import 'package:sqlite3/sqlite3.dart';

void main() {
  final Database db = sqlite3.open(
    'audit/tm749-count/tyre_pulse_audit.sqlite',
    mode: OpenMode.readOnly,
  );
  try {
    final ResultSet drafts = db.select('''
      SELECT draft_key, asset_no, vehicle_type, filled, total,
             created_at, updated_at
      FROM inspection_drafts
      WHERE upper(trim(asset_no)) = 'TM749'
      ORDER BY updated_at DESC
    ''');
    print('drafts=${drafts.length}');
    for (final Row draft in drafts) {
      print('draft=${draft.values}');
      final ResultSet positions = db.select('''
        SELECT position, condition, pressure_psi, tread_depth_mm,
               serial_no, checked, updated_at
        FROM inspection_draft_positions
        WHERE draft_key = ?
        ORDER BY position
      ''', <Object?>[draft['draft_key']]);
      print('positions=${positions.length}');
      for (final Row position in positions) {
        print('position=${position.values}');
      }
      final ResultSet photos = db.select('''
        SELECT field_key, local_path, captured_at
        FROM draft_photos
        WHERE owner_kind = 'inspection_draft' AND owner_key = ?
        ORDER BY captured_at
      ''', <Object?>[draft['draft_key']]);
      print('photos=${photos.length}');
      final ResultSet signatures = db.select('''
        SELECT field_key, signed_at
        FROM captured_signatures
        WHERE owner_kind = 'inspection_draft' AND owner_key = ?
        ORDER BY signed_at
      ''', <Object?>[draft['draft_key']]);
      print('signatures=${signatures.length}');
    }
  } finally {
    db.dispose();
  }
}
