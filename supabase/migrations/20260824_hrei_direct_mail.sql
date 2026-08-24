-- HREI direct-mail tracking. Exports are logged, but a campaign is marked
-- mailed only after the Owner confirms the physical mail was sent.

alter table public.leads
  add column if not exists direct_mail_opt_out boolean not null default false,
  add column if not exists direct_mail_opt_out_at timestamptz;

create table if not exists public.direct_mail_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  format text not null check (format in ('letter', 'labels', 'postcard')),
  status text not null default 'prepared' check (status in ('prepared', 'mailed', 'cancelled')),
  recipient_count integer not null default 0,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  exported_at timestamptz,
  mailed_at timestamptz
);

create table if not exists public.direct_mail_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.direct_mail_campaigns(id) on delete cascade,
  lead_id bigint not null references public.leads(id) on delete restrict,
  recipient_name text,
  mailing_address text not null,
  city text not null,
  state text not null,
  zip text not null,
  status text not null default 'prepared' check (status in ('prepared', 'mailed', 'returned', 'do_not_mail')),
  created_at timestamptz not null default now(),
  mailed_at timestamptz,
  unique (campaign_id, lead_id)
);

create index if not exists direct_mail_campaigns_created_idx on public.direct_mail_campaigns(created_at desc);
create index if not exists direct_mail_recipients_campaign_idx on public.direct_mail_recipients(campaign_id, created_at desc);

alter table public.direct_mail_campaigns enable row level security;
alter table public.direct_mail_recipients enable row level security;

drop policy if exists "Owners manage direct mail campaigns" on public.direct_mail_campaigns;
create policy "Owners manage direct mail campaigns"
  on public.direct_mail_campaigns for all to authenticated
  using (public.is_hrei_owner())
  with check (public.is_hrei_owner());

drop policy if exists "Owners manage direct mail recipients" on public.direct_mail_recipients;
create policy "Owners manage direct mail recipients"
  on public.direct_mail_recipients for all to authenticated
  using (public.is_hrei_owner())
  with check (public.is_hrei_owner());
