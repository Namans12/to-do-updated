create extension if not exists "pgcrypto";

create table if not exists public.groups (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.todos (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id text not null references public.groups(id) on delete cascade,
  title text not null,
  description text,
  high_priority integer not null default 0,
  reminder_at timestamptz,
  recurrence_rule text check (recurrence_rule in ('daily', 'weekly', 'monthly') or recurrence_rule is null),
  recurrence_enabled integer not null default 0,
  next_occurrence_at timestamptz,
  is_completed integer not null default 0,
  completed_at timestamptz,
  position integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.todos drop column if exists parent_todo_id;
alter table public.todos drop column if exists planning_level;

create table if not exists public.connections (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  kind text not null default 'sequence' check (kind in ('sequence', 'branch', 'dependency', 'related')),
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.connection_items (
  id text primary key,
  connection_id text not null references public.connections(id) on delete cascade,
  todo_id text not null references public.todos(id) on delete cascade,
  parent_todo_id text,
  position integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  unique (todo_id)
);

alter table public.connection_items add column if not exists parent_todo_id text;

create table if not exists public.activity_logs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  summary text not null,
  payload_json jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists groups_user_position_idx on public.groups(user_id, position);
create unique index if not exists groups_user_name_unique
on public.groups(user_id, lower(name));
create index if not exists todos_user_group_position_idx on public.todos(user_id, group_id, position);
create index if not exists todos_user_deleted_idx on public.todos(user_id, deleted_at);
create unique index if not exists todos_user_group_title_active_unique
on public.todos(user_id, group_id, lower(title))
where deleted_at is null;
create index if not exists connections_user_created_idx on public.connections(user_id, created_at);
create index if not exists connection_items_connection_position_idx on public.connection_items(connection_id, position);
create index if not exists activity_logs_user_created_idx on public.activity_logs(user_id, created_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists touch_groups_updated_at on public.groups;
create trigger touch_groups_updated_at
before update on public.groups
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_todos_updated_at on public.todos;
create trigger touch_todos_updated_at
before update on public.todos
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_connections_updated_at on public.connections;
create trigger touch_connections_updated_at
before update on public.connections
for each row execute procedure public.touch_updated_at();

alter table public.groups enable row level security;
alter table public.todos enable row level security;
alter table public.connections enable row level security;
alter table public.connection_items enable row level security;
alter table public.activity_logs enable row level security;

drop policy if exists "groups_select_own" on public.groups;
create policy "groups_select_own" on public.groups
for select using (auth.uid() = user_id);
drop policy if exists "groups_insert_own" on public.groups;
create policy "groups_insert_own" on public.groups
for insert with check (auth.uid() = user_id);
drop policy if exists "groups_update_own" on public.groups;
create policy "groups_update_own" on public.groups
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "groups_delete_own" on public.groups;
create policy "groups_delete_own" on public.groups
for delete using (auth.uid() = user_id);

drop policy if exists "todos_select_own" on public.todos;
create policy "todos_select_own" on public.todos
for select using (auth.uid() = user_id);
drop policy if exists "todos_insert_own" on public.todos;
create policy "todos_insert_own" on public.todos
for insert with check (auth.uid() = user_id);
drop policy if exists "todos_update_own" on public.todos;
create policy "todos_update_own" on public.todos
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "todos_delete_own" on public.todos;
create policy "todos_delete_own" on public.todos
for delete using (auth.uid() = user_id);

drop policy if exists "connections_select_own" on public.connections;
create policy "connections_select_own" on public.connections
for select using (auth.uid() = user_id);
drop policy if exists "connections_insert_own" on public.connections;
create policy "connections_insert_own" on public.connections
for insert with check (auth.uid() = user_id);
drop policy if exists "connections_update_own" on public.connections;
create policy "connections_update_own" on public.connections
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "connections_delete_own" on public.connections;
create policy "connections_delete_own" on public.connections
for delete using (auth.uid() = user_id);

drop policy if exists "connection_items_select_own" on public.connection_items;
create policy "connection_items_select_own" on public.connection_items
for select using (
  exists (
    select 1
    from public.connections c
    where c.id = connection_items.connection_id
      and c.user_id = auth.uid()
  )
);
drop policy if exists "connection_items_insert_own" on public.connection_items;
create policy "connection_items_insert_own" on public.connection_items
for insert with check (
  exists (
    select 1
    from public.connections c
    where c.id = connection_items.connection_id
      and c.user_id = auth.uid()
  )
);
drop policy if exists "connection_items_update_own" on public.connection_items;
create policy "connection_items_update_own" on public.connection_items
for update using (
  exists (
    select 1
    from public.connections c
    where c.id = connection_items.connection_id
      and c.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.connections c
    where c.id = connection_items.connection_id
      and c.user_id = auth.uid()
  )
);
drop policy if exists "connection_items_delete_own" on public.connection_items;
create policy "connection_items_delete_own" on public.connection_items
for delete using (
  exists (
    select 1
    from public.connections c
    where c.id = connection_items.connection_id
      and c.user_id = auth.uid()
  )
);

drop policy if exists "activity_logs_select_own" on public.activity_logs;
create policy "activity_logs_select_own" on public.activity_logs
for select using (auth.uid() = user_id);
drop policy if exists "activity_logs_insert_own" on public.activity_logs;
create policy "activity_logs_insert_own" on public.activity_logs
for insert with check (auth.uid() = user_id);
