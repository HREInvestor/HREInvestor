-- HREI distress timing queues and signal classification
-- Run after 20260815_hrei_crm_foundation.sql.

alter table public.leads
  add column if not exists distress_queue text not null default 'early_public_distress'
    check (distress_queue in ('early_public_distress', 'developing_legal_distress', 'immediate_foreclosure')),
  add column if not exists distress_type text
    check (distress_type in (
      'tax_delinquency', 'new_lien', 'nuisance_assessment', 'code_enforcement',
      'probate', 'landlord_eviction', 'lis_pendens', 'judicial_foreclosure',
      'repeated_municipal_lien', 'tax_sale_notice', 'foreclosure_auction', 'other'
    )),
  add column if not exists distress_event_date date,
  add column if not exists foreclosure_auction_date date;

create index if not exists leads_distress_queue_idx
  on public.leads(distress_queue, distress_type, distress_event_date, foreclosure_auction_date);

comment on column public.leads.distress_queue is
  'Acquisition timing queue: early public distress, developing legal distress, or immediate foreclosure.';
comment on column public.leads.distress_type is
  'Specific verified public-record distress signal; do not infer from unsupported personal information.';
