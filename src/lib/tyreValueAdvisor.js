// Tyre Value Advisor - procurement lifecycle-CPK decision engine.
//
// Engineering truth encoded here: the best tyre to BUY is NOT the cheapest
// sticker price, it is the lowest lifecycle cost-per-km (CPK). Lifecycle CPK
// folds in expected life, retread yield, retread cost, casing residual value
// and warranty cover, and it is cross-checked against the fleet's realized
// (historically achieved) CPK per brand so the recommendation is grounded in
// real performance rather than a supplier's optimistic spec sheet.
//
// Pure, deterministic, ASCII-only. No React, no network, no app imports.

export const LIFECYCLE_DEFAULTS = { targetKm: 150000, retreadYield: 0.9 };

// ---- helpers ---------------------------------------------------------------

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function safeDiv(a, b) {
  if (a === null || b === null) return null;
  if (!(b > 0)) return null;
  return a / b;
}

function round(v, dp) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
}

// ---- single-option economics ----------------------------------------------

export function optionEconomics(opt, { realizedByBrand = {}, targetKm = 150000 } = {}) {
  const o = opt || {};
  const retreadYield = LIFECYCLE_DEFAULTS.retreadYield;

  const unitPrice = num(o.unit_price);
  const expectedLifeKm = num(o.expected_life_km);
  const warrantyKm = num(o.warranty_km);
  const casingValue = num(o.casing_value) || 0;
  const retreadCostPct = o.retread_cost_pct === null || o.retread_cost_pct === undefined
    ? 0.4
    : num(o.retread_cost_pct);

  const valid = !!(unitPrice !== null && unitPrice > 0 && expectedLifeKm !== null && expectedLifeKm > 0);

  // New (single-life) CPK from sticker price only.
  const newCpk = safeDiv(unitPrice, expectedLifeKm);

  // Retread economics.
  const retreads = o.retreadable ? Math.max(0, (num(o.retread_count) || 0) | 0) : 0;
  const lifecycleKm = expectedLifeKm !== null
    ? expectedLifeKm * (1 + retreads * retreadYield)
    : null;

  const retreadUnitCost = unitPrice !== null
    ? unitPrice * (retreadCostPct === null ? 0.4 : retreadCostPct)
    : null;

  let lifecycleCost = null;
  if (unitPrice !== null) {
    lifecycleCost = unitPrice + retreads * (retreadUnitCost || 0) - (casingValue || 0);
    if (lifecycleCost < 0) lifecycleCost = 0; // casing residual cannot make a tyre free
  }

  const lifecycleCpk = safeDiv(lifecycleCost, lifecycleKm);
  const costPer1000Km = lifecycleCpk != null ? lifecycleCpk * 1000 : null;

  const warrantyCoverPct = warrantyKm && expectedLifeKm
    ? (warrantyKm / expectedLifeKm) * 100
    : null;

  // Realized-fleet grounding.
  let realizedCpk = null;
  let realizedLifeKm = null;
  let realizedCount = null;
  let variancePct = null;
  let confidence = 'guidance';

  const brandKey = o.brand !== null && o.brand !== undefined ? String(o.brand).toLowerCase() : null;
  const realized = brandKey ? realizedByBrand[brandKey] : null;
  if (realized) {
    realizedCpk = num(realized.avgCpk);
    realizedLifeKm = num(realized.avgLifeKm);
    realizedCount = num(realized.count);
    variancePct = newCpk && realizedCpk ? ((newCpk - realizedCpk) / realizedCpk) * 100 : null;
    confidence = realizedCount !== null && realizedCount >= 3 ? 'high' : 'moderate';
  }

  return {
    ...o,
    newCpk: round(newCpk, 4),
    retreads,
    lifecycleKm: round(lifecycleKm, 0),
    lifecycleCost: round(lifecycleCost, 2),
    lifecycleCpk: round(lifecycleCpk, 4),
    costPer1000Km: round(costPer1000Km, 2),
    warrantyCoverPct: round(warrantyCoverPct, 1),
    realizedCpk: round(realizedCpk, 4),
    realizedLifeKm: round(realizedLifeKm, 0),
    realizedCount,
    variancePct: round(variancePct, 1),
    confidence,
    valid,
  };
}

// ---- ranking ---------------------------------------------------------------

