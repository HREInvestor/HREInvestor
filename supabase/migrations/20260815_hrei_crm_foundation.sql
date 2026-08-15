-- HREI CRM foundation: priorities, follow-ups, tasks, and activity history
-- Run after the existing 20260814 HREI migrations.

alter table public.leads
  add column if not exists priority text not null default 'warm'
    check (priority in ('hot', 'warm', 'cold')),
  add column if not exists next_follow_up_on date;

create index if not exists leads_pipeline_idx
  on public.leads(stage, priority, next_follow_up_on);

create table if not exists public.lead_tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id bigint not null references public.leads(id) on delete cascade,
  title text not null,
  due_on date,
  status text not null default 'open'
    check (status in ('open', 'completed')),
  created_by uuid references auth.users(id),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists lead_tasks_open_due_idx
  on public.lead_tasks(status, due_on, lead_id);

alter table public.lead_tasks enable row level security;

drop policy if exists "Owners manage lead tasks" on public.lead_tasks;
create policy "Owners manage lead tasks"
  on public.lead_tasks for all to authenticated
  using (public.is_hrei_owner())
  with check (public.is_hrei_owner());

create table if not exists public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id bigint not null references public.leads(id) on delete cascade,
  event_type text not null
    check (event_type in ('stage_changed', 'priority_changed', 'follow_up_set', 'task_created', 'note')),
  description text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists lead_activities_lead_id_idx
  on public.lead_activities(lead_id, created_at desc);

alter table public.lead_activities enable row level security;

drop policy if exists "Owners manage lead activities" on public.lead_activities;
create policy "Owners manage lead activities"
  on public.lead_activities for all to authenticated
  using (public.is_hrei_owner())
  with check (public.is_hrei_owner());
