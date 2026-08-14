-- HREI owner outreach workspace: consent, opt-outs, and contact history
alter table public.leads
  add column if not exists sms_consent boolean not null default false,
  add column if not exists sms_consent_at timestamptz,
  add column if not exists contact_opt_out boolean not null default false,
  add column if not exists contact_opt_out_at timestamptz,
  add column if not exists last_contacted_at timestamptz,
  add column if not exists last_contact_method text;

create table if not exists public.lead_contact_log (
  id uuid primary key default gen_random_uuid(),
  lead_id bigint not null references public.leads(id) on delete cascade,
  channel text not null check (channel in ('call', 'email', 'sms')),
  outcome text not null default 'attempted',
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists lead_contact_log_lead_id_idx
  on public.lead_contact_log(lead_id, created_at desc);

alter table public.lead_contact_log enable row level security;

drop policy if exists "Owners manage contact logs" on public.lead_contact_log;
create policy "Owners manage contact logs"
  on public.lead_contact_log for all to authenticated
  using (public.is_hrei_owner())
  with check (public.is_hrei_owner());