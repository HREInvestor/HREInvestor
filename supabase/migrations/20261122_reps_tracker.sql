-- REPS (IRC 469(c)(7)) hours tracker for /reps/.
-- NEW objects only. Does not touch public.leads or any existing CRM table, function or policy.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1) Allowlist. Only emails listed here can read/write REPS data.
create table if not exists public.reps_allowed_emails (
  email text primary key check (email = lower(btrim(email)) and position('@' in email) > 1),
  note text,
  created_at timestamptz not null default now()
);
alter table public.reps_allowed_emails enable row level security;
-- No policies: only service role / SQL editor / security-definer helpers can read it.

create or replace function public.reps_is_allowed(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.reps_allowed_emails where email = lower(btrim(p_email)));
$$;
revoke all on function public.reps_is_allowed(text) from public;
grant execute on function public.reps_is_allowed(text) to anon, authenticated;

create or replace function public.reps_me_allowed()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.reps_allowed_emails where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke all on function public.reps_me_allowed() from public;
grant execute on function public.reps_me_allowed() to authenticated;

-- 2) Settings (one row per user)
create table if not exists public.reps_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  display_name text,
  spouse_name text default 'Joshua',
  tax_year int not null default 2027 check (tax_year between 2024 and 2100),
  goal_hours numeric not null default 750,
  target_hours numeric not null default 900,
  timezone text not null default 'America/Chicago',
  daily_enabled boolean not null default true,
  daily_time time not null default '19:30',
  weekly_enabled boolean not null default true,
  weekly_dow int not null default 0 check (weekly_dow between 0 and 6), -- 0 = Sunday
  weekly_time time not null default '18:00',
  monthly_enabled boolean not null default true,
  monthly_day int not null default 1 check (monthly_day between 1 and 28),
  monthly_time time not null default '09:00',
  last_daily_sent date,
  last_weekly_sent date,
  last_monthly_sent date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.reps_settings enable row level security;

-- 3) Entries
create table if not exists public.reps_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid not null unique,          -- idempotency key for the offline queue
  work_date date not null,
  start_time time,
  end_time time,
  duration_minutes int not null check (duration_minutes > 0 and duration_minutes <= 1440),
  category text not null check (category in ('acquisition','seller_calls','property_mgmt','leasing','rehab','bookkeeping','travel','education','other')),
  qualifying boolean generated always as (category <> 'education') stored,
  person text not null default 'self' check (person in ('self','spouse')),
  property text,
  description text not null check (char_length(btrim(description)) >= 10),
  evidence_paths text[] not null default '{}',
  client_logged_at timestamptz,            -- device clock when she pressed Save (may be offline)
  created_at timestamptz not null default now(),  -- server clock, set by trigger
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version int not null default 1
);
create index if not exists reps_entries_user_date on public.reps_entries (user_id, work_date);
alter table public.reps_entries enable row level security;

-- 4) Audit history: snapshot of the PREVIOUS row on every update/soft delete
create table if not exists public.reps_entry_versions (
  id bigint generated always as identity primary key,
  entry_id uuid not null references public.reps_entries(id) on delete cascade,
  user_id uuid not null,
  version int not null,
  change_type text not null check (change_type in ('update','delete','restore')),
  snapshot jsonb not null,
  changed_at timestamptz not null default now()
);
create index if not exists reps_entry_versions_entry on public.reps_entry_versions (entry_id);
alter table public.reps_entry_versions enable row level security;

create or replace function public.reps_entries_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_at := now();
  new.updated_at := now();
  new.version := 1;
  new.deleted_at := null;
  if auth.uid() is not null then new.user_id := auth.uid(); end if;
  return new;
end $$;

create or replace function public.reps_entries_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare kind text;
begin
  -- immutable fields
  new.id := old.id; new.user_id := old.user_id; new.client_id := old.client_id;
  new.created_at := old.created_at; new.client_logged_at := old.client_logged_at;
  if row(new.work_date,new.start_time,new.end_time,new.duration_minutes,new.category,new.person,new.property,new.description,new.evidence_paths,new.deleted_at)
     is not distinct from
     row(old.work_date,old.start_time,old.end_time,old.duration_minutes,old.category,old.person,old.property,old.description,old.evidence_paths,old.deleted_at) then
    new.updated_at := old.updated_at; new.version := old.version;
    return new;
  end if;
  kind := case when old.deleted_at is null and new.deleted_at is not null then 'delete'
               when old.deleted_at is not null and new.deleted_at is null then 'restore'
               else 'update' end;
  if kind = 'delete' then new.deleted_at := now(); end if;
  insert into public.reps_entry_versions(entry_id, user_id, version, change_type, snapshot)
  values (old.id, old.user_id, old.version, kind, to_jsonb(old));
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists reps_entries_bi on public.reps_entries;
create trigger reps_entries_bi before insert on public.reps_entries for each row execute function public.reps_entries_before_insert();
drop trigger if exists reps_entries_bu on public.reps_entries;
create trigger reps_entries_bu before update on public.reps_entries for each row execute function public.reps_entries_before_update();
revoke all on function public.reps_entries_before_insert() from public, anon, authenticated;
revoke all on function public.reps_entries_before_update() from public, anon, authenticated;

-- 5) Push subscriptions
create table if not exists public.reps_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count int not null default 0
);
alter table public.reps_push_subscriptions enable row level security;