export function rankOptions(options, { realizedByBrand = {}, targetKm = 150000 } = {}) {
  const list = Array.isArray(options) ? options : [];
  const econ = list.map((o) => optionEconomics(o, { realizedByBrand, targetKm }));

  const valids = econ.filter((e) => e.valid && e.lifecycleCpk != null);
  const invalids = econ.filter((e) => !(e.valid && e.lifecycleCpk != null));

  // Sort valid ascending by lifecycle CPK (cheapest per km first).
  valids.sort((a, b) => a.lifecycleCpk - b.lifecycleCpk);

  // Clear any stale flags then default all to false.
  econ.forEach((e) => {
    e.bestValue = false;
    e.lowestCpk = false;
    e.bestDeal = false;
    e.longestLife = false;
    e.budget = false;
    e.premium = false;
  });

  const currency = (list.find((o) => o && o.currency)?.currency) || 'SAR';

  if (valids.length) {
    // lowestCpk: single lowest lifecycle CPK overall.
    valids[0].lowestCpk = true;

    // bestValue: lowest lifecycle CPK among options that clear a life gate,
    // so a cheap short-life tyre cannot be crowned best value.
    const maxLife = Math.max(...valids.map((e) => num(e.expected_life_km) || 0));
    const lifeGate = 0.6 * maxLife;
    const gated = valids.filter((e) => (num(e.expected_life_km) || 0) >= lifeGate);
    // valids already sorted by lifecycleCpk ascending; gated preserves order.
    if (gated.length) gated[0].bestValue = true;

    // bestDeal: cheapest sticker price among options that are still
    // competitive on value (within 15% of best lifecycle CPK) and not
    // warranty-starved.
    const bestCpk = valids[0].lifecycleCpk;
    const competitive = valids.filter((e) => {
      const cpkOk = e.lifecycleCpk <= 1.15 * bestCpk;
      const warrOk = e.warrantyCoverPct == null || e.warrantyCoverPct >= 25;
      return cpkOk && warrOk;
    });
    if (competitive.length) {
      let deal = competitive[0];
      for (const e of competitive) {
        const p = num(e.unit_price);
        const dp = num(deal.unit_price);
        if (p != null && (dp == null || p < dp)) deal = e;
      }
      deal.bestDeal = true;
    }

    // longestLife: max lifecycle km.
    let longest = valids[0];
    for (const e of valids) {
      if ((e.lifecycleKm || 0) > (longest.lifecycleKm || 0)) longest = e;
    }
    longest.longestLife = true;

    // budget / premium by sticker price overall.
    let budget = valids[0];
    let premium = valids[0];
    for (const e of valids) {
      const p = num(e.unit_price);
      if (p != null) {
        if (num(budget.unit_price) == null || p < num(budget.unit_price)) budget = e;
        if (num(premium.unit_price) == null || p > num(premium.unit_price)) premium = e;
      }
    }
    budget.budget = true;
    premium.premium = true;
  }

  const best = valids.find((e) => e.bestValue) || null;
  const runnerUp = valids.length > 1 ? valids[1] : null;

  return {
    ranked: [...valids, ...invalids],
    best,
    runnerUp,
    count: valids.length,
    currency,
  };
}

// ---- recommendation --------------------------------------------------------

function label(e) {
  const parts = [];
  if (e.brand) parts.push(String(e.brand));
  if (e.size) parts.push(String(e.size));
  const s = parts.join(' ').trim();
  return s || (e.id != null ? `Option ${e.id}` : 'this option');
}

