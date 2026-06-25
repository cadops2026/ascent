-- ============================================================================
-- ASCENT — P1.5 assisted statement import
-- A review queue table + a PRIVATE, RLS-locked Storage bucket. Raw statements
-- are owner-only and deletable (invariant #10). The parse-statements Edge
-- Function (service role) reads files + writes candidates; nothing auto-commits.
-- ============================================================================

create table public.statement_imports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  file_path   text not null,                          -- storage path: <uid>/<id>/<filename>
  file_name   text,
  status      text not null default 'uploaded'
                check (status in ('uploaded','parsing','parsed','error','committed','dismissed')),
  error       text,
  summary     jsonb,                                  -- { institution, account_type, statement_date }
  candidates  jsonb not null default '[]',            -- extracted rows pending review
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index statement_imports_user_id_idx on public.statement_imports (user_id);

alter table public.statement_imports enable row level security;
create policy statement_imports_owner on public.statement_imports
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create trigger trg_statement_imports_updated
  before update on public.statement_imports
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Private Storage bucket for raw statements
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('statements', 'statements', false)
on conflict (id) do nothing;

-- Owner-only access, keyed on the first path segment = auth.uid().
create policy "statements_owner_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'statements' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "statements_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'statements' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "statements_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'statements' and (storage.foldername(name))[1] = auth.uid()::text);
