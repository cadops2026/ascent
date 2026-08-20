-- dividend_cache — trailing dividend yield per symbol, for asset-location
-- decisions (which holdings belong in taxable vs tax-deferred).
--
-- Shared reference data like quote_cache: any authenticated user may read; only
-- Edge Functions (service_role) write.
--
-- `trailing_yield` is a FRACTION (0.0102 = 1.02%), computed from the last 12
-- months of ACTUAL distributions divided by current price — not a forward
-- estimate. Trailing actuals are the right basis here because the question is
-- "what income did this throw off into a 1099", not "what might it yield next".

create table if not exists public.dividend_cache (
  symbol         text primary key,
  trailing_yield numeric,
  annual_amount  numeric,
  source         text,
  updated_at     timestamptz not null default now()
);

alter table public.dividend_cache enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'dividend_cache' and policyname = 'dividend_cache_read'
  ) then
    create policy dividend_cache_read on public.dividend_cache
      for select to authenticated using (true);
  end if;
end$$;
