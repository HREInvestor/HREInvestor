-- HREI commercial-email campaigns. Marketing email remains owner-controlled,
-- individually delivered, logged, and suppressible.

alter table public.leads
  add column if not exists email_opt_out boolean not null default false,
  add column if not exists email_opt_out_at timestamptz;

create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  subject text not null check (char_length(subject) between 1 and 200),
  message text not null check (char_length(message) between 1 and 10000),
  status text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'partially_sent', 'failed')),
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists email_campaigns_created_idx on public.email_campaigns(created_at desc);

create table if not exists public.email_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  lead_id bigint not null references public.leads(id) on delete restrict,
  recipient_email text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped', 'unsubscribed')),
  error_message text,
  sent_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, lead_id)
);

create index if not exists email_campaign_recipients_campaign_idx
  on public.email_campaign_recipients(campaign_id, created_at desc);

alter table public.email_campaigns enable row level security;
alter table public.email_campaign_recipients enable row level security;

drop policy if exists "Owners manage email campaigns" on public.email_campaigns;
create policy "Owners manage email campaigns"
  on public.email_campaigns for all to authenticated
  using (public.is_hrei_owner())
  with check (public.is_hrei_owner());

drop policy if exists "Owners manage email campaign recipients" on public.email_campaign_recipients;
create policy "Owners manage email campaign recipients"
  on public.email_campaign_recipients for all to authenticated
  using (public.is_hrei_owner())
  with check (public.is_hrei_owner());
