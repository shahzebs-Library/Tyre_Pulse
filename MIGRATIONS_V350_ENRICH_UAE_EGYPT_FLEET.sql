-- V350 — Enrich the DERIVED UAE/Egypt vehicle_fleet rows (created in V348) with make/model.
--
-- Context: V348 derived a fleet register for UAE + Egypt from the DISTINCT asset numbers
-- already present in their tyres + work_orders. Those rows carry asset_no + country +
-- vehicle_type + site but make/model are NULL (thin). The ERP's parts_consumption table
-- already carries a human asset_description per asset (e.g. "TRANSIT MIXER", "GENERATOR SANY",
-- "TRUCK MIXER MERCEDES, MP4 4441, 2017"). We use it to fill the gaps.
--
-- Mapping:
--   * model  = the most-common (mode) non-blank parts_consumption.asset_description for that
--              (country, asset_code = vehicle_fleet.asset_no). This is the real ERP descriptor.
--   * make   = a recognized vehicle/equipment brand token found in that description, but ONLY
--              when exactly ONE distinct brand is present (unambiguous). Otherwise make stays NULL
--              (we never fabricate a make when the description has no clear brand or has several).
--
-- Non-destructive & idempotent:
--   * COALESCE keeps any existing non-blank make/model — an existing value is never overwritten.
--   * Scoped strictly to country IN ('UAE','Egypt') — KSA is never touched.
--   * asset_no / country / vehicle_type / site are never modified.
--   * Safe to re-run: it converges to the same result.

WITH desc_mode AS (
  SELECT pc.country,
         upper(btrim(pc.asset_code))                    AS ac,
         btrim(pc.asset_description)                     AS descr,
         row_number() OVER (
           PARTITION BY pc.country, upper(btrim(pc.asset_code))
           ORDER BY count(*) DESC, btrim(pc.asset_description)
         )                                               AS rn
  FROM public.parts_consumption pc
  WHERE pc.country IN ('UAE','Egypt')
    AND pc.asset_description IS NOT NULL
    AND btrim(pc.asset_description) <> ''
  GROUP BY pc.country, upper(btrim(pc.asset_code)), btrim(pc.asset_description)
),
brands(canon, pat) AS (VALUES
  ('Mercedes','MERCEDES'), ('Sany','SANY'), ('CIFA','CIFA'), ('Caterpillar','CATERPILLAR'),
  ('Caterpillar','\mCAT\M'), ('Nissan','NISSAN'), ('Hyundai','HYUNDAI'), ('Putzmeister','PUTZMEISTER'),
  ('Truemax','TRUE ?MAX'), ('Volvo','VOLVO'), ('Scania','SCANIA'), ('Toyota','TOYOTA'), ('Isuzu','ISUZU'),
  ('Mitsubishi','MITSUBISHI'), ('Betonstar','BETON ?STAR'), ('Schwing','SCHWING'), ('MAN','\mMAN\M')
),
derived AS (
  SELECT dm.country,
         dm.ac,
         dm.descr AS model_val,
         CASE WHEN (SELECT count(DISTINCT b.canon) FROM brands b WHERE upper(dm.descr) ~ b.pat) = 1
              THEN (SELECT min(b.canon)            FROM brands b WHERE upper(dm.descr) ~ b.pat)
              ELSE NULL
         END AS make_val
  FROM desc_mode dm
  WHERE dm.rn = 1
)
UPDATE public.vehicle_fleet vf
SET model = COALESCE(NULLIF(btrim(vf.model), ''), d.model_val),
    make  = COALESCE(NULLIF(btrim(vf.make),  ''), d.make_val)
FROM derived d
WHERE vf.country IN ('UAE','Egypt')
  AND d.country = vf.country
  AND d.ac      = upper(btrim(vf.asset_no))
  AND (
        ((vf.model IS NULL OR btrim(vf.model) = '') AND d.model_val IS NOT NULL)
     OR ((vf.make  IS NULL OR btrim(vf.make)  = '') AND d.make_val  IS NOT NULL)
      );

-- ---------------------------------------------------------------------------
-- REVERSIBLE (rollback): all UAE/Egypt fleet rows had make/model = NULL before V350,
-- so reverting simply clears them again for those two countries. Run to undo:
--
-- UPDATE public.vehicle_fleet
-- SET model = NULL, make = NULL
-- WHERE country IN ('UAE','Egypt');
-- ---------------------------------------------------------------------------
