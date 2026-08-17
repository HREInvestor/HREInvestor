-- HREI investor deal alerts: owner campaigns, delivery history, and investor preferences.
-- Run this in Supabase SQL Editor before opening the Dispo Email Blaster page.

create table if not exists public.member_email_preferences (
  member_id uuid primary key references auth.users(id) on delete cascade,
  deal_alerts_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.member_email_preferences enable row level security;

drop policy if exists "Members manage their own email preferences" on public.member_email_preferences;
create policy "Members manage their own email preferences"
  on public.member_email_preferences for all to authenticated
  using (auth.uid() = member_id)
  with check (auth.uid() = member_id);

drop policy if exists "Owners manage member email preferences" on public.member_email_preferences;
create policy "Owners manage member email preferences"
  on public.member_email_preferences for all to authenticated
  using (public.is_hrei_owner())
  with check (public.is_hrei_owner());

create table if not exists public.dispo_campaigns (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  subject text not null check (char_length(subject) between 1 and 200),
  message text not null check (char_length(message) between 1 and 10000),
  status text not null default 'draft' check (status in ('draft', 'sent', 'partially_sent', 'failed')),
  sent_count integer not null default 0,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists dispo_campaigns_created_idx
  on public.dispo_campaigns(created_at desc);

alter table public.dispo_campaigns enable row level security;

drop policy if exists "Owners manage dispo campaigns" on public.dispo_campaigns;
create policy "Owners manage dispo campaigns"
  on public.dispo_campaigns for all to authenticated
  using (public.is_hrei_owner())
  with check (public.is_hrei_owner());

create table if not exists public.dispo_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.dispo_campaigns(id) on delete cascade,
  member_id uuid not null references public.member_profiles(id) on delete restrict,
  recipient_email text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, member_id)
);

create index if not exists dispo_recipients_campaign_idx
  on public.dispo_campaign_recipients(campaign_id, created_at desc);

alter table public.dispo_campaign_recipients enable row level security;

drop policy if exists "Owners manage dispo campaign recipients" on public.dispo_campaign_recipients;
create policy "Owners manage dispo campaign recipients"
  on public.dispo_campaign_recipients for all to authenticated
  using (public.is_hrei_owner())
  with check (public.is_hrei_owner());