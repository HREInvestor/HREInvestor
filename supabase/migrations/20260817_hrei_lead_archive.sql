-- HREI lead archive: retain past leads and protect against future duplicate outreach.
alter table public.leads
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id),
  add column if not exists archive_reason text,
  add column if not exists archived_match_lead_id bigint references public.leads(id),
  add column if not exists archived_match_at timestamptz;

create index if not exists leads_archived_at_idx
  on public.leads(archived_at, created_at desc);

create index if not exists leads_archived_match_idx
  on public.leads(archived_match_lead_id)
  where archived_match_lead_id is not null;

-- A new website/import lead that matches an archived person is saved for review,
-- but automatically excluded from outreach until an administrator decides otherwise.
create or replace function public.hrei_protect_archived_lead_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_id bigint;
begin
  select id into matched_id
  from public.leads
  where archived_at is not null
    and (
      (nullif(trim(new.email), '') is not null and lower(email) = lower(trim(new.email)))
      or (regexp_replace(coalesce(phone, ''), '\D', '', 'g') <> ''
          and regexp_replace(coalesce(new.phone, ''), '\D', '', 'g') <> ''
          and regexp_replace(phone, '\D', '', 'g') = regexp_replace(new.phone, '\D', '', 'g'))
      or (nullif(trim(new.seller_name), '') is not null
          and nullif(trim(new.property_address), '') is not null
          and lower(trim(seller_name)) = lower(trim(new.seller_name))
          and lower(trim(property_address)) = lower(trim(new.property_address)))
    )
  order by archived_at desc
  limit 1;

  if matched_id is not null then
    new.archived_match_lead_id := matched_id;
    new.archived_match_at := now();
    new.contact_opt_out := true;
    new.contact_opt_out_at := coalesce(new.contact_opt_out_at, now());
    new.notes := concat_ws(' | ', new.notes, 'Possible archived lead match: ' || matched_id || '. Outreach is blocked pending CRM review.');
  end if;
  return new;
end;
$$;

drop trigger if exists hrei_protect_archived_lead_match on public.leads;
create trigger hrei_protect_archived_lead_match
  before insert on public.leads
  for each row execute function public.hrei_protect_archived_lead_match();