-- ============================================================================
-- ASCENT — composition-priced holdings (synthetic basket).
-- Some holdings have no public ticker of their own but are a fixed blend of
-- underlying funds — chiefly 529 plan portfolios, whose plan units aren't on any
-- price feed. synthetic_basket stores the holding re-expressed as effective shares
-- of priceable underlyings, e.g. [{"symbol":"VUG","shares":485.58}] or
-- [{"symbol":"VTI","shares":...},{"symbol":"VXUS","shares":...}]. When present, the
-- holding is valued live as Σ shares × quote(symbol) on every refresh — so a 529
-- set up once then tracks its underlyings automatically. Nullable; owner-only via
-- the existing holdings RLS. Idempotent.
-- ============================================================================
alter table public.holdings
  add column if not exists synthetic_basket jsonb;
