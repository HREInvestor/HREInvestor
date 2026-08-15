-- HREI investor deal rooms
-- Run after the existing HREI workspace CRM migration.

alter table public.properties
  add column if not exists investment_highlights text,
  add column if not exists estimated_repairs numeric,
  add column if not exists estimated_arv numeric,
  add column if not exists asking_price numeric,
  add column if not exists documents_url text,
  add column if not exists deal_contact_email text;

create index if not exists properties_available_created_idx
  on public.properties(status, created_at desc);