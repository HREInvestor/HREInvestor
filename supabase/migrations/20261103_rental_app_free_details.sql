alter table public.rental_applications add column if not exists application_details jsonb;
alter table public.rental_applications alter column application_fee_cents set default 0;
alter table public.rental_applications drop constraint if exists rental_applications_payment_status_check;
alter table public.rental_applications add constraint rental_applications_payment_status_check check (payment_status = any (array['pending_payment','paid','failed','canceled','not_required']));
update public.rental_properties set application_fee_cents=0 where slug='3506-gay-st-nw';
