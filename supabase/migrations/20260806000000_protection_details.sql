-- ============================================================================
-- ASCENT — protection readout inputs.
--
-- The insurance-gap readout was presence-based: it could tell you a disability
-- policy existed, not whether it would actually pay. For a high-earning
-- professional the terms decide that, not the amount — the definition of
-- disability, who paid the premiums (which sets the tax character of the
-- benefit), the benefit period, and the riders. Same story on the professional
-- liability side, where occurrence-vs-claims-made and whether a tail is secured
-- matter more than the limit.
--
--   insurance_policies.details — jsonb bag of policy terms. Shape is owned by
--     the engines (DisabilityDetails in finance/disability.ts,
--     MalpracticeDetails in finance/assetprotection.ts) so new terms need no
--     further migration. Defaults to '{}' so existing rows read cleanly.
--
--   profiles.earned_income — gross annual earned income. Drives the human-capital
--     figure and the income-replacement gap in the disability readout. Nullable;
--     the readout degrades to the spending floor when it is unset.
--
-- Both additive, nullable-or-defaulted, and idempotent. profiles and
-- insurance_policies are already owner-only under RLS (auth.uid() = user_id),
-- so no policy changes are needed.
-- ============================================================================

alter table public.insurance_policies
  add column if not exists details jsonb not null default '{}'::jsonb;

alter table public.profiles
  add column if not exists earned_income numeric;
