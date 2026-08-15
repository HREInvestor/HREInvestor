-- HREI e-sign contract tracking
create table if not exists public.esign_contracts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  signer_name text not null,
  signer_email text not null,
  template_id text not null,
  signwell_document_id text unique,
  status text not null default 'draft' check (status in ('draft','sent','signed','declined','canceled','error')),
  test_mode boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.esign_contracts enable row level security;
drop policy if exists "Owners manage e-sign contracts" on public.esign_contracts;
create policy "Owners manage e-sign contracts" on public.esign_contracts for all to authenticated using (public.is_hrei_owner()) with check (public.is_hrei_owner());
drop trigger if exists esign_contracts_updated_at on public.esign_contracts;
create trigger esign_contracts_updated_at before update on public.esign_contracts for each row execute procedure public.set_member_profile_updated_at();