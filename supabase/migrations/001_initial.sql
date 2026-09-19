begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'operations_manager' check (role = 'operations_manager'),
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index teams_name_unique on public.teams (lower(name));

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  vehicle_name text not null check (length(trim(vehicle_name)) between 1 and 120),
  color text not null default '' check (length(color) <= 80),
  package_label text not null default '' check (length(package_label) <= 160),
  team_id uuid references public.teams(id) on delete restrict,
  ingress_datetime timestamptz,
  expected_release_datetime timestamptz,
  actual_release_datetime timestamptz,
  overall_status text not null default 'Pending' check (overall_status in ('Ingress','Pending','In Progress','Final Checking','Ready for Release','Released')),
  notes text not null default '' check (length(notes) <= 5000),
  is_archived boolean not null default false,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_release_schedule check (expected_release_datetime >= ingress_datetime),
  constraint valid_actual_release check (actual_release_datetime >= ingress_datetime),
  constraint released_has_actual_time check ((overall_status = 'Released') = (actual_release_datetime is not null))
);
create index vehicles_active_release on public.vehicles (expected_release_datetime) where not is_archived and overall_status <> 'Released';
create index vehicles_ingress on public.vehicles (ingress_datetime) where not is_archived;
create index vehicles_team on public.vehicles (team_id);
create index vehicles_created_by on public.vehicles (created_by);

