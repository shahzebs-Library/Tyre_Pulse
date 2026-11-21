/// The inventory server objects this feature calls, named once.
///
/// Every name below comes from the shared build contract
/// (`docs/inventory/07_APPROVED_REQUIREMENTS_AND_BUILD_CONTRACT.md`). The DB
/// lane owns the SQL in `supabase/pending_migrations/*inv_*`; at the time this
/// was written NONE of them is applied anywhere but staging, so every caller
/// must degrade honestly: a missing object (`SupabaseFailure.isSchemaMismatch`)
/// renders a "not set up yet" state, never an empty list and never sample
/// data. The parameter shapes the phone sends are recorded in
/// `tyre_pulse_flutter/docs/inventory_reserved_patch.md` section "Server
/// contract the phone expects" so the DB lane can match them.
library;

abstract final class InventoryRpcs {
  /// Counter's blind view. `p_audit_id` null = audits assigned to me.
  static const String auditCounterView = 'inv_audit_counter_view';

  /// Blind, idempotent count submit (client_uuid per line).
  static const String countSubmit = 'inv_count_submit';

  /// Ends counting (status in_progress / recount -> counting_completed).
  /// Same `p_payload {audit_id, idempotency_key}` the web "Finish counting"
  /// action sends (`src/lib/api/inventory.js` completeCounting). Without it
  /// an audit counted on a phone can never reach reconciliation.
  static const String auditCompleteCounting = 'inv_audit_complete_counting';

  static const String transferDispatch = 'inv_transfer_dispatch';
  static const String transferReceive = 'inv_transfer_receive';
}

abstract final class InventoryTables {
  /// Read-only on the phone (writes go through the RPCs).
  static const String stockTransfers = 'stock_transfers';
  static const String stockTransferLines = 'stock_transfer_lines';
}

/// Count photos go to the verified private evidence bucket already used by
/// inspections and handovers (its per-member upload policy is live,
/// `supabase/migrations/20260930120002_storage_photo_write_scope.sql`), under
/// an `inventory_count/<audit>/<line>/` path. No new bucket is invented.
const String inventoryPhotoBucket = 'tyre-photos';
