-- HREI outbound-call compliance controls.
-- Run after the existing HREI lead migrations. This is a CRM safeguard, not legal advice
-- and does not replace National Do Not Call Registry access, state requirements, or counsel.

alter table public.leads
  add column if not exists call_screening_status text not null default 'unverified'
    check (call_screening_status in (
      'unverified',
      'cleared',
      'national_dnc',
      'internal_dnc',
      'written_permission',
      'established_business_relationship'
    )),
  add column if not exists call_screened_at timestamptz,
  add column if not exists call_screened_by uuid references auth.users(id),
  add column if not exists call_screening_source text,
  add column if not exists call_screening_notes text;

create index if not exists leads_call_screening_idx
  on public.leads(call_screening_status, call_screened_at desc);

comment on column public.leads.call_screening_status is
  'Outbound-call safeguard. Only cleared, written_permission, or established_business_relationship unlock the CRM call link.';
comment on column public.leads.call_screening_source is
  'Dated DNC scrub vendor/list version or the recorded basis for the permitted call.';
