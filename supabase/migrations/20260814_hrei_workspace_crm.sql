-- HREI protected CRM, property portfolio, and contractor jobs
-- Run after 20260814_hrei_member_roles.sql.

create or replace function public.is_hrei_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.member_profiles
    where id = auth.uid() and role = 'owner'
  );
$$;

grant execute on function public.is_hrei_owner() to authenticated;

alter table public.leads enable row level security;

drop policy if exists "Public can submit seller leads" on public.leads;
drop policy if exists "Owners manage seller leads" on public.leads;
create policy "Public can submit seller leads"
  on public.leads for insert to anon, authenticated
  with check (true);
create policy "Owners manage seller leads"
  on public.leads for all to authenticated
  using (public.is_hrei_owner())
  with check (public.is_hrei_owner());

drop policy if exists "Owners can manage member profiles" on public.member_profiles;
create policy "Owners can manage member profiles"
  on public.member_profiles for all to authenticated
  using (public.is_hrei_owner())
  with check (public.is_hrei_owner());

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  address text,
  city text,
  state text,
  zip text,
  list_price numeric,
  bedrooms numeric,
  bathrooms numeric,
  square_feet integer,
  description text,
  image_url text,
  status text not null default 'draft'
    check (status in ('draft', 'available', 'under_contract', 'sold', 'archived')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contractor_jobs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete set null,
  assigned_to uuid references public.member_profiles(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'open'
    check (status in ('open', 'assigned', 'in_progress', 'blocked', 'complete')),
  due_date date,
  budget numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists properties_status_idx on public.properties(status);
create index if not exists contractor_jobs_assigned_to_idx on public.contractor_jobs(assigned_to);
create index if not exists leads_created_at_idx on public.leads(created_at desc);

alter table public.properties enable row level security;
alter table public.contractor_jobs enable row level security;

drop policy if exists "Members can view available properties" on public.properties;
drop policy if exists "Owners manage properties" on public.properties;
create policy "Members can view available properties"
  on public.properties for select to authenticated
  using (status = 'available' or public.is_hrei_owner());
create policy "Owners manage properties"
  on public.properties for all to authenticated
  using (public.is_hrei_owner())
  with check (public.is_hrei_owner());

drop policy if exists "Contractors view assigned jobs" on public.contractor_jobs;
drop policy if exists "Contractors update assigned jobs" on public.contractor_jobs;
drop policy if exists "Owners manage contractor jobs" on public.contractor_jobs;
create policy "Contractors view assigned jobs"
  on public.contractor_jobs for select to authenticated
  using (assigned_to = auth.uid() or public.is_hrei_owner());
create policy "Contractors update assigned jobs"
  on public.contractor_jobs for update to authenticated
  using (assigned_to = auth.uid())
  with check (assigned_to = auth.uid());
create policy "Owners manage contractor jobs"
  on public.contractor_jobs for all to authenticated
  using (public.is_hrei_owner())
  with check (public.is_hrei_owner());

drop trigger if exists properties_updated_at on public.properties;
create trigger properties_updated_at before update on public.properties
  for each row execute procedure public.set_member_profile_updated_at();

drop trigger if exists contractor_jobs_updated_at on public.contractor_jobs;
create trigger contractor_jobs_updated_at before update on public.contractor_jobs
  for each row execute procedure public.set_member_profile_updated_at();