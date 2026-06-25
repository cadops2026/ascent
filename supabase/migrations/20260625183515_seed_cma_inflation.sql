-- ============================================================================
-- ASCENT — P3 seed: consensus CMAs + asset-class universe + default inflation curve.
-- Reference data the projection engines READ (invariants #2/#3 — modules never
-- hardcode returns/inflation; they read these tables). Long-run NOMINAL annual
-- expected returns (decimals), vintage ~2026. cma_sources holds per-house values
-- (median + dispersion); asset_class_universe holds vol/correlation. The default
-- inflation curve lets the projection run with no keys; refresh-inflation
-- overwrites it with live Cleveland-Fed EXPINF data once a FRED key is set.
-- All idempotent (on conflict do nothing / upsert).
-- ============================================================================

-- Asset-class universe: vol + correlation-to-US-equity (single-factor model),
-- cost drag, liquidity, optional gate note. cma_premium = consensus median return.
insert into public.asset_class_universe (class, cma_premium, vol, corr_to_us_equity, cost_proxy, liquidity, gate) values
  ('us_equity',      0.062, 0.16, 1.00, 0.0005, 'high',   null),
  ('intl_equity',    0.075, 0.18, 0.85, 0.0008, 'high',   null),
  ('bonds',          0.048, 0.05, 0.15, 0.0005, 'high',   null),
  ('tips',           0.041, 0.05, 0.10, 0.0005, 'high',   null),
  ('cash',           0.036, 0.01, 0.00, 0.0001, 'high',   null),
  ('real_estate',    0.060, 0.15, 0.60, 0.0050, 'medium', 'home held out of investable (inv #11)'),
  ('commodities',    0.044, 0.17, 0.30, 0.0050, 'medium', null),
  ('private_equity', 0.090, 0.22, 0.75, 0.0200, 'low',    'illiquid; valuations lag'),
  ('collectibles',   0.035, 0.20, 0.25, 0.0100, 'low',    'synthetic estimate, not a house CMA'),
  ('crypto',         0.120, 0.70, 0.40, 0.0050, 'high',   'fat-tailed: Student-t in Monte Carlo (inv #12)')
on conflict (class) do update set
  cma_premium = excluded.cma_premium, vol = excluded.vol,
  corr_to_us_equity = excluded.corr_to_us_equity, cost_proxy = excluded.cost_proxy,
  liquidity = excluded.liquidity, gate = excluded.gate;

-- Per-house CMAs (Vanguard / J.P. Morgan / Invesco / BlackRock / Morgan Stanley).
-- exact=false where the house doesn't actually publish the class (synthetic).
insert into public.cma_sources (asset_class, house, value, exact, asof) values
  ('us_equity','Vanguard',0.055,true,'2026-01-01'),('us_equity','JPM',0.067,true,'2026-01-01'),('us_equity','Invesco',0.062,true,'2026-01-01'),('us_equity','BlackRock',0.066,true,'2026-01-01'),('us_equity','MorganStanley',0.060,true,'2026-01-01'),
  ('intl_equity','Vanguard',0.072,true,'2026-01-01'),('intl_equity','JPM',0.078,true,'2026-01-01'),('intl_equity','Invesco',0.075,true,'2026-01-01'),('intl_equity','BlackRock',0.080,true,'2026-01-01'),('intl_equity','MorganStanley',0.070,true,'2026-01-01'),
  ('bonds','Vanguard',0.046,true,'2026-01-01'),('bonds','JPM',0.050,true,'2026-01-01'),('bonds','Invesco',0.048,true,'2026-01-01'),('bonds','BlackRock',0.049,true,'2026-01-01'),('bonds','MorganStanley',0.047,true,'2026-01-01'),
  ('tips','Vanguard',0.040,true,'2026-01-01'),('tips','JPM',0.043,true,'2026-01-01'),('tips','Invesco',0.041,true,'2026-01-01'),('tips','BlackRock',0.042,true,'2026-01-01'),('tips','MorganStanley',0.040,true,'2026-01-01'),
  ('cash','Vanguard',0.035,true,'2026-01-01'),('cash','JPM',0.038,true,'2026-01-01'),('cash','Invesco',0.036,true,'2026-01-01'),('cash','BlackRock',0.037,true,'2026-01-01'),('cash','MorganStanley',0.035,true,'2026-01-01'),
  ('real_estate','Vanguard',0.058,true,'2026-01-01'),('real_estate','JPM',0.063,true,'2026-01-01'),('real_estate','Invesco',0.060,true,'2026-01-01'),('real_estate','BlackRock',0.062,true,'2026-01-01'),('real_estate','MorganStanley',0.059,true,'2026-01-01'),
  ('commodities','Vanguard',0.040,true,'2026-01-01'),('commodities','JPM',0.048,true,'2026-01-01'),('commodities','Invesco',0.044,true,'2026-01-01'),('commodities','BlackRock',0.046,true,'2026-01-01'),('commodities','MorganStanley',0.042,true,'2026-01-01'),
  ('private_equity','Vanguard',0.085,true,'2026-01-01'),('private_equity','JPM',0.095,true,'2026-01-01'),('private_equity','Invesco',0.090,true,'2026-01-01'),('private_equity','BlackRock',0.092,true,'2026-01-01'),('private_equity','MorganStanley',0.088,true,'2026-01-01'),
  ('collectibles','Invesco',0.035,false,'2026-01-01'),('collectibles','BlackRock',0.038,false,'2026-01-01'),
  ('crypto','Invesco',0.120,false,'2026-01-01'),('crypto','BlackRock',0.130,false,'2026-01-01'),('crypto','MorganStanley',0.080,false,'2026-01-01')
on conflict (asset_class, house, asof) do update set value = excluded.value, exact = excluded.exact;

-- Default expected-inflation curve (~2.4%, mild upward slope), stored as FRACTIONS,
-- source='default'. refresh-inflation writes source='EXPINF' from FRED; the engine
-- prefers EXPINF when present and falls back to this seed.
insert into public.infl_expectations_cache (source, horizon_years, value, asof) values
  ('default',1,0.0225,'2026-01-01'),('default',2,0.0230,'2026-01-01'),('default',3,0.0233,'2026-01-01'),('default',5,0.0238,'2026-01-01'),('default',7,0.0241,'2026-01-01'),('default',10,0.0245,'2026-01-01'),('default',20,0.0250,'2026-01-01'),('default',30,0.0252,'2026-01-01')
on conflict (source, horizon_years, asof) do update set value = excluded.value;