export function recommend(options, { realizedByBrand = {}, targetKm = 150000 } = {}) {
  const { ranked, best, runnerUp, count, currency } = rankOptions(options, { realizedByBrand, targetKm });
  const hasEnoughData = count >= 2;

  if (!best || !hasEnoughData) {
    return {
      pick: null,
      runnerUp: null,
      ranked,
      currency,
      hasEnoughData: false,
      headline: 'Not enough data to recommend a tyre: add at least two quotes with a unit price and an expected life in km.',
      rationale: [
        'A lifecycle cost-per-km comparison needs at least two valid options, each with a positive unit price and expected life km.',
        count === 1
          ? 'Only one valid quote was supplied, so there is nothing to compare it against.'
          : 'No option supplied both a usable unit price and an expected life km.',
        'Add competing quotes (brand, unit price, expected life km, retread and warranty terms) to unlock the value ranking.',
      ],
      savingsVsPremiumPct: null,
      savingsVsBudgetNote: 'Add more quotes to compute savings.',
    };
  }

  const valids = ranked.filter((e) => e.valid && e.lifecycleCpk != null);

  // Savings vs the worst-value (highest lifecycle CPK) valid option.
  const worst = valids.reduce((w, e) => (e.lifecycleCpk > w.lifecycleCpk ? e : w), valids[0]);
  const savingsVsPremiumPct = worst && worst.lifecycleCpk > 0 && worst !== best
    ? round(((worst.lifecycleCpk - best.lifecycleCpk) / worst.lifecycleCpk) * 100, 0)
    : 0;

  const cpk = round(best.lifecycleCpk, 3);
  let headline = `${label(best)} gives the lowest lifecycle CPK at ${cpk} ${currency}/km`;
  if (savingsVsPremiumPct && savingsVsPremiumPct > 0) {
    headline += `, ${savingsVsPremiumPct}% below the most expensive option`;
  }
  headline += '.';

  const rationale = [];

  // 1. Lifecycle CPK vs sticker price.
  if (best.newCpk != null && best.lifecycleCpk != null) {
    if (best.retreads > 0) {
      rationale.push(
        `First-life CPK is ${round(best.newCpk, 3)} ${currency}/km, but ${best.retreads} retread(s) at ${round((best.retread_cost_pct ?? 0.4) * 100, 0)}% of new cost stretch it to a lifecycle CPK of ${cpk} ${currency}/km over ${best.lifecycleKm} km.`
      );
    } else {
      rationale.push(
        `Lifecycle CPK is ${cpk} ${currency}/km over ${best.lifecycleKm} km of expected service; this option is not retreaded in the plan, so first-life and lifecycle CPK are close.`
      );
    }
  }

  // 2. Retread / casing economics.
  const casing = num(best.casing_value) || 0;
  if (casing > 0) {
    rationale.push(
      `Casing residual value of ${round(casing, 0)} ${currency} is credited back, cutting net lifecycle cost to ${best.lifecycleCost} ${currency}.`
    );
  } else if (best.retreadable) {
    rationale.push(
      'This casing is retreadable, so more of the purchase price is recovered across multiple lives instead of being scrapped at first pull.'
    );
  } else {
    rationale.push(
      'This option is treated as single-life (no retread or casing credit), so its low CPK comes from raw tread mileage, not recovery.'
    );
  }

  // 3. Warranty cover.
  if (best.warrantyCoverPct != null) {
    rationale.push(
      `Warranty covers ${best.warrantyCoverPct}% of expected life, protecting against early removals and adding downside cover to the deal.`
    );
  } else {
    rationale.push('No warranty km was supplied, so warranty cover is treated as unknown rather than assumed.');
  }

  // 4. Realized-fleet grounding vs guidance.
  if (best.realizedCpk != null) {
    const gLabel = best.confidence === 'high' ? 'high confidence' : 'moderate confidence';
    if (best.variancePct != null) {
      const dir = best.variancePct < 0 ? `${Math.abs(best.variancePct)}% below` : `${best.variancePct}% above`;
      rationale.push(
        `Grounded on ${best.realizedCount} realized fleet result(s) (${gLabel}): this quote's first-life CPK is ${dir} the brand's historically achieved ${best.realizedCpk} ${currency}/km.`
      );
    } else {
      rationale.push(
        `Grounded on ${best.realizedCount} realized fleet result(s) (${gLabel}) for this brand at ${best.realizedCpk} ${currency}/km.`
      );
    }
  } else {
    rationale.push(
      'No realized fleet history exists for this brand yet, so this ranking is spec-sheet guidance: confirm expected life against the first batch in service.'
    );
  }

  // 5. Call out a cheaper sticker that loses on CPK.
  const cheaperSticker = valids
    .filter((e) => e !== best && num(e.unit_price) != null && num(best.unit_price) != null && num(e.unit_price) < num(best.unit_price));
  if (cheaperSticker.length) {
    const c = cheaperSticker.reduce((lo, e) => (num(e.unit_price) < num(lo.unit_price) ? e : lo), cheaperSticker[0]);
    if (c.lifecycleCpk != null && best.lifecycleCpk != null && c.lifecycleCpk > best.lifecycleCpk) {
      const pctWorse = round(((c.lifecycleCpk - best.lifecycleCpk) / best.lifecycleCpk) * 100, 0);
      rationale.push(
        `${label(c)} is cheaper to buy at ${num(c.unit_price)} ${currency} vs ${num(best.unit_price)} ${currency}, but its shorter life makes it ${pctWorse}% more expensive per km, so it is a false economy.`
      );
    }
  }

  const budgetOpt = valids.find((e) => e.budget);
  const savingsVsBudgetNote = budgetOpt && budgetOpt !== best
    ? `Cheapest sticker is ${label(budgetOpt)} at ${num(budgetOpt.unit_price)} ${currency}, but the pick wins on cost per km.`
    : 'The pick is also the lowest sticker price in this set.';

  return {
    pick: best,
    runnerUp: runnerUp || null,
    ranked,
    currency,
    hasEnoughData: true,
    headline,
    rationale,
    savingsVsPremiumPct,
    savingsVsBudgetNote,
  };
}
