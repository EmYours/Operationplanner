-- Paste this into the Supabase SQL Editor for project ndznuedhysjvpbuosikf.
-- It imports the unfinished operations plan for October 6, 2026.
-- The script is idempotent for the listed vehicles/tasks, so re-running it will not create duplicate work items.

begin;

create or replace function pg_temp.import_vehicle(
  p_vehicle_name text,
  p_color text,
  p_package_label text,
  p_team_id uuid,
  p_ingress timestamptz,
  p_expected_release timestamptz,
  p_status text,
  p_notes text,
  p_created_by uuid
) returns uuid
language plpgsql
as $$
declare
  existing_id uuid;
begin
  select id into existing_id
  from public.vehicles
  where vehicle_name = p_vehicle_name
    and coalesce(package_label, '') = coalesce(p_package_label, '')
    and coalesce(color, '') = coalesce(p_color, '')
    and overall_status <> 'Released'
    and (
      ingress_datetime is null
      or p_ingress is null
      or (ingress_datetime at time zone 'Asia/Manila')::date = (p_ingress at time zone 'Asia/Manila')::date
    )
  order by created_at desc
  limit 1;

  if existing_id is not null then
    return existing_id;
  end if;

  insert into public.vehicles (
    vehicle_name,
    color,
    package_label,
    team_id,
    ingress_datetime,
    expected_release_datetime,
    overall_status,
    notes,
    created_by
  )
  values (
    p_vehicle_name,
    coalesce(p_color, ''),
    coalesce(p_package_label, ''),
    p_team_id,
    p_ingress,
    p_expected_release,
    p_status,
    coalesce(p_notes, ''),
    p_created_by
  )
  returning id into existing_id;

  return existing_id;
end;
$$;

create or replace function pg_temp.import_task(
  p_vehicle_id uuid,
  p_task_name text,
  p_status text default 'Pending',
  p_notes text default ''
) returns void
language plpgsql
as $$
declare
  next_order integer;
begin
  if exists (
    select 1
    from public.vehicle_tasks
    where vehicle_id = p_vehicle_id
      and lower(task_name) = lower(p_task_name)
  ) then
    return;
  end if;

  select coalesce(max(sort_order), -1) + 1
  into next_order
  from public.vehicle_tasks
  where vehicle_id = p_vehicle_id;

  insert into public.vehicle_tasks (vehicle_id, task_name, status, sort_order, notes)
  values (p_vehicle_id, p_task_name, p_status, next_order, coalesce(p_notes, ''));
end;
$$;

do $$
declare
  manager_id uuid;
  team_a uuid;
  team_b uuid;
  team_c uuid;
  helper uuid;
  v uuid;
  plan_text text := $plan$
PLAN FOR OCTOBER 6, 2026

Pending
1. STARIA SPF89 Team A/ Helper
- Ongoing buffing
- For coating
- For release October 7, 11am

2. TOYOTA 86 Team B
- For sanding & buffing
- For molding installation
- For alignment
- For degrime
- For release October 6, 4pm

3. TESLA WHITE (Bruno)
- For PPF Checking
- For final checking
- For release October 6, 5pm

4. TESLA BLACK Helper
- For Tint 9am
- For detailing
- For Full PPF

5. MITSUBISHI XPANDER GRAY
- Done tint
- For undercoat
- For detailing

6. PICANTO BLACK Team C
- Ongoing buffing
- For coating
- For release October 6, 5pm

Ingress
1. TESLA MODEL Y WHITE Helper - REBOOST 1
2. SUBARU CROSSTREK BLUE - For full PPF (vinylfrog) - for undercoat - for alignment
3. CHEVROLET SPF89 - For detailing
4. MUSTANG WHITE (RJ) - PPF Checking
5. TESLA MODEL Y WHITE SPF99 - For detailing
6. NISSAN NAVARA RED SPF99 - For detailing
7. PAJERO BLACK - Window tint 1pm
8. PCX 160 SPF99 Team A - For detailing
9. MUX - For tint 1pm

