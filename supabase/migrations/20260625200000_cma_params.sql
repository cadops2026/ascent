-- User-maintained capital-market assumptions override, one row per (user, year).
-- The consensus CMA is seeded in cma_sources / asset_class_universe; this lets a
-- user override per-class expected return / vol / correlation for a given year
-- (the houses republish annually). Engines fall back to the seeded consensus when
-- no row exists. RLS owner-only (browser writes via the authenticated role, #10).
create table public.cma_params (
  user_id    uuid not null references auth.users (id) on delete cascade,
  cma_year   integer not null,
  params     jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, cma_year)
);

alter table public.cma_params enable row level security;

create policy cma_params_owner on public.cma_params
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger trg_cma_params_updated
  before update on public.cma_params
  for each row execute function public.set_updated_at();
