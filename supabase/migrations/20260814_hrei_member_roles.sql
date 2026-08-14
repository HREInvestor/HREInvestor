-- HREI member roles and Square subscription status
-- Run this file in Supabase SQL Editor before publishing the new website files.

create table if not exists public.member_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'investor'
    check (role in ('owner', 'contractor', 'investor')),
  subscription_status text not null default 'not_required'
    check (subscription_status in ('not_required', 'active', 'past_due', 'canceled')),
  square_customer_id text unique,
  square_subscription_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.member_profiles enable row level security;

drop policy if exists "Members can read their own profile" on public.member_profiles;
create policy "Members can read their own profile"
  on public.member_profiles for select
  to authenticated
  using (auth.uid() = id);

create or replace function public.create_hrei_member_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.member_profiles (id, email, role, subscription_status)
  values (
    new.id,
    lower(new.email),
    case when lower(new.email) = 'office@hreinvestor.com' then 'owner' else 'investor' end,
    'not_required'
  )
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

drop trigger if exists hrei_member_profile_on_signup on auth.users;
create trigger hrei_member_profile_on_signup
  after insert on auth.users
  for each row execute procedure public.create_hrei_member_profile();

-- Create profiles for accounts that already exist. The office account becomes Owner.
insert into public.member_profiles (id, email, role, subscription_status)
select
  u.id,
  lower(u.email),
  case when lower(u.email) = 'office@hreinvestor.com' then 'owner' else 'investor' end,
  'not_required'
from auth.users u
on conflict (id) do update
set email = excluded.email,
    role = case
      when excluded.email = 'office@hreinvestor.com' then 'owner'
      else public.member_profiles.role
    end,
    updated_at = now();

create or replace function public.set_member_profile_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists hrei_member_profile_updated_at on public.member_profiles;
create trigger hrei_member_profile_updated_at
  before update on public.member_profiles
  for each row execute procedure public.set_member_profile_updated_at();
