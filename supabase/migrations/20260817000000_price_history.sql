-- price_history — daily closes for the benchmark symbols the alpha engine
-- compares holdings against. Shared reference data like quote_cache: any
-- authenticated user may read; only Edge Functions (service_role) write.
--
-- Closes are SPLIT-adjusted but NOT dividend-adjusted, deliberately: a holding's
-- own return is derived from cost basis vs current price (also price-only), so
-- both sides of the alpha subtraction are on the same basis.

create table if not exists public.price_history (
  symbol  text not null,
  on_date date not null,
  close   numeric not null,
  primary key (symbol, on_date)
);

create index if not exists price_history_symbol_date_idx
  on public.price_history (symbol, on_date desc);

alter table public.price_history enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'price_history' and policyname = 'price_history_read'
  ) then
    create policy price_history_read on public.price_history
      for select to authenticated using (true);
  end if;
end$$;
