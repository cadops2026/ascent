-- ============================================================================
-- ASCENT — Estate-document vault (completes the P7 estate-doc checklist)
-- A PRIVATE, RLS-locked Storage bucket for wills / trusts / POAs / directives.
-- Owner-only and deletable (invariant #10); ASCENT stores where the documents
-- live, it never drafts or files them (invariant #9). The `estate_docs.file_ref`
-- column already tracks the storage path; this adds the bucket it points into.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('estate-docs', 'estate-docs', false)
on conflict (id) do nothing;

-- Owner-only access, keyed on the first path segment = auth.uid()
-- (paths are <uid>/<doc_type>/<filename>).
create policy "estate_docs_owner_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'estate-docs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "estate_docs_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'estate-docs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "estate_docs_owner_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'estate-docs' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'estate-docs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "estate_docs_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'estate-docs' and (storage.foldername(name))[1] = auth.uid()::text);
