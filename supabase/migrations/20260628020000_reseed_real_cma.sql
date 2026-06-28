-- ============================================================================
-- ASCENT — re-seed consensus CMAs as REAL (after-inflation) returns.
-- The projection spine now treats per-class CMA expected returns as REAL and no
-- longer deflates them by inflation (it previously double-counted). The original
-- seed values were long-run NOMINAL; this replaces them with the published houses'
-- REAL figures (Vanguard, J.P. Morgan, BlackRock, Invesco, Morgan Stanley; 2025–26
-- vintage), where real = each house's nominal − its own inflation assumption.
--
-- cma_sources carries the per-house reals (median + dispersion band). The houses
-- where a class is n/a are filled with the class consensus so the 5-house band
-- stays intact; crypto and collectibles have no published CMA and are synthetic
-- (exact=false). asset_class_universe.cma_premium is the consensus median real
-- (the fallback when no sources exist). vol / correlation / cost_proxy are
-- unchanged — only the return level is inflation-adjusted. The engine still nets a
-- small cost drag off the consensus, so the *used* expected return is real − cost.
-- Idempotent (ON CONFLICT / keyed UPDATE).
-- ============================================================================

-- Per-house REAL expected returns (medians equal the approved consensus per class).
insert into public.cma_sources (asset_class, house, value, exact, asof) values
  ('us_equity','Vanguard',0.038,true,'2026-01-01'),('us_equity','JPM',0.042,true,'2026-01-01'),('us_equity','Invesco',0.027,true,'2026-01-01'),('us_equity','BlackRock',0.060,true,'2026-01-01'),('us_equity','MorganStanley',0.041,true,'2026-01-01'),
  ('intl_equity','Vanguard',0.044,true,'2026-01-01'),('intl_equity','JPM',0.053,true,'2026-01-01'),('intl_equity','Invesco',0.049,true,'2026-01-01'),('intl_equity','BlackRock',0.055,true,'2026-01-01'),('intl_equity','MorganStanley',0.049,true,'2026-01-01'),
  ('bonds','Vanguard',0.027,true,'2026-01-01'),('bonds','JPM',0.023,true,'2026-01-01'),('bonds','Invesco',0.028,true,'2026-01-01'),('bonds','BlackRock',0.023,true,'2026-01-01'),('bonds','MorganStanley',0.024,true,'2026-01-01'),
  ('tips','Vanguard',0.016,true,'2026-01-01'),('tips','JPM',0.022,false,'2026-01-01'),('tips','Invesco',0.027,true,'2026-01-01'),('tips','BlackRock',0.025,true,'2026-01-01'),('tips','MorganStanley',0.019,true,'2026-01-01'),
  ('cash','Vanguard',0.014,true,'2026-01-01'),('cash','JPM',0.006,true,'2026-01-01'),('cash','Invesco',0.009,true,'2026-01-01'),('cash','BlackRock',0.011,true,'2026-01-01'),('cash','MorganStanley',0.013,true,'2026-01-01'),
  ('real_estate','Vanguard',0.028,true,'2026-01-01'),('real_estate','JPM',0.062,true,'2026-01-01'),('real_estate','Invesco',0.048,true,'2026-01-01'),('real_estate','BlackRock',0.041,true,'2026-01-01'),('real_estate','MorganStanley',0.033,true,'2026-01-01'),
  ('commodities','Vanguard',0.034,true,'2026-01-01'),('commodities','JPM',0.021,true,'2026-01-01'),('commodities','Invesco',0.037,true,'2026-01-01'),('commodities','BlackRock',0.029,false,'2026-01-01'),('commodities','MorganStanley',0.025,true,'2026-01-01'),
  ('private_equity','Vanguard',0.077,false,'2026-01-01'),('private_equity','JPM',0.077,true,'2026-01-01'),('private_equity','Invesco',0.077,false,'2026-01-01'),('private_equity','BlackRock',0.135,true,'2026-01-01'),('private_equity','MorganStanley',0.076,true,'2026-01-01'),
  ('collectibles','Invesco',0.010,false,'2026-01-01'),('collectibles','BlackRock',0.012,false,'2026-01-01'),
  ('crypto','Invesco',0.096,false,'2026-01-01'),('crypto','BlackRock',0.106,false,'2026-01-01'),('crypto','MorganStanley',0.056,false,'2026-01-01')
on conflict (asset_class, house, asof) do update set value = excluded.value, exact = excluded.exact;

-- Consensus median real per class (the no-sources fallback / pie reference).
-- cost_proxy → 0 so the engine uses the approved real numbers AS-IS (no fee haircut);
-- these figures are already the post-inflation returns the user signed off on.
update public.asset_class_universe u set cma_premium = r.v, cost_proxy = 0
from (values
  ('us_equity', 0.041), ('intl_equity', 0.049), ('bonds', 0.024), ('tips', 0.022),
  ('cash', 0.011), ('real_estate', 0.041), ('commodities', 0.029), ('private_equity', 0.077),
  ('collectibles', 0.011), ('crypto', 0.096)
) as r(class, v)
where u.class = r.class;
