-- V352: UAE tyre-brand auto-derive (single-brand assets only)
-- Reduce the UAE tyre-brand gap (1007 blank tyre_records) by auto-deriving brand ONLY where
-- it is unambiguous: for a UAE asset whose parts_consumption tyre lines (cost_category='tyre')
-- carry EXACTLY ONE distinct non-blank brand, set that brand on that asset's blank-brand
-- tyre_records. Non-fabricating: ambiguous (multi-brand) or no-grid-brand assets are LEFT BLANK.
--
-- Scope: UAE only. Never overwrites an existing brand. Never touches KSA/Egypt.
-- Idempotent (only fills blank brand; re-running changes nothing once filled).
-- parts_consumption.brand was extracted by V335/V341 (blank on many lines) -- only lines
-- carrying a brand participate. The stg_tyre_brand pipe still backfills from an explicit
-- customer CSV; this is the automatic single-brand subset only, so the remaining UAE blanks
-- (multi-brand / no-grid-brand assets) still await that CSV.

WITH single_brand_asset AS (
  SELECT asset_code, min(brand) AS brand
  FROM public.parts_consumption
  WHERE country = 'UAE'
    AND cost_category = 'tyre'
    AND nullif(btrim(brand), '') IS NOT NULL
  GROUP BY asset_code
  HAVING count(DISTINCT brand) = 1
)
UPDATE public.tyre_records t
SET brand = sba.brand
FROM single_brand_asset sba
WHERE t.country = 'UAE'
  AND (t.brand IS NULL OR btrim(t.brand) = '')
  AND upper(btrim(t.asset_no)) = upper(btrim(sba.asset_code));

-- ---------------------------------------------------------------------------
-- REVERSIBLE FOOTER (best-effort, LOSSY): to undo, clear brand for UAE rows whose
-- brand now equals the single-brand-asset value. This may also clear rows that were
-- legitimately backfilled from the CSV with the same brand -- it cannot distinguish
-- source. Run only if a full rollback of this derivation is required.
--
-- WITH single_brand_asset AS (
--   SELECT asset_code, min(brand) AS brand
--   FROM public.parts_consumption
--   WHERE country = 'UAE' AND cost_category = 'tyre'
--     AND nullif(btrim(brand), '') IS NOT NULL
--   GROUP BY asset_code HAVING count(DISTINCT brand) = 1
-- )
-- UPDATE public.tyre_records t
-- SET brand = NULL
-- FROM single_brand_asset sba
-- WHERE t.country = 'UAE'
--   AND upper(btrim(t.asset_no)) = upper(btrim(sba.asset_code))
--   AND btrim(t.brand) = btrim(sba.brand);
