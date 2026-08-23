-- HREI lead enrichment: preserve detailed list-provider and research data on every CRM lead.
-- Run after the existing HREI lead migrations.

alter table public.leads
  add column if not exists mailing_address text,
  add column if not exists mailing_city text,
  add column if not exists mailing_state text,
  add column if not exists mailing_zip text,
  add column if not exists county text,
  add column if not exists latitude numeric,
  add column if not exists longitude numeric,
  add column if not exists property_type text,
  add column if not exists owner_type text,
  add column if not exists last_sale_date date,
  add column if not exists last_sale_price numeric,
  add column if not exists price_per_sqft numeric,
  add column if not exists square_feet integer,
  add column if not exists lot_size_sqft numeric,
  add column if not exists beds numeric,
  add column if not exists baths numeric,
  add column if not exists year_built integer,
  add column if not exists subdivision text,
  add column if not exists estimated_market_value numeric,
  add column if not exists estimated_wholesale_value numeric,
  add column if not exists rental_estimate_low numeric,
  add column if not exists rental_estimate_high numeric,
  add column if not exists tax_amount numeric,
  add column if not exists lead_tags text[] not null default array[]::text[],
  add column if not exists contact_candidates jsonb not null default '[]'::jsonb,
  add column if not exists source_record_id text,
  add column if not exists source_data jsonb not null default '{}'::jsonb;

create index if not exists leads_county_idx on public.leads(county, created_at desc);
create index if not exists leads_property_type_idx on public.leads(property_type, created_at desc);
create index if not exists leads_tags_idx on public.leads using gin(lead_tags);
create index if not exists leads_source_record_idx on public.leads(source, source_record_id)
  where source_record_id is not null;

comment on column public.leads.contact_candidates is
  'Provider or research contact choices, including DNC and litigator flags. Never treat a phone as SMS consent.';
comment on column public.leads.source_data is
  'Original imported or researched source fields retained for CRM review.';
