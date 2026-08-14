-- Store the Microsoft 365 connection server-side. No browser policy grants access to these credentials.
create table if not exists public.microsoft_email_connections (
  id boolean primary key default true check (id),
  sender_email text not null,
  refresh_token text not null,
  token_expires_at timestamptz,
  connected_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.microsoft_email_connections enable row level security;
revoke all on public.microsoft_email_connections from anon, authenticated;

drop trigger if exists microsoft_email_connections_updated_at on public.microsoft_email_connections;
create trigger microsoft_email_connections_updated_at
  before update on public.microsoft_email_connections
  for each row execute procedure public.set_member_profile_updated_at();
