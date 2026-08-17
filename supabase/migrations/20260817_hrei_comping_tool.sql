-- HREI comping tool: saved subject properties and comparable sales
-- Run in the Supabase SQL Editor after the existing HREI migrations.

create table if not exists public.comp_analyses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subject_address text,
  city text,
  state text not null default 'AL',
  zip text,
  bedrooms numeric,
  bathrooms numeric,
  square_feet integer,
  repair_estimate numeric not null default 0 check (repair_estimate >= 0),
  target_profit numeric not null default 0 check (target_profit >= 0),
  offer_rule_percent numeric not null default 70 check (offer_rule_percent > 0 and offer_rule_percent <= 100),
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.comp_sales (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.comp_analyses(id) on delete cascade,
  address text not null,
  sale_price numeric not null check (sale_price > 0),
  sale_date date,
  square_feet integer check (square_feet is null or square_feet > 0),
  bedrooms numeric,
  bathrooms numeric,
  distance_miles numeric check (distance_miles is null or distance_miles >= 0),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists comp_analyses_owner_created_idx
  on public.comp_analyses(created_by, created_at desc);
create index if not exists comp_sales_analysis_idx
  on public.comp_sales(analysis_id, created_at);

alter table public.comp_analyses enable row level security;
alter table public.comp_sales enable row level security;

drop policy if exists "Owners manage comp analyses" on public.comp_analyses;
create policy "Owners manage comp analyses"
  on public.comp_analyses for all to authenticated
  using (public.is_hrei_owner())
  with check (public.is_hrei_owner());

drop policy if exists "Owners manage comp sales" on public.comp_sales;
create policy "Owners manage comp sales"
  on public.comp_sales for all to authenticated
  using (public.is_hrei_owner())
  with check (public.is_hrei_owner());
