-- ============================================================================
-- ASCENT — user macro overrides on the profile.
-- The projection spine reads REAL per-class CMA returns (post-inflation) and a
-- horizon-matched expected-inflation curve. These two optional, user-owned knobs
-- let the investor override the macro inputs from Settings:
--   inflation_override   — flat expected inflation (fraction). When set, replaces
--                          the EXPINF/seeded curve for the projection. Null = use
--                          the live curve.
--   real_growth_override — a single blended REAL portfolio return (fraction). When
--                          set, the per-class CMA means are re-centered so the
--                          portfolio's weighted real return equals this (vol /
--                          correlation / dispersion preserved). Null = use the
--                          per-class consensus CMA.
-- Both nullable; profiles is owner-only (RLS auth.uid() = user_id), so these are
-- per-user. Idempotent.
-- ============================================================================
alter table public.profiles
  add column if not exists inflation_override   numeric,
  add column if not exists real_growth_override numeric;
