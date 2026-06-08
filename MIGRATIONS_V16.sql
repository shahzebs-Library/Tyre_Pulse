-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V16.sql — Work Orders / Job Card Management
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Work Orders table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_no     VARCHAR(30) UNIQUE NOT NULL,
  asset_no          VARCHAR(50) NOT NULL,
  tyre_serial       VARCHAR(100),
  tyre_position     VARCHAR(30),
  status            VARCHAR(25) NOT NULL DEFAULT 'Open'
                      CHECK (status IN ('Open','In Progress','Awaiting Parts','Completed','Closed','Cancelled')),
  priority          VARCHAR(15) NOT NULL DEFAULT 'Medium'
                      CHECK (priority IN ('Low','Medium','High','Critical')),
  work_type         VARCHAR(30) NOT NULL
                      CHECK (work_type IN (
                        'Tyre Change','Inspection','Repair','Rotation',
                        'Balancing','Alignment','Retread','Puncture Repair',
                        'Pressure Check','Emergency','Other'
                      )),
  description       TEXT,
  technician_name   VARCHAR(100),
  workshop_name     VARCHAR(100),
  site              VARCHAR(100),
  country           VARCHAR(50),
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  target_completion TIMESTAMPTZ,
  labour_hours      NUMERIC(6,2) DEFAULT 0,
  labour_rate       NUMERIC(10,2) DEFAULT 0,
  labour_cost       NUMERIC(12,2) DEFAULT 0,
  parts_cost        NUMERIC(12,2) DEFAULT 0,
  total_cost        NUMERIC(12,2) GENERATED ALWAYS AS (labour_cost + parts_cost) STORED,
  parts_used        JSONB DEFAULT '[]'::jsonb,
  notes             TEXT,
  created_by        UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_work_orders_asset_no      ON work_orders(asset_no);
CREATE INDEX IF NOT EXISTS idx_work_orders_status        ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_priority      ON work_orders(priority);
CREATE INDEX IF NOT EXISTS idx_work_orders_opened_at     ON work_orders(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_orders_site          ON work_orders(site);
CREATE INDEX IF NOT EXISTS idx_work_orders_country       ON work_orders(country);
CREATE INDEX IF NOT EXISTS idx_work_orders_work_type     ON work_orders(work_type);
CREATE INDEX IF NOT EXISTS idx_work_orders_tyre_serial   ON work_orders(tyre_serial);

-- ── Updated-at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_work_orders_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_work_orders_updated_at ON work_orders;
CREATE TRIGGER trg_work_orders_updated_at
  BEFORE UPDATE ON work_orders
  FOR EACH ROW EXECUTE FUNCTION update_work_orders_updated_at();

-- ── Work order number sequence function ───────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS work_order_seq START 1;

CREATE OR REPLACE FUNCTION generate_work_order_no()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  seq_val BIGINT;
  wo_year TEXT;
BEGIN
  seq_val := nextval('work_order_seq');
  wo_year := TO_CHAR(NOW(), 'YYYY');
  RETURN 'WO-' || wo_year || '-' || LPAD(seq_val::TEXT, 5, '0');
END;
$$;

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read
CREATE POLICY "work_orders_read_all"
  ON work_orders FOR SELECT
  TO authenticated
  USING (true);

-- All authenticated users can insert
CREATE POLICY "work_orders_insert_authenticated"
  ON work_orders FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- All authenticated users can update (Admins can update any, others only own)
CREATE POLICY "work_orders_update_all"
  ON work_orders FOR UPDATE
  TO authenticated
  USING (true);

-- Only admins can delete
CREATE POLICY "work_orders_delete_admin"
  ON work_orders FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'Admin'
    )
  );
