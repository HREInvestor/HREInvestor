-- HREI manual member approval: access is controlled by the Owner, not payments.
-- Run after the existing HREI member-profile migration.

alter table public.member_profiles
  add column if not exists access_status text not null default 'pending'
    check (access_status in ('pending', 'approved', 'suspended'));

-- Keep everyone who already had an account active. New accounts will be pending.
update public.member_profiles
set access_status = 'approved'
where access_status = 'pending';

update public.member_profiles
set access_status = 'approved', subscription_status = 'not_required'
where email = 'office@hreinvestor.com';

create or replace function public.create_hrei_member_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.member_profiles (id, email, role, subscription_status, access_status)
  values (
    new.id,
    lower(new.email),
    case when lower(new.email) = 'office@hreinvestor.com' then 'owner' else 'investor' end,
    'not_required',
    case when lower(new.email) = 'office@hreinvestor.com' then 'approved' else 'pending' end
  )
  on conflict (id) do update
  set email = excluded.email,
      updated_at = now();
  return new;
end;
$$;