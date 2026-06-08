-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V17.sql — Procurement Management
-- purchase_orders table + indexes + RLS + auto PO number generator
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Main table
CREATE TABLE IF NOT EXISTS purchase_orders (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number         VARCHAR(30)   UNIQUE NOT NULL,
  vendor_name       VARCHAR(100)  NOT NULL,
  order_date        DATE          NOT NULL DEFAULT CURRENT_DATE,
  expected_delivery DATE,
  actual_delivery   DATE,
  status            VARCHAR(25)   NOT NULL DEFAULT 'Draft'
    CHECK (status IN (
      'Draft','Submitted','Approved','Ordered',
      'Partial Delivery','Delivered','Cancelled','Closed'
    )),
  priority          VARCHAR(15)   NOT NULL DEFAULT 'Normal'
    CHECK (priority IN ('Urgent','High','Normal','Low')),
  -- Line items: [{brand, size, quantity, unit_price, received_qty}]
  items             JSONB         NOT NULL DEFAULT '[]'::jsonb,
  subtotal          NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  budget_code       VARCHAR(50),
  site              VARCHAR(100),
  country           VARCHAR(50),
  requested_by      VARCHAR(100),
  approved_by       VARCHAR(100),
  notes             TEXT,
  created_by        UUID          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_po_status       ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_vendor        ON purchase_orders(vendor_name);
CREATE INDEX IF NOT EXISTS idx_po_order_date    ON purchase_orders(order_date DESC);
CREATE INDEX IF NOT EXISTS idx_po_site          ON purchase_orders(site);
CREATE INDEX IF NOT EXISTS idx_po_country       ON purchase_orders(country);
CREATE INDEX IF NOT EXISTS idx_po_created_by    ON purchase_orders(created_by);
CREATE INDEX IF NOT EXISTS idx_po_po_number     ON purchase_orders(po_number);

-- 3. updated_at trigger
CREATE OR REPLACE FUNCTION update_purchase_orders_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_po_updated_at ON purchase_orders;
CREATE TRIGGER trg_po_updated_at
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION update_purchase_orders_updated_at();

-- 4. PO number generator: PO-YYYY-00001
CREATE OR REPLACE FUNCTION generate_po_number()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_year  TEXT := to_char(NOW(), 'YYYY');
  v_seq   INT;
  v_po    TEXT;
BEGIN
  SELECT COALESCE(MAX(
    CAST(SPLIT_PART(po_number, '-', 3) AS INT)
  ), 0) + 1
  INTO v_seq
  FROM purchase_orders
  WHERE po_number LIKE 'PO-' || v_year || '-%';

  v_po := 'PO-' || v_year || '-' || LPAD(v_seq::TEXT, 5, '0');
  RETURN v_po;
END;
$$;

-- 5. Row-Level Security
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all POs
DROP POLICY IF EXISTS "po_select_authenticated" ON purchase_orders;
CREATE POLICY "po_select_authenticated"
  ON purchase_orders FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can insert their own POs
DROP POLICY IF EXISTS "po_insert_authenticated" ON purchase_orders;
CREATE POLICY "po_insert_authenticated"
  ON purchase_orders FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by OR created_by IS NULL);

-- Authenticated users can update POs they created; admins can update any
DROP POLICY IF EXISTS "po_update_authenticated" ON purchase_orders;
CREATE POLICY "po_update_authenticated"
  ON purchase_orders FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = created_by
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'Admin'
    )
  );

-- Only admins can delete POs
DROP POLICY IF EXISTS "po_delete_admin" ON purchase_orders;
CREATE POLICY "po_delete_admin"
  ON purchase_orders FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'Admin'
    )
  );

-- 6. Grant RPC execution to authenticated users
GRANT EXECUTE ON FUNCTION generate_po_number() TO authenticated;
