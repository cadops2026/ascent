-- Tax & statutory parameters, user-maintained, one row per (user, tax_year).
-- The app reads the latest year's row; engines fall back to the hardcoded
-- DEFAULT_TAX_PARAMS until a row exists. RLS owner-only (browser writes via the
-- authenticated role, invariant #10). `params` jsonb holds the full TaxParams blob
-- (brackets, std deduction, LTCG/IRMAA/RMD/NIIT, estate exemption + rate).
create table public.tax_parameters (
  user_id    uuid not null references auth.users (id) on delete cascade,
  tax_year   integer not null,
  params     jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, tax_year)
);

alter table public.tax_parameters enable row level security;

create policy tax_parameters_owner on public.tax_parameters
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger trg_tax_parameters_updated
  before update on public.tax_parameters
  for each row execute function public.set_updated_at();