Assigned to laundry: Apo & Bryan
Good job today!
$plan$;
begin
  select id into manager_id
  from public.profiles
  where role = 'operations_manager'
  order by created_at
  limit 1;

  if manager_id is null then
    raise exception 'No operations_manager profile exists. Create a manager Auth user and public.profiles row first.';
  end if;

  select id into team_a from public.teams where lower(name) = 'team a' limit 1;
  select id into team_b from public.teams where lower(name) = 'team b' limit 1;
  select id into team_c from public.teams where lower(name) = 'team c' limit 1;
  select id into helper from public.teams where lower(name) = 'helper' limit 1;

  v := pg_temp.import_vehicle('STARIA', '', 'SPF89', team_a, '2026-10-06 08:00+08', '2026-10-07 11:00+08', 'In Progress', 'Imported from unfinished October 6 plan. Helper also assigned.', manager_id);
  perform pg_temp.import_task(v, 'Buffing', 'Ongoing');
  perform pg_temp.import_task(v, 'Coating', 'Pending');

  v := pg_temp.import_vehicle('TOYOTA 86', '', '', team_b, '2026-10-06 08:00+08', '2026-10-06 16:00+08', 'Pending', 'Imported from unfinished October 6 plan.', manager_id);
  perform pg_temp.import_task(v, 'Sanding & buffing', 'Pending');
  perform pg_temp.import_task(v, 'Molding installation', 'Pending');
  perform pg_temp.import_task(v, 'Alignment', 'Pending');
  perform pg_temp.import_task(v, 'Degrime', 'Pending');

  v := pg_temp.import_vehicle('TESLA', 'White', '', null, '2026-10-06 08:00+08', '2026-10-06 17:00+08', 'Final Checking', 'Bruno. Imported from unfinished October 6 plan.', manager_id);
  perform pg_temp.import_task(v, 'PPF checking', 'Pending');
  perform pg_temp.import_task(v, 'Final checking', 'Pending');

  v := pg_temp.import_vehicle('TESLA', 'Black', '', helper, '2026-10-06 09:00+08', null, 'Pending', 'Imported from unfinished October 6 plan.', manager_id);
  perform pg_temp.import_task(v, 'Tint 9am', 'Pending');
  perform pg_temp.import_task(v, 'Detailing', 'Pending');
  perform pg_temp.import_task(v, 'Full PPF', 'Pending');

  v := pg_temp.import_vehicle('MITSUBISHI XPANDER', 'Gray', '', null, '2026-10-06 08:00+08', null, 'Pending', 'Imported from unfinished October 6 plan.', manager_id);
  perform pg_temp.import_task(v, 'Tint', 'Done');
  perform pg_temp.import_task(v, 'Undercoat', 'Pending');
  perform pg_temp.import_task(v, 'Detailing', 'Pending');

  v := pg_temp.import_vehicle('PICANTO', 'Black', '', team_c, '2026-10-06 08:00+08', '2026-10-06 17:00+08', 'In Progress', 'Imported from unfinished October 6 plan.', manager_id);
  perform pg_temp.import_task(v, 'Buffing', 'Ongoing');
  perform pg_temp.import_task(v, 'Coating', 'Pending');

  v := pg_temp.import_vehicle('TESLA MODEL Y', 'White', 'REBOOST 1', helper, '2026-10-06 09:00+08', null, 'Ingress', 'Imported from October 6 ingress list.', manager_id);

  v := pg_temp.import_vehicle('SUBARU CROSSTREK', 'Blue', 'Full PPF (vinylfrog)', null, '2026-10-06 09:00+08', null, 'Ingress', 'Imported from October 6 ingress list.', manager_id);
  perform pg_temp.import_task(v, 'Full PPF (vinylfrog)', 'Pending');
  perform pg_temp.import_task(v, 'Undercoat', 'Pending');
  perform pg_temp.import_task(v, 'Alignment', 'Pending');

  v := pg_temp.import_vehicle('CHEVROLET', '', 'SPF89', null, '2026-10-06 09:00+08', null, 'Ingress', 'Imported from October 6 ingress list.', manager_id);
  perform pg_temp.import_task(v, 'Detailing', 'Pending');

  v := pg_temp.import_vehicle('MUSTANG', 'White', '', null, '2026-10-06 09:00+08', null, 'Ingress', 'RJ. Imported from October 6 ingress list.', manager_id);
  perform pg_temp.import_task(v, 'PPF checking', 'Pending');

  v := pg_temp.import_vehicle('TESLA MODEL Y', 'White', 'SPF99', null, '2026-10-06 09:00+08', null, 'Ingress', 'Imported from October 6 ingress list.', manager_id);
  perform pg_temp.import_task(v, 'Detailing', 'Pending');

  v := pg_temp.import_vehicle('NISSAN NAVARA', 'Red', 'SPF99', null, '2026-10-06 09:00+08', null, 'Ingress', 'Imported from October 6 ingress list.', manager_id);
  perform pg_temp.import_task(v, 'Detailing', 'Pending');

  v := pg_temp.import_vehicle('PAJERO', 'Black', '', null, '2026-10-06 13:00+08', null, 'Ingress', 'Imported from October 6 ingress list.', manager_id);
  perform pg_temp.import_task(v, 'Window tint 1pm', 'Pending');

  v := pg_temp.import_vehicle('PCX 160', '', 'SPF99', team_a, '2026-10-06 09:00+08', null, 'Ingress', 'Imported from October 6 ingress list.', manager_id);
  perform pg_temp.import_task(v, 'Detailing', 'Pending');

  v := pg_temp.import_vehicle('MUX', '', '', null, '2026-10-06 13:00+08', null, 'Ingress', 'Imported from October 6 ingress list.', manager_id);
  perform pg_temp.import_task(v, 'Tint 1pm', 'Pending');

  if not exists (
    select 1
    from public.daily_plans
    where plan_date = date '2026-10-06'
      and generated_text like '%PLAN FOR OCTOBER 6, 2026%'
  ) then
    insert into public.daily_plans (plan_date, generated_text, created_by)
    values (date '2026-10-06', plan_text, manager_id);
  end if;
end;
$$;

commit;
