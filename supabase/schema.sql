-- Territorio 360 · backend mínimo para una beta privada.
-- Ejecutar completo en el SQL Editor de un proyecto nuevo de Supabase.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 30),
  city text not null default '' check (char_length(city) <= 50),
  color text not null default '#4ce0b3' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  invite_code text not null unique check (invite_code ~ '^[A-Z0-9]{8}$'),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id),
  unique (user_id)
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  client_activity_id text not null check (char_length(client_activity_id) between 1 and 100),
  mode text not null check (mode in ('run', 'walk', 'bike', 'swim')),
  source text not null default 'gps' check (char_length(source) <= 40),
  start_time timestamptz not null,
  end_time timestamptz not null,
  distance_m integer not null default 0 check (distance_m >= 0),
  new_area_sqm integer not null default 0 check (new_area_sqm >= 0),
  new_linear_m integer not null default 0 check (new_linear_m >= 0),
  conquest_points integer not null default 0 check (conquest_points >= 0),
  route_type text not null check (route_type in ('area', 'line')),
  public_path jsonb check (
    public_path is null or (
      jsonb_typeof(public_path) = 'array'
      and jsonb_array_length(public_path) between 2 and 400
    )
  ),
  created_at timestamptz not null default now(),
  unique (user_id, client_activity_id)
);

create index if not exists group_members_user_idx on public.group_members(user_id);
create index if not exists activities_group_time_idx on public.activities(group_id, start_time desc);
create index if not exists activities_user_idx on public.activities(user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, city)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'Explorador'), 30),
    left(coalesce(trim(new.raw_user_meta_data ->> 'city'), ''), 50)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create schema if not exists private;

create or replace function private.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = (select auth.uid())
  );
$$;

create or replace function private.shares_group(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_user_id
  );
$$;

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.activities enable row level security;

drop policy if exists "profiles visible to same group" on public.profiles;
create policy "profiles visible to same group"
on public.profiles for select to authenticated
using ((select auth.uid()) = id or private.shares_group(id));

drop policy if exists "users insert own profile" on public.profiles;
create policy "users insert own profile"
on public.profiles for insert to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "members see their groups" on public.groups;
create policy "members see their groups"
on public.groups for select to authenticated
using (private.is_group_member(id));

drop policy if exists "members see memberships" on public.group_members;
create policy "members see memberships"
on public.group_members for select to authenticated
using (private.is_group_member(group_id));

drop policy if exists "members see group activities" on public.activities;
create policy "members see group activities"
on public.activities for select to authenticated
using (private.is_group_member(group_id));

drop policy if exists "users add own group activities" on public.activities;
create policy "users add own group activities"
on public.activities for insert to authenticated
with check ((select auth.uid()) = user_id and private.is_group_member(group_id));

drop policy if exists "users update own group activities" on public.activities;
create policy "users update own group activities"
on public.activities for update to authenticated
using ((select auth.uid()) = user_id and private.is_group_member(group_id))
with check ((select auth.uid()) = user_id and private.is_group_member(group_id));

drop policy if exists "users delete own group activities" on public.activities;
create policy "users delete own group activities"
on public.activities for delete to authenticated
using ((select auth.uid()) = user_id and private.is_group_member(group_id));

create or replace function public.create_trial_group(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  new_group public.groups;
  clean_name text := left(trim(p_name), 40);
begin
  if current_user_id is null then raise exception 'Debes iniciar sesión'; end if;
  if clean_name is null or clean_name = '' then raise exception 'Escribe un nombre para el grupo'; end if;
  if exists (select 1 from public.group_members where user_id = current_user_id) then
    raise exception 'Ya perteneces a un grupo';
  end if;

  insert into public.profiles (id, display_name)
  values (current_user_id, 'Explorador')
  on conflict (id) do nothing;

  insert into public.groups (name, invite_code, created_by)
  values (
    clean_name,
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    current_user_id
  )
  returning * into new_group;

  insert into public.group_members (group_id, user_id)
  values (new_group.id, current_user_id);

  return jsonb_build_object('id', new_group.id, 'name', new_group.name, 'invite_code', new_group.invite_code);
end;
$$;

create or replace function public.join_group_by_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_group public.groups;
  current_group_id uuid;
begin
  if current_user_id is null then raise exception 'Debes iniciar sesión'; end if;

  select * into target_group
  from public.groups
  where invite_code = upper(trim(p_code));
  if target_group.id is null then raise exception 'Código de invitación no válido'; end if;

  select group_id into current_group_id
  from public.group_members where user_id = current_user_id;
  if current_group_id is not null and current_group_id <> target_group.id then
    raise exception 'Ya perteneces a otro grupo';
  end if;

  insert into public.profiles (id, display_name)
  values (current_user_id, 'Explorador')
  on conflict (id) do nothing;

  insert into public.group_members (group_id, user_id)
  values (target_group.id, current_user_id)
  on conflict (group_id, user_id) do nothing;

  return jsonb_build_object('id', target_group.id, 'name', target_group.name, 'invite_code', target_group.invite_code);
end;
$$;

revoke all on schema private from public, anon, authenticated;
revoke all on function private.is_group_member(uuid) from public, anon;
revoke all on function private.shares_group(uuid) from public, anon;
grant execute on function private.is_group_member(uuid) to authenticated;
grant execute on function private.shares_group(uuid) to authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on public.profiles, public.groups, public.group_members, public.activities from anon, authenticated;
grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.groups, public.group_members to authenticated;
grant select, insert, update, delete on public.activities to authenticated;
revoke all on function public.create_trial_group(text) from public, anon;
revoke all on function public.join_group_by_code(text) from public, anon;
grant execute on function public.create_trial_group(text) to authenticated;
grant execute on function public.join_group_by_code(text) to authenticated;
