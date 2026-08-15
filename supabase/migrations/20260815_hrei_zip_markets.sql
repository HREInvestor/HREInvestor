-- HREI Owner-only Alabama ZIP targeting and sellability scores

create table if not exists public.zip_markets (
  zip text primary key check (zip ~ '^[0-9]{5}$'),
  city text,
  county text,
  state text not null default 'AL' check (state = 'AL'),
  lead_volume_score integer not null default 0 check (lead_volume_score between 0 and 30),
  investor_demand_score integer not null default 0 check (investor_demand_score between 0 and 20),
  deal_velocity_score integer not null default 0 check (deal_velocity_score between 0 and 20),
  renovation_fit_score integer not null default 0 check (renovation_fit_score between 0 and 15),
  strategic_priority_score integer not null default 0 check (strategic_priority_score between 0 and 15),
  sellability_score integer generated always as (
    lead_volume_score + investor_demand_score + deal_velocity_score +
    renovation_fit_score + strategic_priority_score
  ) stored,
  notes text,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists zip_markets_sellability_idx
  on public.zip_markets(sellability_score desc, zip);

alter table public.zip_markets enable row level security;

drop policy if exists "Owners manage ZIP markets" on public.zip_markets;
create policy "Owners manage ZIP markets"
  on public.zip_markets for all to authenticated
  using (public.is_hrei_owner())
  with check (public.is_hrei_owner());

drop trigger if exists zip_markets_updated_at on public.zip_markets;
create trigger zip_markets_updated_at before update on public.zip_markets
  for each row execute procedure public.set_member_profile_updated_at();