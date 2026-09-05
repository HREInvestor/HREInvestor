-- Secure public seller-inquiry intake. Run after the existing HREI CRM migrations.
-- Public visitors submit through the seller-inquiry-submit Edge Function; they do not
-- receive direct write access to the CRM tables.

alter table public.leads
  add column if not exists website_inquiry_at timestamptz,
  add column if not exists website_contact_consent_at timestamptz,
  add column if not exists website_privacy_policy_version text,
  add column if not exists automated_confirmation_sent_at timestamptz;

create table if not exists public.website_form_rate_limits (
  request_key text primary key,
  last_submitted_at timestamptz not null default now()
);

alter table public.website_form_rate_limits enable row level security;

-- The Edge Function uses the service role. Keep public users out of CRM data.
drop policy if exists "Public can submit seller leads" on public.leads;
