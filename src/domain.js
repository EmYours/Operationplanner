export const TASK_STATUSES = ["Pending", "Ongoing", "Done", "Blocked"];
export const VEHICLE_STATUSES = [
  "Ingress",
  "Pending",
  "In Progress",
  "Final Checking",
  "Ready for Release",
  "Released",
];
export const TIMEZONE = import.meta.env?.VITE_SHOP_TIMEZONE || "Asia/Manila";
export const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
export function dateKey(value = new Date()) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function addDays(key, days) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function localInput(value) {
  if (!value) return "";
  return `${dateKey(value)}T${new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value))}`;
}
export function toISO(value) {
  if (!value) return null;
  const target = new Date(`${value}:00Z`).getTime();
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const shown = new Date(`${localInput(guess)}:00Z`).getTime();
    guess += target - shown;
  }
  if (!Number.isFinite(guess) || localInput(guess) !== value)
    throw new Error("Enter a valid date and time.");
  return new Date(guess).toISOString();
}
export function formatDate(value, options = {}) {
  return value
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: TIMEZONE,
        month: "short",
        day: "numeric",
        ...options,
      }).format(new Date(value))
    : "Not scheduled";
}
export const formatTime = (value) =>
  value
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: TIMEZONE,
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";
export const activeVehicles = (vehicles) =>
  vehicles.filter((v) => !v.is_archived && v.overall_status !== "Released");
export const remaining = (vehicle) =>
  vehicle.tasks.filter((t) => t.status !== "Done").length;
export const isBlocked = (vehicle) =>
  vehicle.tasks.some((t) => t.status === "Blocked");
export const isInside = (v, now = new Date()) =>
  v.overall_status !== "Ingress" ||
  (!!v.ingress_datetime && new Date(v.ingress_datetime) <= now);
export function warnings(vehicle, now = new Date()) {
  if (vehicle.overall_status === "Released") return [];
  const result = [];
  const release = vehicle.expected_release_datetime;
  if (isBlocked(vehicle)) result.push("Blocked");
  if (release && new Date(release) < now) result.push("Overdue");
  else if (
    release &&
    new Date(release).getTime() - now.getTime() <= 86400000 &&
    remaining(vehicle) > 0 &&
    vehicle.overall_status !== "Ready for Release"
  )
    result.push("At risk");
  if (!release) result.push("Missing release");
  if (!vehicle.team_id || vehicle.team_name === "Unassigned")
    result.push("Unassigned team");
  return result;
}
export function matchesFilter(v, filter, now = new Date()) {
  const today = dateKey(now);
  if (filter === "All Active") return true;
  if (filter === "Releasing Today")
    return dateKey(v.expected_release_datetime) === today;
  if (filter === "Releasing Tomorrow")
    return dateKey(v.expected_release_datetime) === addDays(today, 1);
  if (filter === "Ongoing")
    return (
      v.overall_status === "In Progress" ||
      v.tasks.some((t) => t.status === "Ongoing")
    );
  if (filter === "Blocked") return isBlocked(v);
  if (filter === "Needs attention") return warnings(v, now).length > 0;
  return v.overall_status === filter;
}
export function generatePlan(vehicles, teams, planDate, now = new Date()) {
  const active = activeVehicles(vehicles);
  const relevant = active.filter(
    (v) => !v.ingress_datetime || dateKey(v.ingress_datetime) <= planDate,
  );
  const line = (v) =>
    `${v.vehicle_name}${v.color ? ` · ${v.color}` : ""} | ${v.package_label || "No package"} | ${teams.find((t) => t.id === v.team_id)?.name || "Unassigned"}`;
  const release = relevant
    .filter(
      (v) =>
        v.expected_release_datetime &&
        dateKey(v.expected_release_datetime) <= planDate,
    )
    .sort((a, b) =>
      a.expected_release_datetime.localeCompare(b.expected_release_datetime),
    );
  const ingress = active.filter(
    (v) => dateKey(v.ingress_datetime) === planDate,
  );
  const alerts = relevant.filter((v) => warnings(v, now).length);
  const lines = [
    "DAILY OPERATIONS PLAN",
    formatDate(`${planDate}T12:00:00Z`, { weekday: "long", year: "numeric" }),
    `Shop timezone: ${TIMEZONE}`,
    "",
    "RELEASES & CARRYOVERS",
    ...release.map(
      (v) =>
        `• ${line(v)} — ${dateKey(v.expected_release_datetime) < planDate ? "CARRYOVER · " : ""}${formatDate(v.expected_release_datetime)} ${formatTime(v.expected_release_datetime)} · ${v.overall_status}`,
    ),
    ...(release.length ? [] : ["No releases scheduled."]),
    "",
    "SCHEDULED INGRESS",
    ...ingress.map((v) => `• ${line(v)} — ${formatTime(v.ingress_datetime)}`),
    ...(ingress.length ? [] : ["No ingress scheduled."]),
    "",
    "TEAM WORK PLAN",
  ];
  for (const team of [...teams, { id: null, name: "Unassigned (no team)" }]) {
    const assigned = relevant.filter((v) => v.team_id === team.id);
    if (!assigned.length) continue;
    lines.push("", team.name.toUpperCase());
    for (const v of assigned) {
      lines.push(
        `• ${v.vehicle_name} · ${v.package_label || "No package"} · ${v.overall_status}`,
      );
      for (const task of [...v.tasks].sort(
        (a, b) => a.sort_order - b.sort_order,
      ))
        lines.push(
          `  [${task.status}] ${task.task_name}${task.notes ? ` — ${task.notes}` : ""}`,
        );
      if (!v.tasks.length) lines.push("  No work items added.");
      if (v.notes) lines.push(`  Notes: ${v.notes}`);
    }
  }
  lines.push(
    "",
    "ATTENTION REQUIRED",
    ...alerts.map((v) => `• ${v.vehicle_name}: ${warnings(v, now).join(", ")}`),
    ...(alerts.length ? [] : ["No active warnings."]),
  );
  return lines.join("\n");
}
