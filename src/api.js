import { createClient } from "@supabase/supabase-js";
import { createDemo } from "./demo.js";
import { TASK_STATUSES, remaining } from "./domain.js";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = Boolean(url && key);
export const demo =
  import.meta.env.VITE_DEMO_MODE === "true" ||
  (import.meta.env.DEV && !configured);
export const supabase =
  configured && !demo
    ? createClient(url, key, {
        auth: {
          storage: window.sessionStorage,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      })
    : null;
let memory = demo ? createDemo() : null;
function unwrap(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
async function allRows(queryFactory) {
  const rows = [];
  for (let from = 0; ; from += 500) {
    const batch = unwrap(await queryFactory().range(from, from + 499));
    rows.push(...batch);
    if (batch.length < 500) return rows;
  }
}
export async function loadData() {
  if (demo) return structuredClone(memory);
  const [teams, vehicles, tasks, plans] = await Promise.all([
    allRows(() =>
      supabase.from("teams").select("*").order("created_at").order("id"),
    ),
    allRows(() =>
      supabase
        .from("vehicles")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id"),
    ),
    allRows(() =>
      supabase
        .from("vehicle_tasks")
        .select("*")
        .order("sort_order")
        .order("id"),
    ),
    allRows(() =>
      supabase
        .from("daily_plans")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id"),
    ),
  ]);
  return {
    teams,
    vehicles: vehicles.map((v) => ({
      ...v,
      tasks: tasks.filter((t) => t.vehicle_id === v.id),
      team_name: teams.find((t) => t.id === v.team_id)?.name,
    })),
    plans,
  };
}
export async function saveVehicle(values, id, tasks = [], version = null) {
  if (demo) {
    if (id)
      Object.assign(
        memory.vehicles.find((v) => v.id === id),
        values,
        { updated_at: new Date().toISOString() },
      );
    else {
      id = crypto.randomUUID();
      memory.vehicles.unshift({
        ...values,
        id,
        is_archived: false,
        actual_release_datetime: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tasks: tasks.map((task_name, i) => ({
          id: crypto.randomUUID(),
          vehicle_id: id,
          task_name,
          status: "Pending",
          sort_order: i,
          notes: "",
        })),
      });
    }
    const saved = memory.vehicles.find((v) => v.id === id);
    saved.team_name = memory.teams.find((t) => t.id === saved.team_id)?.name;
    return id;
  }
  return unwrap(
    await supabase.rpc("save_vehicle", {
      p_id: id || null,
      p_values: values,
      p_tasks: tasks,
      p_version: version,
    }),
  );
}
export async function updateTask(task, patch) {
  if (patch.status && !TASK_STATUSES.includes(patch.status))
    throw new Error("Invalid task status.");
  if (demo) {
    const v = memory.vehicles.find((v) => v.id === task.vehicle_id);
    Object.assign(
      v.tasks.find((t) => t.id === task.id),
      patch,
    );
    if (v.overall_status === "Ready for Release" && remaining(v))
      v.overall_status = "In Progress";
    if (
      patch.status === "Ongoing" &&
      ["Pending", "Ingress"].includes(v.overall_status)
    )
      v.overall_status = "In Progress";
    v.updated_at = new Date().toISOString();
    return;
  }
  const result = await supabase
    .from("vehicle_tasks")
    .update(patch)
    .eq("id", task.id)
    .eq("updated_at", task.updated_at)
    .select()
    .maybeSingle();
  const changed = unwrap(result);
  if (!changed)
    throw new Error(
      "This task changed in another session. Refresh the board and try again.",
    );
}
export async function addTask(vehicleId, taskName, sortOrder) {
  if (demo) {
    const v = memory.vehicles.find((v) => v.id === vehicleId);
    v.tasks.push({
      id: crypto.randomUUID(),
      vehicle_id: vehicleId,
      task_name: taskName,
      status: "Pending",
      notes: "",
      sort_order: sortOrder,
    });
    if (v.overall_status === "Ready for Release")
      v.overall_status = "In Progress";
    v.updated_at = new Date().toISOString();
    return;
  }
  unwrap(
    await supabase
      .from("vehicle_tasks")
      .insert({
        vehicle_id: vehicleId,
        task_name: taskName,
        sort_order: sortOrder,
      }),
  );
}
export async function deleteTask(task) {
  if (demo) {
    const v = memory.vehicles.find((v) => v.id === task.vehicle_id);
    v.tasks = v.tasks.filter((t) => t.id !== task.id);
    v.updated_at = new Date().toISOString();
    return;
  }
  const changed = unwrap(
    await supabase
      .from("vehicle_tasks")
      .delete()
      .eq("id", task.id)
      .eq("updated_at", task.updated_at)
      .select()
      .maybeSingle(),
  );
  if (!changed)
    throw new Error(
      "This task changed in another session. Refresh the board and try again.",
    );
}
export async function releaseVehicle(id, actual, version) {
  if (demo) {
    const v = memory.vehicles.find((v) => v.id === id);
    if (remaining(v) || v.overall_status !== "Ready for Release")
      throw new Error("Complete work and mark the vehicle ready first.");
    Object.assign(v, {
      overall_status: "Released",
      actual_release_datetime: actual,
      updated_at: new Date().toISOString(),
    });
    return;
  }
  unwrap(
    await supabase.rpc("release_vehicle", {
      p_id: id,
      p_actual: actual,
      p_version: version,
    }),
  );
}
export async function savePlan(date, text, userId) {
  if (demo) {
    memory.plans.unshift({
      id: crypto.randomUUID(),
      plan_date: date,
      generated_text: text,
      created_at: new Date().toISOString(),
    });
    return;
  }
  unwrap(
    await supabase
      .from("daily_plans")
      .insert({ plan_date: date, generated_text: text, created_by: userId }),
  );
}
export async function addTeam(name) {
  if (demo) {
    if (memory.teams.some((t) => t.name.toLowerCase() === name.toLowerCase()))
      throw new Error("A team with that name already exists.");
    memory.teams.push({ id: crypto.randomUUID(), name, is_active: true });
    return;
  }
  unwrap(await supabase.from("teams").insert({ name }));
}
