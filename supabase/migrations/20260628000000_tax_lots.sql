-- Per-holding tax lots for lot-level tax-loss harvesting + wash-sale awareness.
-- An optional refinement of holdings.cost_basis (a single blended basis): when a
-- holding has lots, the TLH engine evaluates each lot's gain/loss and flags
-- wash-sale risk (a same-security lot acquired within 30 days of today). Engines
-- fall back to the holding-level basis when a holding has no lots. RLS owner-only
-- — the browser writes via the authenticated role, never a third party (#10).
create table public.tax_lots (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  holding_id  uuid not null references public.holdings (id) on delete cascade,
  shares      numeric not null,
  cost_basis  numeric not null,                 -- total basis for the lot's shares
  acquired_on date,
  created_at  timestamptz not null default now()
);
create index tax_lots_user_id_idx on public.tax_lots (user_id);
create index tax_lots_holding_id_idx on public.tax_lots (holding_id);

alter table public.tax_lots enable row level security;

create policy tax_lots_owner on public.tax_lots
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
