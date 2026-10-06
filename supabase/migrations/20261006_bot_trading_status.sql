-- Owner-only Polymarket/Kalshi bot status snapshot (phone status page).
-- Write path: SECURITY DEFINER RPC with bot push token (hash stored here).
-- Never store API keys, wallet keys, or full trade logs in payload.

create extension if not exists pgcrypto;

create table if not exists public.bot_trading_status (
  id int primary key default 1 check (id = 1),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  source text not null default 'polymarketbot'
);

create table if not exists public.bot_push_secrets (
  id int primary key default 1 check (id = 1),
  token_hash text not null,
  label text not null default 'polymarketbot',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bot_trading_status enable row level security;
alter table public.bot_push_secrets enable row level security;

drop policy if exists "Owners read bot trading status" on public.bot_trading_status;
create policy "Owners read bot trading status"
  on public.bot_trading_status for select
  to authenticated
  using (public.is_hrei_owner());

-- No write policies for authenticated/anon on either table.
-- bot_push_secrets has no SELECT policy (token hash not readable via API).

create or replace function public.push_bot_trading_status(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  expected text;
  incoming text;
begin
  if p_token is null or length(trim(p_token)) < 32 then
    raise exception 'invalid token';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be a JSON object';
  end if;
  if p_payload ?| array['private_key','secret','api_key','api_secret','wallet','seed','mnemonic','service_role','token'] then
    raise exception 'payload must not include secrets';
  end if;

  select token_hash into expected from public.bot_push_secrets where id = 1;
  if expected is null then
    raise exception 'bot push token not configured';
  end if;

  incoming := encode(digest(convert_to(trim(p_token), 'utf8'), 'sha256'::text), 'hex');
  if incoming is distinct from expected then
    raise exception 'unauthorized';
  end if;

  insert into public.bot_trading_status (id, payload, updated_at, source)
  values (1, p_payload, now(), coalesce(p_payload->>'source', 'polymarketbot'))
  on conflict (id) do update
    set payload = excluded.payload,
        updated_at = now(),
        source = excluded.source;

  return jsonb_build_object('ok', true, 'updated_at', now());
end;
$$;

revoke all on function public.push_bot_trading_status(text, jsonb) from public;
grant execute on function public.push_bot_trading_status(text, jsonb) to anon, authenticated;

revoke all on table public.bot_push_secrets from public, anon, authenticated;
grant select on table public.bot_trading_status to authenticated;