create table public.vehicle_tasks (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  task_name text not null check (length(trim(task_name)) between 1 and 200),
  status text not null default 'Pending' check (status in ('Pending','Ongoing','Done','Blocked')),
  sort_order integer not null default 0 check (sort_order between 0 and 9999),
  notes text not null default '' check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vehicle_tasks_vehicle_order on public.vehicle_tasks (vehicle_id, sort_order);

create table public.daily_plans (
  id uuid primary key default gen_random_uuid(),
  plan_date date not null,
  generated_text text not null check (length(trim(generated_text)) between 1 and 200000),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index daily_plans_date on public.daily_plans (plan_date desc, created_at desc);
create index daily_plans_created_by on public.daily_plans (created_by);

-- Profiles are provisioned by the administrator. Login alone never grants shop access.
create function public.is_operations_manager() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.profiles where id = auth.uid() and role = 'operations_manager'); $$;
revoke all on function public.is_operations_manager() from public;
grant execute on function public.is_operations_manager() to authenticated;

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.vehicles enable row level security;
alter table public.vehicle_tasks enable row level security;
alter table public.daily_plans enable row level security;

revoke all on public.profiles, public.teams, public.vehicles, public.vehicle_tasks, public.daily_plans from anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update on public.teams, public.vehicles to authenticated;
grant select, insert, update, delete on public.vehicle_tasks to authenticated;
grant select, insert on public.daily_plans to authenticated;

create policy profiles_read_self on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy teams_read on public.teams for select to authenticated using ((select public.is_operations_manager()));
create policy teams_insert on public.teams for insert to authenticated with check ((select public.is_operations_manager()));
create policy teams_update on public.teams for update to authenticated using ((select public.is_operations_manager())) with check ((select public.is_operations_manager()));
create policy vehicles_read on public.vehicles for select to authenticated using ((select public.is_operations_manager()));
create policy vehicles_insert on public.vehicles for insert to authenticated with check ((select public.is_operations_manager()) and created_by = (select auth.uid()));
create policy vehicles_update on public.vehicles for update to authenticated using ((select public.is_operations_manager())) with check ((select public.is_operations_manager()));
create policy tasks_manager on public.vehicle_tasks for all to authenticated using ((select public.is_operations_manager())) with check ((select public.is_operations_manager()));
create policy plans_read on public.daily_plans for select to authenticated using ((select public.is_operations_manager()));
create policy plans_insert on public.daily_plans for insert to authenticated with check ((select public.is_operations_manager()) and created_by = (select auth.uid()));

create function public.guard_vehicle() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' then
    if old.overall_status = 'Released' then raise exception 'Released vehicles are read-only.'; end if;
    if new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at or new.id is distinct from old.id then
      raise exception 'Vehicle ownership and creation fields cannot be changed.';
    end if;
    if new.overall_status = 'Released' and old.overall_status <> 'Ready for Release' then
      raise exception 'Mark the vehicle ready before recording release.';
    end if;
  elsif new.overall_status = 'Released' then
    raise exception 'Create a vehicle before recording its release.';
  end if;
  if new.actual_release_datetime > now() then raise exception 'Actual release cannot be in the future.'; end if;
  if new.overall_status in ('Ready for Release', 'Released') and exists (select 1 from public.vehicle_tasks where vehicle_id = new.id and status <> 'Done') then
    raise exception 'Complete all work items before marking the vehicle ready or released.';
  end if;
  new.updated_at = clock_timestamp();
  return new;
end;
$$;
create trigger vehicles_guard before insert or update on public.vehicles for each row execute function public.guard_vehicle();

create function public.guard_task() returns trigger
language plpgsql set search_path = '' as $$
declare parent_status text;
begin
  if TG_OP = 'UPDATE' and (new.vehicle_id is distinct from old.vehicle_id or new.id is distinct from old.id or new.created_at is distinct from old.created_at) then
    raise exception 'Task vehicle and creation fields cannot be changed.';
  end if;
  -- Serialize work-item edits and vehicle handover against the same parent lock.
  select overall_status into parent_status from public.vehicles where id = case when TG_OP = 'DELETE' then old.vehicle_id else new.vehicle_id end for update;
  if not found then raise exception 'Vehicle unavailable.'; end if;
  if parent_status = 'Released' then raise exception 'Work items on a released vehicle are read-only.'; end if;
  if TG_OP = 'DELETE' then return old; end if;
  new.updated_at = clock_timestamp();
  return new;
end;
$$;
create trigger tasks_guard before insert or update or delete on public.vehicle_tasks for each row execute function public.guard_task();

create function public.sync_vehicle_task_state() returns trigger
language plpgsql set search_path = '' as $$
declare parent_id uuid;
begin
  parent_id = case when TG_OP = 'DELETE' then old.vehicle_id else new.vehicle_id end;
  update public.vehicles set overall_status = case
    when overall_status = 'Ready for Release' and exists(select 1 from public.vehicle_tasks where vehicle_id = parent_id and status <> 'Done') then 'In Progress'
    when overall_status in ('Ingress','Pending') and exists(select 1 from public.vehicle_tasks where vehicle_id = parent_id and status = 'Ongoing') then 'In Progress'
    else overall_status end
  where id = parent_id;
  return null;
end;
$$;
create trigger tasks_sync after insert or update or delete on public.vehicle_tasks for each row execute function public.sync_vehicle_task_state();

-- Create a vehicle and its initial work items in one transaction, or edit only allowed fields.
-- A stale version is rejected so a second tab cannot silently overwrite a newer job update.
create function public.save_vehicle(p_id uuid, p_values jsonb, p_tasks jsonb default '[]'::jsonb, p_version timestamptz default null) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare result_id uuid; current_vehicle public.vehicles; task text; position integer = 0;
begin
  if not public.is_operations_manager() then raise exception 'Operations Manager access required.'; end if;
  if jsonb_typeof(p_tasks) <> 'array' or jsonb_array_length(p_tasks) > 100 then raise exception 'Use up to 100 initial work items.'; end if;
  if p_values->>'overall_status' = 'Released' or p_values ? 'actual_release_datetime' then raise exception 'Use Record release to release a vehicle.'; end if;
  if p_id is null then
    insert into public.vehicles(vehicle_name,color,package_label,team_id,ingress_datetime,expected_release_datetime,overall_status,notes)
    values (p_values->>'vehicle_name',coalesce(p_values->>'color',''),coalesce(p_values->>'package_label',''),(p_values->>'team_id')::uuid,(p_values->>'ingress_datetime')::timestamptz,(p_values->>'expected_release_datetime')::timestamptz,coalesce(p_values->>'overall_status','Pending'),coalesce(p_values->>'notes','')) returning id into result_id;
    if p_values->>'overall_status' = 'Ready for Release' and jsonb_array_length(p_tasks) > 0 then raise exception 'Complete work items before marking ready.'; end if;
    for task in select jsonb_array_elements_text(p_tasks) loop
      insert into public.vehicle_tasks(vehicle_id,task_name,sort_order) values(result_id,task,position);
      position = position + 1;
    end loop;
  else
    select * into current_vehicle from public.vehicles where id = p_id for update;
    if not found then raise exception 'Vehicle unavailable.'; end if;
    if p_version is null or current_vehicle.updated_at <> p_version then raise exception 'This job changed in another session. Refresh and try again.'; end if;
    update public.vehicles set
      vehicle_name = case when p_values ? 'vehicle_name' then p_values->>'vehicle_name' else vehicle_name end,
      color = case when p_values ? 'color' then p_values->>'color' else color end,
      package_label = case when p_values ? 'package_label' then p_values->>'package_label' else package_label end,
      team_id = case when p_values ? 'team_id' then (p_values->>'team_id')::uuid else team_id end,
      ingress_datetime = case when p_values ? 'ingress_datetime' then (p_values->>'ingress_datetime')::timestamptz else ingress_datetime end,
      expected_release_datetime = case when p_values ? 'expected_release_datetime' then (p_values->>'expected_release_datetime')::timestamptz else expected_release_datetime end,
      overall_status = case when p_values ? 'overall_status' then p_values->>'overall_status' else overall_status end,
      notes = case when p_values ? 'notes' then p_values->>'notes' else notes end
    where id = p_id;
    result_id = p_id;
  end if;
  return result_id;
end;
$$;

create function public.release_vehicle(p_id uuid, p_actual timestamptz, p_version timestamptz) returns void
language plpgsql security invoker set search_path = '' as $$
declare current_vehicle public.vehicles;
begin
  if not public.is_operations_manager() then raise exception 'Operations Manager access required.'; end if;
  select * into current_vehicle from public.vehicles where id = p_id for update;
  if not found then raise exception 'Vehicle unavailable.'; end if;
  if p_version is null or current_vehicle.updated_at <> p_version then raise exception 'This job changed in another session. Refresh and try again.'; end if;
  if current_vehicle.overall_status <> 'Ready for Release' then raise exception 'Mark the vehicle ready before recording release.'; end if;
  if p_actual is null then raise exception 'Actual release time is required.'; end if;
  update public.vehicles set overall_status = 'Released', actual_release_datetime = p_actual where id = p_id;
end;
$$;

revoke all on function public.save_vehicle(uuid,jsonb,jsonb,timestamptz) from public;
revoke all on function public.release_vehicle(uuid,timestamptz,timestamptz) from public;
revoke all on function public.guard_vehicle(), public.guard_task(), public.sync_vehicle_task_state() from public;
grant execute on function public.save_vehicle(uuid,jsonb,jsonb,timestamptz), public.release_vehicle(uuid,timestamptz,timestamptz) to authenticated;

insert into public.teams(name) values ('Team A'),('Team B'),('Team C'),('Helper'),('Unassigned');
commit;
