-- ============================================================================
-- ASCENT — P0 data model (spec §4)
-- Postgres / Supabase. RLS = auth.uid() on every user-scoped table.
-- Shared cache/reference tables are read-only to authenticated users; only
-- Edge Functions (service_role, which bypasses RLS) write to them. (Invariant #10)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper: keep updated_at fresh
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===========================================================================
-- USER-SCOPED TABLES  (RLS: owner only)
-- ===========================================================================

-- profiles: one row per user --------------------------------------------------
create table public.profiles (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  dob            date,
  retire_age     int,
  plan_to_age    int,
  filing_status  text check (filing_status in ('single','mfj','mfs','hoh','qw')),
  state          text,
  share_with     uuid[] not null default '{}',          -- spouse sharing (policies deferred to P8)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- accounts --------------------------------------------------------------------
create table public.accounts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  name           text not null,
  tax_type       text not null check (tax_type in (
                   'taxable','trad_401k','roth_401k','trad_ira','roth_ira','hsa',
                   'sep_ira','solo_401k','529','cash_balance_db','trust','other')),
  institution    text,
  aggregator_ref text,
  balance_cached numeric,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index accounts_user_id_idx on public.accounts (user_id);

-- holdings --------------------------------------------------------------------
create table public.holdings (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  account_id    uuid references public.accounts (id) on delete cascade,
  symbol        text,
  name          text,
  kind          text not null check (kind in
                  ('stock','etf','crypto','real_estate','private','collectible','cash')),
  entry_mode    text not null check (entry_mode in ('shares','amount')),
  shares        numeric,
  manual_amount numeric,
  proj_growth   numeric,                                 -- per-holding projected annual growth (fraction)
  cost_basis    numeric,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- shares-mode needs shares; amount-mode needs an amount
  constraint holdings_entry_consistent check (
    (entry_mode = 'shares' and shares is not null) or
    (entry_mode = 'amount'  and manual_amount is not null)
  )
);
create index holdings_user_id_idx on public.holdings (user_id);
create index holdings_account_id_idx on public.holdings (account_id);

-- real_estate -----------------------------------------------------------------
-- Primary residence: in net worth + estate, OUT of investable allocation (invariant #11)
create table public.real_estate (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  label        text,
  kind         text not null check (kind in ('residence','investment')),
  market_value numeric not null,
  value_source text not null default 'manual' check (value_source in ('manual','avm')),
  as_of        date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index real_estate_user_id_idx on public.real_estate (user_id);

-- liabilities -----------------------------------------------------------------
create table public.liabilities (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  label         text,
  kind          text not null check (kind in ('mortgage','other')),
  orig_balance  numeric not null,
  rate          numeric,                                 -- annual interest rate (fraction)
  term_months   int,
  start_date    date,
  property_id   uuid references public.real_estate (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index liabilities_user_id_idx on public.liabilities (user_id);

-- spending_baseline: one row per user ----------------------------------------
create table public.spending_baseline (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  annual_amount numeric,
  by_category   jsonb not null default '{}',
  source        text not null default 'manual' check (source in ('manual','linked')),
  updated_at    timestamptz not null default now()
);

-- target_allocation -----------------------------------------------------------
create table public.target_allocation (
  user_id     uuid not null references auth.users (id) on delete cascade,
  asset_class text not null,
  target_pct  numeric,
  glide       jsonb,
  primary key (user_id, asset_class)
);

-- rebalance_bands -------------------------------------------------------------
create table public.rebalance_bands (
  user_id     uuid not null references auth.users (id) on delete cascade,
  asset_class text not null,
  abs_pts     numeric,
  rel_pct     numeric,
  primary key (user_id, asset_class)
);

-- scenarios -------------------------------------------------------------------
create table public.scenarios (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  params     jsonb not null default '{}',
  is_base    boolean not null default false,
  created_at timestamptz not null default now()
);
create index scenarios_user_id_idx on public.scenarios (user_id);

-- phase_plan: one row per user ------------------------------------------------
create table public.phase_plan (
  user_id               uuid primary key references auth.users (id) on delete cascade,
  downshift_age         int,
  retire_age            int,
  phase2_income_frac    numeric,
  phase2_years          int,
  maintain_mode         boolean not null default false,
  legacy_target         numeric,
  confidence_target     numeric,
  withdrawal_guardrails jsonb not null default '{}',
  lifestyle_by_phase    jsonb not null default '{}',
  updated_at            timestamptz not null default now()
);

-- alert_rules: one row per user (pre-committed thresholds, never price-triggered) --
create table public.alert_rules (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  rebalance_band_pt numeric,
  single_name_pct  numeric,
  narrative_pct    numeric,
  tlh_min_loss     numeric,
  cadence          text not null default 'monthly' check (cadence in ('monthly','weekly','event')),
  updated_at       timestamptz not null default now()
);

-- alerts ----------------------------------------------------------------------
create table public.alerts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         text not null,
  payload      jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  dismissed_at timestamptz
);
create index alerts_user_id_idx on public.alerts (user_id);

-- net_worth_snapshots ---------------------------------------------------------
create table public.net_worth_snapshots (
  user_id    uuid not null references auth.users (id) on delete cascade,
  asof_date  date not null,
  total      numeric,
  by_class   jsonb not null default '{}',
  primary key (user_id, asof_date)
);

-- insurance_policies ----------------------------------------------------------
create table public.insurance_policies (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text,                                      -- disability | umbrella | term_life | ltc | entity
  carrier     text,
  coverage    numeric,
  premium     numeric,
  owner       text,
  beneficiary text,
  created_at  timestamptz not null default now()
);
create index insurance_policies_user_id_idx on public.insurance_policies (user_id);

-- estate_docs -----------------------------------------------------------------
create table public.estate_docs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  doc_type      text,                                    -- revocable_trust | poa | healthcare_directive | guardianship | beneficiary_audit | will
  status        text not null default 'none' check (status in ('none','draft','executed','stale')),
  last_reviewed date,
  file_ref      text,
  created_at    timestamptz not null default now()
);
create index estate_docs_user_id_idx on public.estate_docs (user_id);

-- ===========================================================================
-- SHARED CACHE / REFERENCE TABLES  (read-only to users; Edge Functions write)
-- ===========================================================================

create table public.quote_cache (
  symbol     text primary key,
  price      numeric,
  prev_close numeric,
  updated_at timestamptz not null default now()
);

create table public.etf_holdings (
  etf_symbol     text not null,
  holding_symbol text not null,
  holding_name   text,
  weight         numeric,
  asof           date,
  primary key (etf_symbol, holding_symbol)
);

create table public.cpi_cache (
  series      text not null,
  asof_month  date not null,
  index_value numeric,
  primary key (series, asof_month)
);

create table public.infl_expectations_cache (
  source        text not null,                           -- EXPINF | breakeven | survey
  horizon_years int not null,
  value         numeric,
  asof          date not null,
  primary key (source, horizon_years, asof)
);

create table public.nowcast_cache (
  index     text not null,
  asof_day  date not null,
  value     numeric,
  primary key (index, asof_day)
);

create table public.cma_sources (
  asset_class text not null,
  house       text not null,                             -- Vanguard | JPM | Invesco | BlackRock | MorganStanley
  value       numeric,
  exact       boolean not null default true,
  asof        date not null,
  primary key (asset_class, house, asof)
);

create table public.asset_class_universe (
  class             text primary key,
  cma_premium       numeric,
  vol               numeric,
  corr_to_us_equity numeric,
  cost_proxy        numeric,
  liquidity         text,
  gate              text
);

-- ===========================================================================
-- updated_at triggers
-- ===========================================================================
create trigger trg_profiles_updated      before update on public.profiles          for each row execute function public.set_updated_at();
create trigger trg_accounts_updated       before update on public.accounts          for each row execute function public.set_updated_at();
create trigger trg_holdings_updated       before update on public.holdings          for each row execute function public.set_updated_at();
create trigger trg_real_estate_updated    before update on public.real_estate       for each row execute function public.set_updated_at();
create trigger trg_liabilities_updated    before update on public.liabilities       for each row execute function public.set_updated_at();
create trigger trg_spending_updated       before update on public.spending_baseline for each row execute function public.set_updated_at();
create trigger trg_phase_plan_updated     before update on public.phase_plan        for each row execute function public.set_updated_at();
create trigger trg_alert_rules_updated    before update on public.alert_rules       for each row execute function public.set_updated_at();

-- ===========================================================================
-- ROW-LEVEL SECURITY
-- ===========================================================================

-- Owner-only tables: a single FOR ALL policy gates select/insert/update/delete.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','accounts','holdings','real_estate','liabilities','spending_baseline',
    'target_allocation','rebalance_bands','scenarios','phase_plan','alert_rules','alerts',
    'net_worth_snapshots','insurance_policies','estate_docs'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);',
      t || '_owner', t
    );
  end loop;
end$$;

-- Shared tables: authenticated users may READ; no write policy means only
-- service_role (Edge Functions, bypasses RLS) can write.
do $$
declare t text;
begin
  foreach t in array array[
    'quote_cache','etf_holdings','cpi_cache','infl_expectations_cache',
    'nowcast_cache','cma_sources','asset_class_universe'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true);',
      t || '_read', t
    );
  end loop;
end$$;
