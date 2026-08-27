-- Allow the public cash-buyer form to work whether the visitor is signed out
-- or has an existing HREI session in the same browser.
drop policy if exists "Public can submit cash buyer intake" on public.cash_buyers;

create policy "Public can submit cash buyer intake"
  on public.cash_buyers for insert to anon, authenticated
  with check (
    status = 'new'
    and source = 'Buyer Intake Page'
    and full_name is not null
  );