-- 6) Notification log (written by the edge function with the service role)
create table if not exists public.reps_notification_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  kind text not null,
  sent int not null default 0,
  failed int not null default 0,
  detail text,
  created_at timestamptz not null default now()
);
alter table public.reps_notification_log enable row level security;

-- RLS policies: owner + allowlisted only
drop policy if exists reps_settings_own on public.reps_settings;
create policy reps_settings_own on public.reps_settings for all to authenticated
  using (user_id = auth.uid() and public.reps_me_allowed())
  with check (user_id = auth.uid() and public.reps_me_allowed());

drop policy if exists reps_entries_select on public.reps_entries;
create policy reps_entries_select on public.reps_entries for select to authenticated
  using (user_id = auth.uid() and public.reps_me_allowed());
drop policy if exists reps_entries_insert on public.reps_entries;
create policy reps_entries_insert on public.reps_entries for insert to authenticated
  with check (user_id = auth.uid() and public.reps_me_allowed());
drop policy if exists reps_entries_update on public.reps_entries;
create policy reps_entries_update on public.reps_entries for update to authenticated
  using (user_id = auth.uid() and public.reps_me_allowed())
  with check (user_id = auth.uid() and public.reps_me_allowed());
-- No DELETE policy: entries are soft-deleted (deleted_at) so the history survives.

drop policy if exists reps_versions_select on public.reps_entry_versions;
create policy reps_versions_select on public.reps_entry_versions for select to authenticated
  using (user_id = auth.uid() and public.reps_me_allowed());

drop policy if exists reps_push_own on public.reps_push_subscriptions;
create policy reps_push_own on public.reps_push_subscriptions for all to authenticated
  using (user_id = auth.uid() and public.reps_me_allowed())
  with check (user_id = auth.uid() and public.reps_me_allowed());

drop policy if exists reps_notif_select on public.reps_notification_log;
create policy reps_notif_select on public.reps_notification_log for select to authenticated
  using (user_id = auth.uid() and public.reps_me_allowed());

revoke all on public.reps_allowed_emails from anon, authenticated;
revoke all on public.reps_notification_log from anon;
revoke all on public.reps_entries, public.reps_settings, public.reps_entry_versions, public.reps_push_subscriptions from anon;
grant select, insert, update on public.reps_entries to authenticated;
grant select, insert, update on public.reps_settings to authenticated;
grant select on public.reps_entry_versions to authenticated;
grant select, insert, update, delete on public.reps_push_subscriptions to authenticated;
grant select on public.reps_notification_log to authenticated;

-- 7) Private storage bucket for evidence photos / receipts: <user_id>/<entry client_id>/<file>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reps-evidence','reps-evidence', false, 15728640,
        array['image/jpeg','image/png','image/heic','image/heif','image/webp','application/pdf'])
on conflict (id) do nothing;

drop policy if exists reps_evidence_select on storage.objects;
create policy reps_evidence_select on storage.objects for select to authenticated
  using (bucket_id = 'reps-evidence' and (storage.foldername(name))[1] = auth.uid()::text and public.reps_me_allowed());
drop policy if exists reps_evidence_insert on storage.objects;
create policy reps_evidence_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'reps-evidence' and (storage.foldername(name))[1] = auth.uid()::text and public.reps_me_allowed());
-- No update/delete policies: evidence is write-once.

-- 8) Secrets for the edge function live in Supabase Vault (never in the repo).
--    reps_cron_secret is generated here; VAPID keys are generated by the edge function itself
--    on first run ("init" action) and stored via reps_set_secret, so the private key never leaves Supabase.
create or replace function public.reps_get_secrets()
returns table(name text, secret text) language sql stable security definer set search_path = public, vault as $$
  select name, decrypted_secret from vault.decrypted_secrets where name like 'reps\_%';
$$;
create or replace function public.reps_set_secret(p_name text, p_value text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare sid uuid;
begin
  if p_name not like 'reps\_%' then raise exception 'bad secret name'; end if;
  select id into sid from vault.secrets where name = p_name;
  if sid is null then perform vault.create_secret(p_value, p_name, 'REPS tracker');
  else perform vault.update_secret(sid, p_value); end if;
end $$;
revoke all on function public.reps_get_secrets() from public, anon, authenticated;
revoke all on function public.reps_set_secret(text, text) from public, anon, authenticated;
grant execute on function public.reps_get_secrets() to service_role;
grant execute on function public.reps_set_secret(text, text) to service_role;

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'reps_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'), 'reps_cron_secret', 'REPS tracker cron -> edge function');
  end if;
end $$;

-- 9) Scheduler: every 15 minutes. The edge function converts to each user's timezone
--    (America/Chicago by default, DST-aware) and sends daily 7:30 PM / Sunday 6 PM / 1st-of-month reminders.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'reps-notify-tick') then
    perform cron.unschedule('reps-notify-tick');
  end if;
end $$;
select cron.schedule('reps-notify-tick', '*/15 * * * *', $cron$
  select net.http_post(
    url := 'https://lmivqwscebdupfxxwfcc.supabase.co/functions/v1/reps-notify',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-reps-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'reps_cron_secret')),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 20000);
$cron$);

-- 10) Hours of any NON-real-estate work this tax year (for the >50% personal-services test).
alter table public.reps_settings add column if not exists other_work_hours numeric not null default 0 check (other_work_hours >= 0);
