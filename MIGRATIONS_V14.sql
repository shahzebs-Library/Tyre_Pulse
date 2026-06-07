-- Seed knowledge documents (SOPs, policies, manuals) — safe to re-run
INSERT INTO knowledge_documents (title, content, doc_type, tags) VALUES

('Tyre Pressure Inspection SOP',
'Standard Operating Procedure: Tyre Pressure Inspection. All tyres must be checked at cold temperature (vehicle parked 3+ hours). Recommended pressure range: steer axle 110-120 PSI, drive axle 100-110 PSI, trailer axle 95-105 PSI. Record reading in inspection system. Flag any tyre outside ±10 PSI of spec as non-compliant. Under-inflated tyres generate heat buildup leading to premature failure, sidewall damage, and reduced fuel efficiency. Over-inflated tyres reduce contact patch, increase centre wear, and risk blowout on impact.',
'SOP', ARRAY['pressure','inspection','compliance']),

('Tyre Rotation Schedule SOP',
'Standard Operating Procedure: Tyre Rotation. Rotate all tyres every 10,000 km or at each scheduled service. Steer tyres wear faster due to steering forces — move to drive position when tread depth reaches 6mm. Never fit retreaded tyres on steer axle positions. Document all rotations in the fleet management system with odometer reading. Failure to rotate results in premature steer tyre removal, increased CPK, and alignment-related wear patterns.',
'SOP', ARRAY['rotation','maintenance','CPK']),

('Tyre Scrap and Removal Policy',
'Policy: Tyre Removal and Scrap Classification. Remove any tyre with tread depth below 3mm (legal minimum 1.6mm, fleet safety minimum 3mm). Classify removal reason accurately: worn, puncture, impact damage, sidewall damage, bead failure, pressure failure, alignment wear, rotation non-compliance. Inaccurate removal classification prevents root cause analysis and increases avoidable costs. Scrap tyres must be photographed before disposal.',
'Policy', ARRAY['scrap','removal','classification']),

('CPK Benchmarks and Targets',
'Cost Per Kilometre (CPK) Benchmarks. Fleet CPK target: below 1.50 currency/km. Brand-specific targets: premium brands should achieve CPK < 1.20, mid-range brands < 1.60, budget brands < 2.00. CPK above 2.50 indicates systemic issues requiring investigation. CPK is calculated as: cost_per_tyre / (km_at_removal - km_at_fitment). Validate km readings for accuracy before CPK computation. Outlier CPK values (>5.0) likely indicate data entry errors.',
'Manual', ARRAY['CPK','benchmarks','KPI']),

('Fleet Inspection Frequency Policy',
'Policy: Inspection Frequency Requirements. All vehicles require minimum weekly tyre inspection. High-utilisation vehicles (>500 km/day) require bi-weekly inspection. Critical routes (mountain, gravel, high load) require pre-trip inspection. Inspection must include: visual tyre condition, tread depth measurement (monthly minimum), pressure check (weekly), sidewall and bead inspection. Overdue inspections trigger automatic alert after 10 days. Sites with compliance below 85% receive management escalation.',
'Policy', ARRAY['inspection','frequency','compliance']),

('Root Cause Analysis Guide',
'Guide: Tyre Failure Root Cause Analysis. Common root causes and indicators: (1) Under-inflation: irregular wear on shoulder edges, heat damage, sidewall cracking. (2) Over-inflation: centre wear pattern, impact susceptibility. (3) Alignment: one-sided wear, feathering, rapid steer wear. (4) Driver behavior: flat spots from hard braking, impact damage from kerb strikes. (5) Overloading: rapid wear across full tread, sidewall bulging. (6) Road conditions: cuts, punctures, impact damage. Always verify pressure history before concluding alignment or wear causes.',
'Manual', ARRAY['root-cause','failure','analysis']),

('Retread Tyre Usage Policy',
'Policy: Retread Tyre Usage. Retreads are approved for drive and trailer axle positions only. Never fit retreads on steer axles. Retreads must be from approved suppliers with quality certification. Expected CPK for retreads should be 15-30% better than new tyres of equivalent specification. Retread life typically 60-80% of new tyre life. Inspect casing condition before approving for retread — reject any casing with impact damage, sidewall repair, or bead damage.',
'Policy', ARRAY['retread','procurement','policy'])

ON CONFLICT DO NOTHING;
