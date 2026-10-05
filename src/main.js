import "./styles.css";
import { icon } from "./icons.js";
import {
  escapeHtml as e,
  TASK_STATUSES,
  VEHICLE_STATUSES,
  TIMEZONE,
  dateKey,
  addDays,
  formatDate,
  formatTime,
  localInput,
  toISO,
  activeVehicles,
  remaining,
  isBlocked,
  isInside,
  warnings,
  matchesFilter,
  generatePlan,
} from "./domain.js";
import * as api from "./api.js";

const app = document.querySelector("#app");
const modal = document.querySelector("#modal");
const state = {
  page: "board",
  filter: "All Active",
  team: "",
  search: "",
  sort: "priority",
  data: { vehicles: [], teams: [], plans: [] },
  selected: null,
  user: null,
  planDate: addDays(dateKey(), 1),
  planText: "",
  planSaved: false,
  planView: "preview",
  scheduleDate: dateKey(),
  historyTab: "vehicles",
  busy: false,
  synced: null,
  error: "",
  signedOutDemo: false,
};
const nav = [
  ["board", "board", "Operations Board"],
  ["schedule", "calendar", "Schedule"],
  ["teams", "teams", "Team Workload"],
  ["plan", "plan", "Daily Operations Plan"],
  ["history", "history", "History"],
];
const teamName = (v) =>
  state.data.teams.find((t) => t.id === v.team_id)?.name || "Unassigned";
const statusClass = (s) =>
  ({
    "In Progress": "ongoing",
    Ongoing: "ongoing",
    "Ready for Release": "ready",
    Done: "ready",
    "Final Checking": "checking",
    Blocked: "blocked",
    Ingress: "ingress",
    Released: "ready",
  })[s] || "pending";
const statusBadge = (s) =>
  `<span class="status ${statusClass(s)}"><span class="status-dot"></span>${e(s)}</span>`;
const teamMark = (name, index = 0) =>
  `<span class="team-mark team-${index % 5}">${e(name === "Unassigned" ? "—" : name === "Helper" ? "H" : name.replace("Team ", "").slice(0, 2))}</span>`;
function toast(message, error = false) {
  let el = document.querySelector("#toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
  }
  (modal.open ? modal : document.body).append(el);
  el.textContent = message;
  el.className = `visible${error ? " error" : ""}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.className = ""), 4500);
}
function empty(title, detail, action = "") {
  return `<div class="empty">${icon("car")}<h3>${e(title)}</h3><p>${e(detail)}</p>${action}</div>`;
}
function title(eyebrow, heading, subtitle, actions = "") {
  return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${heading}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`;
}
const addButton = () =>
  `<button class="button primary" data-action="add">${icon("plus")} Add vehicle</button>`;
function shell() {
  app.innerHTML = `<a class="skip-link" href="#main">Skip to workspace</a>
    <aside class="sidebar"><a class="brand" href="#board" aria-label="Detailing Operations Manager home"><img src="/icon.svg" alt=""/><span>DETAILING<span>OPERATIONS MANAGER</span></span></a>
    <div class="workspace-label">WORKSPACE</div><nav aria-label="Main navigation">${nav.map(([page, glyph, label]) => `<button class="nav-item ${state.page === page ? "active" : ""}" data-page="${page}" ${state.page === page ? 'aria-current="page"' : ""}>${icon(glyph)}<span>${label}</span>${page === "board" ? `<span class="nav-count">${activeVehicles(state.data.vehicles).length}</span>` : ""}</button>`).join("")}</nav>
    <div class="sidebar-bottom"><div class="shop-status"><span class="live-dot"></span> Shop data live<p>Refresh before major handovers.</p></div><button class="nav-item" data-action="help">${icon("help")} Quick guide</button><div class="profile"><span class="avatar">OM</span><div><strong>Operations Manager</strong><span>Shop workspace</span></div><button class="icon-button" data-action="logout" aria-label="Log out" title="Log out">${icon("logout")}</button></div></div></aside>
    <div class="workspace"><header class="topbar"><div class="breadcrumb">Workspace ${icon("chevron")} <strong>${nav.find((n) => n[0] === state.page)?.[2] || "Add Vehicle"}</strong></div><div class="topbar-right"><span class="sync-state"><span class="live-dot"></span>${api.demo ? "Demo workspace" : "Connected to shop"}</span><button class="top-avatar" data-action="account" aria-label="Account and help">OM</button></div></header>
    <main id="main" tabindex="-1">${api.demo ? '<div class="demo-banner"><span><strong>Demo mode</strong> · Explore with sample vehicles. Changes reset on refresh.</span><button data-action="setup">Connect your shop ' + icon("arrow") + "</button></div>" : ""}${!navigator.onLine ? '<div class="error-banner">You’re offline. Reconnect before saving changes.</div>' : ""}${state.error ? `<div class="error-banner" role="alert">${e(state.error)} <button data-action="refresh">Retry</button></div>` : ""}<div id="page-content">${pageContent()}</div><footer class="workspace-footer"><span>DETAILING <span class="footer-dot">·</span> Shop operations</span><span>${e(TIMEZONE)} ${icon("clock")}</span></footer></main></div>
    <nav class="mobile-nav" aria-label="Mobile navigation">${[
      ["board", "board", "Board"],
      ["add", "plus", "Add car"],
      ["plan", "plan", "Plan"],
      ["history", "history", "History"],
    ]
      .map(
        ([page, glyph, label]) =>
          `<button data-page="${page}" class="${state.page === page ? "active" : ""}" ${state.page === page ? 'aria-current="page"' : ""}>${icon(glyph)}<span>${label}</span></button>`,
      )
      .join("")}</nav>`;
  document.title = `${state.page === "board" ? "Operations Board" : state.page === "add" ? "Add Vehicle" : nav.find((n) => n[0] === state.page)?.[2]} · Detailing Operations Manager`;
}
function pageContent() {
  return (
    {
      board: boardPage,
      schedule: schedulePage,
      teams: teamsPage,
      plan: planPage,
      history: historyPage,
      add: addPage,
    }[state.page] || boardPage
  )();
}
function boardPage() {
  const active = activeVehicles(state.data.vehicles),
    today = dateKey();
  const metrics = [
    [
      "Active vehicles",
      active.length,
      "car",
      "All Active",
      `${active.filter((v) => isInside(v)).length} currently in the shop`,
    ],
    [
      "Releasing today",
      active.filter((v) => dateKey(v.expected_release_datetime) === today)
        .length,
      "calendar",
      "Releasing Today",
      "Scheduled for today",
    ],
    [
      "Releasing tomorrow",
      active.filter(
        (v) => dateKey(v.expected_release_datetime) === addDays(today, 1),
      ).length,
      "clock",
      "Releasing Tomorrow",
      "Get a head start",
    ],
    [
      "Ready for release",
      active.filter((v) => v.overall_status === "Ready for Release").length,
      "circleCheck",
      "Ready for Release",
      "All set for pickup",
    ],
    [
      "Needs attention",
      active.filter((v) => warnings(v).length > 0).length,
      "alert",
      "Needs attention",
      "Blocked, at risk or missing details",
    ],
  ];
  return `${title(formatDate(new Date(), { weekday: "long", year: "numeric" }).toUpperCase(), "Operations board", "Active jobs, release times, teams, and blockers in one view.", `<button class="button secondary" data-page="plan">${icon("plan")} Generate daily plan</button>${addButton()}`)}
    <section class="metrics" aria-label="Shop overview">${metrics.map(([label, count, glyph, filter, detail], i) => `<button class="metric ${i === 4 ? "attention-metric" : ""}" data-filter="${filter}"><span class="metric-label">${label}${icon(glyph)}</span><strong>${count.toString().padStart(2, "0")}</strong><span class="metric-detail">${i === 3 ? '<span class="tiny-dot"></span>' : ""}${detail}</span></button>`).join("")}</section>
    <div class="board-layout"><section class="vehicle-workspace"><div class="section-heading"><h2>Shop floor <span class="count">${active.length}</span></h2><button class="text-button muted" data-action="refresh">${icon("refresh")} Refresh</button></div>
    <div class="filter-tabs" aria-label="Vehicle filters">${["All Active", "Releasing Today", "Releasing Tomorrow", "Ongoing", "Blocked"].map((f) => `<button class="filter-tab ${state.filter === f ? "active" : ""}" data-filter="${f}" aria-pressed="${state.filter === f}">${f === "Releasing Today" ? "Today’s releases" : f === "Releasing Tomorrow" ? "Tomorrow’s releases" : f}${f === "Blocked" && active.some(isBlocked) ? '<span class="filter-dot"></span>' : ""}</button>`).join("")}</div>
    <div class="search-toolbar"><label class="search-field">${icon("search")}<input id="search" type="search" placeholder="Search vehicles, packages, teams…" value="${e(state.search)}" aria-label="Search vehicles"/></label><label class="select-wrap"><select id="team-filter" aria-label="Filter by team"><option value="">All teams</option>${state.data.teams.map((t) => `<option value="${e(t.id)}" ${state.team === t.id ? "selected" : ""}>${e(t.name)}</option>`).join("")}<option value="none" ${state.team === "none" ? "selected" : ""}>No assigned team</option></select></label><label class="select-wrap status-filter"><select id="status-filter" aria-label="More status filters"><option value="All Active">All statuses</option>${["Ingress", "Final Checking", "Ready for Release", "Needs attention"].map((s) => `<option ${state.filter === s ? "selected" : ""}>${s}</option>`).join("")}</select></label></div>
    <div class="results-toolbar"><span id="result-count"></span><label>Sort by: <select id="sort" aria-label="Sort vehicles"><option value="priority" ${state.sort === "priority" ? "selected" : ""}>Priority</option><option value="release" ${state.sort === "release" ? "selected" : ""}>Release time</option><option value="name" ${state.sort === "name" ? "selected" : ""}>Vehicle name</option></select></label></div>
    <div id="vehicle-grid" class="vehicle-grid">${cardsContent()}</div></section><aside class="context-panel">${workloadPanel()}${todayPanel()}<div class="plan-prompt"><span class="plan-prompt-icon">${icon("plan")}</span><h3>Next plan</h3><p>Use current tasks and schedules to prepare the next handover.</p><button class="text-button" data-page="plan">Prepare plan ${icon("arrow")}</button></div></aside></div>`;
}
function sortedVehicles() {
  const query = state.search.toLowerCase().trim();
  return activeVehicles(state.data.vehicles)
    .filter(
      (v) =>
        matchesFilter(v, state.filter) &&
        (!state.team ||
          (state.team === "none" ? !v.team_id : v.team_id === state.team)) &&
        [v.vehicle_name, v.color, v.package_label, teamName(v)]
          .join(" ")
          .toLowerCase()
          .includes(query),
    )
    .sort((a, b) => {
      if (state.sort === "name")
        return a.vehicle_name.localeCompare(b.vehicle_name);
      if (state.sort === "priority") {
        const score = (v) =>
          warnings(v).includes("Overdue")
            ? 0
            : isBlocked(v)
              ? 1
              : warnings(v).includes("At risk")
                ? 2
                : v.overall_status === "Ready for Release"
                  ? 3
                  : 4;
        const diff = score(a) - score(b);
        if (diff) return diff;
      }
      return (a.expected_release_datetime || "z").localeCompare(
        b.expected_release_datetime || "z",
      );
    });
}
function cardsContent() {
  const rows = sortedVehicles();
  queueMicrotask(() => {
    const count = document.querySelector("#result-count");
    if (count)
      count.textContent = `${rows.length} vehicle${rows.length === 1 ? "" : "s"}${state.filter !== "All Active" ? ` · ${state.filter}` : ""}`;
  });
  return rows.length
    ? rows.map(vehicleCard).join("")
    : empty(
        "No vehicles to show",
        state.search || state.team || state.filter !== "All Active"
          ? "Try another search or clear your filters."
          : "Add your first vehicle to get the shop moving.",
        '<button class="button secondary" data-action="clear-filters">Clear filters</button>',
      );
}
function vehicleCard(v) {
  const done = v.tasks.filter((t) => t.status === "Done").length;
  const percent = v.tasks.length
    ? Math.round((done / v.tasks.length) * 100)
    : 0;
  const current =
    v.tasks.find((t) => t.status === "Blocked") ||
    v.tasks.find((t) => t.status === "Ongoing") ||
    v.tasks.find((t) => t.status === "Pending");
  const flags = warnings(v);
  const todayRelease = dateKey(v.expected_release_datetime) === dateKey();
  return `<article class="vehicle-card ${flags.includes("Overdue") || flags.includes("Blocked") ? "has-warning" : ""}"><div class="vehicle-card-top"><span class="vehicle-symbol">${icon("car")}</span>${statusBadge(v.overall_status)}</div><button class="vehicle-title" data-view="${e(v.id)}">${e(v.vehicle_name)}</button><div class="vehicle-subtitle"><span class="paint-dot" style="--paint:${{ "Alpine White": "#eeefeb", "Snowflake White": "#eeefeb", "Pearl White": "#eeefeb", "Attitude Black": "#343936", "Obsidian Black": "#343936", "GT Silver": "#c7cece", "Sonic Gray": "#879894", "Soul Red": "#aa4e44", "Jungle Green": "#687b58" }[v.color] || "#bdc7bd"}"></span>${e(v.color || "Color not specified")}<span class="separator">·</span>${e(v.package_label || "No package")}</div>
    <div class="vehicle-assignment">${teamMark(
      teamName(v),
      state.data.teams.findIndex((t) => t.id === v.team_id),
    )}<span>${e(teamName(v))}</span><span class="assignment-label">Assigned team</span></div>
    <div class="current-work"><span class="small-label">CURRENT WORK</span><div><strong>${e(current?.task_name || (v.tasks.length ? "All work completed" : "No work items yet"))}</strong>${current ? `<span class="work-indicator ${statusClass(current.status)}">${e(current.status)}</span>` : icon("circleCheck")}</div></div>
    <div class="progress-label"><span>${done} of ${v.tasks.length} tasks complete</span><strong>${percent}%</strong></div><div class="progress-track"><span class="${percent === 100 ? "complete" : ""}" style="width:${percent}%"></span></div>
    <div class="card-schedule">${icon("calendar")}<span>Release</span><strong>${v.expected_release_datetime ? `${todayRelease ? "Today" : formatDate(v.expected_release_datetime)}<span class="separator">·</span>${formatTime(v.expected_release_datetime)}` : "Not scheduled"}</strong></div>
    <div class="card-flags">${flags.map((flag) => `<span class="warning-badge ${flag === "At risk" || flag === "Missing release" ? "amber" : ""}">${icon("alert")}${e(flag)}</span>`).join("")}${!flags.length && v.overall_status === "Ready for Release" ? `<span class="ready-note">${icon("circleCheck")} Ready for pickup</span>` : !flags.length && todayRelease ? '<span class="today-note">Releasing today</span>' : !flags.length ? `<span class="quiet-note">${remaining(v)} task${remaining(v) === 1 ? "" : "s"} remaining</span>` : ""}</div>
    <button class="view-job" data-view="${e(v.id)}">View job ${icon("arrow")}</button></article>`;
}
function workloadPanel() {
  const active = activeVehicles(state.data.vehicles);
  return `<section class="side-section"><div class="section-heading"><h2>Team workload</h2>${icon("teams")}</div><p class="section-subtitle">Active vehicles by team</p><div class="workload-list">${state.data.teams
    .map((t, i) => {
      const count = active.filter((v) => v.team_id === t.id).length;
      return `<button class="workload-row" data-team="${e(t.id)}">${teamMark(t.name, i)}<div><span>${e(t.name)}<strong>${count}<small> car${count === 1 ? "" : "s"}</small></strong></span><div class="workload-track"><i style="width:${Math.min((count / Math.max(1, active.length)) * 180, 100)}%"></i></div></div></button>`;
    })
    .join(
      "",
    )}${active.some((v) => !v.team_id) ? `<button class="text-button" data-team="none">${active.filter((v) => !v.team_id).length} without a team ${icon("arrow")}</button>` : ""}</div><button class="side-link" data-page="teams">View team workload ${icon("arrow")}</button></section>`;
}
function todayPanel() {
  const active = activeVehicles(state.data.vehicles);
  const events = active
    .flatMap((v) =>
      [
        dateKey(v.expected_release_datetime) === dateKey()
          ? { v, date: v.expected_release_datetime, type: "Release" }
          : null,
        dateKey(v.ingress_datetime) === dateKey() &&
        v.overall_status === "Ingress"
          ? { v, date: v.ingress_datetime, type: "Ingress" }
          : null,
      ].filter(Boolean),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  return `<section class="side-section today-section"><div class="section-heading"><h2>Today’s schedule</h2><span class="count">${events.length}</span></div><p class="section-subtitle">Ingress & releases</p><div class="timeline">${
    events
      .slice(0, 4)
      .map(
        ({ v, date, type }) =>
          `<button class="timeline-item" data-view="${e(v.id)}"><span class="timeline-dot ${type === "Ingress" ? "arrival" : ""}"></span><span><small>${formatTime(date)} <span>${type}</span></small><strong>${e(v.vehicle_name)}</strong><span>${e(v.package_label)}</span></span></button>`,
      )
      .join("") || '<p class="muted small">No movements scheduled today.</p>'
  }</div><button class="side-link" data-page="schedule">View full schedule ${icon("arrow")}</button></section>`;
}
function schedulePage() {
  const active = activeVehicles(state.data.vehicles);
  const section = (name, field, glyph) => {
    const rows = active
      .filter((v) => dateKey(v[field]) === state.scheduleDate)
      .sort((a, b) => a[field].localeCompare(b[field]));
    return `<section class="surface schedule-section"><div class="section-heading"><h2>${icon(glyph)} ${name}</h2><span class="count">${rows.length}</span></div>${rows.map((v) => `<button class="schedule-row" data-view="${e(v.id)}"><span class="schedule-time">${formatTime(v[field])}</span><span><strong>${e(v.vehicle_name)}</strong><small>${e(v.package_label)} · ${e(teamName(v))}</small></span>${statusBadge(v.overall_status)}${icon("chevron")}</button>`).join("") || empty("Nothing scheduled", `No ${name.toLowerCase()} for this date.`)}</section>`;
  };
  return `${title("SHOP MOVEMENTS", "Schedule", "Arrivals and expected releases by date.", addButton())}<div class="schedule-controls"><button class="button ${state.scheduleDate === dateKey() ? "primary" : "secondary"}" data-day="${dateKey()}">Today</button><button class="button ${state.scheduleDate === addDays(dateKey(), 1) ? "primary" : "secondary"}" data-day="${addDays(dateKey(), 1)}">Tomorrow</button><label>View date <input type="date" id="schedule-date" value="${state.scheduleDate}" required/></label></div><div class="schedule-grid">${section("Scheduled ingress", "ingress_datetime", "car")}${section("Expected releases", "expected_release_datetime", "calendar")}</div>`;
}
function teamsPage() {
  const active = activeVehicles(state.data.vehicles);
  return `${title("PEOPLE & PROGRESS", "Team workload", "Active vehicles and unfinished tasks grouped by team.", '<button class="button primary" data-action="add-team">' + icon("plus") + " Add team</button>")}<div class="team-grid">${[
    ...state.data.teams,
    ...(active.some((v) => !v.team_id)
      ? [{ id: null, name: "No assigned team" }]
      : []),
  ]
    .map((t, i) => {
      const rows = active.filter((v) => v.team_id === t.id),
        tasks = rows.flatMap((v) => v.tasks);
      return `<section class="surface team-surface"><div class="section-heading"><h2>${teamMark(t.name, i)} ${e(t.name)}</h2><span class="count">${rows.length} vehicle${rows.length === 1 ? "" : "s"}</span></div><div class="team-stats"><div><strong>${tasks.filter((t) => t.status === "Ongoing").length}</strong><span>Ongoing tasks</span></div><div><strong>${tasks.filter((t) => t.status === "Pending").length}</strong><span>Pending tasks</span></div><div><strong>${tasks.filter((t) => t.status === "Blocked").length}</strong><span>Blocked tasks</span></div></div>${rows.map((v) => `<button class="team-vehicle" data-view="${e(v.id)}"><span><strong>${e(v.vehicle_name)}</strong><small>${e(v.package_label)}</small></span>${statusBadge(v.overall_status)}${icon("chevron")}</button>`).join("") || '<p class="muted small">No active vehicles assigned.</p>'}</section>`;
    })
    .join("")}</div>`;
}
function planPage() {
  return `${title("DAILY PLAN", "Operations plan", "Generate a clear handover for the team, then copy or save the shareable version.", '<button class="button secondary" data-page="history" data-plans>' + icon("history") + " Saved plans</button>")}<div class="plan-layout"><section class="surface plan-settings"><span class="step-label">01 / PREPARE</span><h2>Plan settings</h2><p class="muted">Build the handover from the latest schedules, assignments, and task updates.</p><label class="field">Plan date<input type="date" id="plan-date" value="${state.planDate}" required/></label><div class="plan-includes">${["Vehicles carried forward", "Tasks and current statuses", "Team assignments", "Release & ingress schedules", "Blocked work and warnings"].map((t) => `<span>${icon("check")}${t}</span>`).join("")}</div><button class="button primary full-width" data-action="generate">${icon("spark")} ${state.planText ? "Refresh plan" : "Generate plan"}</button><p class="help-text">Refresh after shop updates. Saved snapshots keep the original handover.</p></section><section class="surface plan-document"><div class="plan-document-heading"><div><span class="step-label">02 / REVIEW & SAVE</span><h2>Handover draft</h2></div>${state.planText ? `<div class="plan-view-tabs" role="tablist" aria-label="Plan view"><button class="${state.planView === "preview" ? "active" : ""}" data-plan-view="preview" role="tab" aria-selected="${state.planView === "preview"}">${icon("plan")} Visual view</button><button class="${state.planView === "text" ? "active" : ""}" data-plan-view="text" role="tab" aria-selected="${state.planView === "text"}">${icon("copy")} Copy text</button></div>` : ""}<span class="draft-tag">${state.planSaved ? "Saved snapshot" : "Draft"}</span></div>${state.planText ? `${state.planView === "preview" ? planPreview() : `<div class="plan-text-view"><div class="plan-text-note">${icon("copy")} This is the editable version used when you copy, download, or save the plan.</div><label class="sr-only" for="plan-text">Daily operations plan draft</label><textarea id="plan-text" spellcheck="false">${e(state.planText)}</textarea></div>`}<div class="plan-actions"><button class="button secondary" data-action="copy-plan">${icon("copy")} Copy text</button><button class="button secondary" data-action="download-plan">${icon("download")} Download</button><button class="button primary" data-action="save-plan" ${state.planSaved ? "disabled" : ""}>${icon("check")} ${state.planSaved ? "Saved" : "Save snapshot"}</button></div>` : empty("No draft yet", "Choose a date and generate a plan. Your readable handover will appear here.")}</section></div>`;
}

function planPreview() {
  const active = activeVehicles(state.data.vehicles);
  const relevant = active.filter(
    (v) => !v.ingress_datetime || dateKey(v.ingress_datetime) <= state.planDate,
  );
  const releases = relevant
    .filter(
      (v) =>
        v.expected_release_datetime &&
        dateKey(v.expected_release_datetime) <= state.planDate,
    )
    .sort((a, b) =>
      a.expected_release_datetime.localeCompare(b.expected_release_datetime),
    );
  const ingress = active
    .filter((v) => dateKey(v.ingress_datetime) === state.planDate)
    .sort((a, b) => a.ingress_datetime.localeCompare(b.ingress_datetime));
  const alerts = relevant.filter((v) => warnings(v).length);
  const groups = [
    ...state.data.teams,
    { id: null, name: "Unassigned" },
  ]
    .map((team, index) => ({
      ...team,
      index,
      vehicles: relevant.filter((v) => v.team_id === team.id),
    }))
    .filter((group) => group.vehicles.length);
  const vehicleMeta = (v) =>
    [v.color, v.package_label, teamName(v)].filter(Boolean).map(e).join(" · ");
  const scheduleRow = (v, type) => {
    const value =
      type === "release" ? v.expected_release_datetime : v.ingress_datetime;
    const carryover =
      type === "release" && dateKey(value) < state.planDate;
    return `<button class="plan-movement-row" data-view="${e(v.id)}"><span class="plan-time"><strong>${formatTime(value)}</strong><small>${type === "release" ? formatDate(value) : "Arrival"}</small></span><span class="plan-movement-name"><strong>${e(v.vehicle_name)}</strong><small>${vehicleMeta(v)}</small></span>${carryover ? '<span class="plan-flag carryover">Carryover</span>' : statusBadge(v.overall_status)}${icon("chevron")}</button>`;
  };
  return `<div class="plan-preview" role="tabpanel"><header class="plan-preview-cover"><div><span class="plan-preview-kicker">OPERATIONS HANDOVER</span><h3>${formatDate(`${state.planDate}T12:00:00Z`, { weekday: "long", year: "numeric" })}</h3><p>Shop plan · ${e(TIMEZONE)}</p></div><span class="draft-tag">${state.planSaved ? "Saved snapshot" : "Working draft"}</span></header><div class="plan-summary" aria-label="Plan summary"><div><strong>${relevant.length}</strong><span>Active jobs</span></div><div><strong>${releases.length}</strong><span>Due releases</span></div><div><strong>${ingress.length}</strong><span>Arrivals</span></div><div class="${alerts.length ? "has-alert" : ""}"><strong>${alerts.length}</strong><span>Need attention</span></div></div><div class="plan-preview-body"><section class="plan-preview-section"><div class="plan-section-title"><span class="plan-section-icon release">${icon("calendar")}</span><div><h4>Releases & carryovers</h4><p>Jobs due by the end of this plan date</p></div><span class="count">${releases.length}</span></div><div class="plan-movement-list">${releases.map((v) => scheduleRow(v, "release")).join("") || '<div class="plan-clear-state">' + icon("circleCheck") + "<span><strong>No releases scheduled</strong><small>No carryovers or releases are due for this date.</small></span></div>"}</div></section><section class="plan-preview-section"><div class="plan-section-title"><span class="plan-section-icon ingress">${icon("car")}</span><div><h4>Scheduled ingress</h4><p>Vehicles expected to arrive</p></div><span class="count">${ingress.length}</span></div><div class="plan-movement-list">${ingress.map((v) => scheduleRow(v, "ingress")).join("") || '<div class="plan-clear-state">' + icon("calendar") + "<span><strong>No arrivals scheduled</strong><small>No ingress is listed for this date.</small></span></div>"}</div></section><section class="plan-preview-section team-plan-section"><div class="plan-section-title"><span class="plan-section-icon teams">${icon("teams")}</span><div><h4>Team work plan</h4><p>Vehicles and work items grouped by assignment</p></div><span class="count">${groups.length}</span></div><div class="plan-team-list">${groups.map((group) => `<section class="plan-team-group"><div class="plan-team-heading">${teamMark(group.name, group.index)}<div><h5>${e(group.name)}</h5><span>${group.vehicles.length} job${group.vehicles.length === 1 ? "" : "s"}</span></div></div><div class="plan-job-list">${group.vehicles.map((v) => `<article class="plan-job"><button class="plan-job-heading" data-view="${e(v.id)}"><span><strong>${e(v.vehicle_name)}</strong><small>${[v.color, v.package_label].filter(Boolean).map(e).join(" · ") || "No package details"}</small></span>${statusBadge(v.overall_status)}${icon("chevron")}</button><div class="plan-task-list">${v.tasks.length ? [...v.tasks].sort((a, b) => a.sort_order - b.sort_order).map((task) => `<div class="plan-task ${statusClass(task.status)}"><span class="plan-task-state">${task.status === "Done" ? icon("check") : task.status === "Blocked" ? icon("alert") : icon("clock")}</span><span><strong>${e(task.task_name)}</strong>${task.notes ? `<small>${e(task.notes)}</small>` : ""}</span><em>${e(task.status)}</em></div>`).join("") : '<div class="plan-task pending"><span class="plan-task-state">' + icon("plus") + '</span><span><strong>No work items added</strong><small>Add tasks from the vehicle job.</small></span></div>'}</div>${v.notes ? `<p class="plan-job-note"><strong>Note</strong> ${e(v.notes)}</p>` : ""}</article>`).join("")}</div></section>`).join("")}</div></section><section class="plan-preview-section attention-section ${alerts.length ? "has-alerts" : "is-clear"}"><div class="plan-section-title"><span class="plan-section-icon attention">${alerts.length ? icon("alert") : icon("circleCheck")}</span><div><h4>Attention required</h4><p>${alerts.length ? "Items to resolve during the handover" : "No active warnings for this plan"}</p></div><span class="count">${alerts.length}</span></div>${alerts.length ? `<div class="plan-alert-list">${alerts.map((v) => `<button data-view="${e(v.id)}"><span><strong>${e(v.vehicle_name)}</strong><small>${warnings(v).map(e).join(" · ")}</small></span>${icon("arrow")}</button>`).join("")}</div>` : '<div class="plan-clear-banner">' + icon("circleCheck") + " Everything is clear for this plan date.</div>"}</section></div></div>`;
}
function historyPage() {
  const vehicles = state.data.vehicles
    .filter((v) => v.overall_status === "Released" || v.is_archived)
    .sort((a, b) =>
      (b.actual_release_datetime || b.updated_at).localeCompare(
        a.actual_release_datetime || a.updated_at,
      ),
    );
  return `${title("SHOP RECORD", "History", "Released vehicles and saved daily operations plans.")}<div class="filter-tabs history-tabs"><button class="filter-tab ${state.historyTab === "vehicles" ? "active" : ""}" data-history="vehicles">Released vehicles <span class="count">${vehicles.length}</span></button><button class="filter-tab ${state.historyTab === "plans" ? "active" : ""}" data-history="plans">Saved plans <span class="count">${state.data.plans.length}</span></button></div><section class="surface">${state.historyTab === "vehicles" ? vehicles.map((v) => `<button class="schedule-row" data-view="${e(v.id)}"><span class="vehicle-symbol">${icon("car")}</span><span><strong>${e(v.vehicle_name)}</strong><small>${e(v.color)} · ${e(v.package_label)} · ${e(teamName(v))}</small></span><span class="history-date">${formatDate(v.actual_release_datetime, { year: "numeric" })}<small>${formatTime(v.actual_release_datetime)}</small></span>${statusBadge(v.overall_status)}${icon("chevron")}</button>`).join("") || empty("No released vehicles yet", "Record an actual release from a vehicle’s job to see it here.") : state.data.plans.map((p) => `<button class="schedule-row" data-snapshot="${e(p.id)}"><span class="vehicle-symbol">${icon("plan")}</span><span><strong>Daily plan · ${formatDate(`${p.plan_date}T12:00:00Z`, { year: "numeric" })}</strong><small>Saved ${formatDate(p.created_at)} at ${formatTime(p.created_at)}</small></span><span class="draft-tag">Snapshot</span>${icon("chevron")}</button>`).join("") || empty("No saved plans yet", "Generate a daily operations plan and save a snapshot.", '<button class="button primary" data-page="plan">Create a plan</button>')}</section>`;
}
function vehicleForm(v = null) {
  const val = (name) => e(v?.[name] || "");
  return `<form id="vehicle-form" data-id="${e(v?.id || "")}" data-version="${e(v?.updated_at || "")}"><div class="form-section-heading"><span class="step-number">1</span><div><h2>Vehicle details</h2><p>The essentials for a clear job handover.</p></div></div><div class="form-grid"><label class="field">Vehicle / Model <span class="required">*</span><input name="vehicle_name" maxlength="120" placeholder="e.g. Toyota Land Cruiser" value="${val("vehicle_name")}" required/></label><label class="field">Color<input name="color" maxlength="80" placeholder="e.g. Pearl White" value="${val("color")}"/></label><label class="field">Package / Service label<input name="package_label" maxlength="160" placeholder="e.g. SPF99 + Tint, Full PPF" value="${val("package_label")}"/><small>Use any package or service name.</small></label><label class="field">Assigned team<select name="team_id"><option value="">Unassigned</option>${state.data.teams
    .filter((t) => t.is_active || t.id === v?.team_id)
    .map(
      (t) =>
        `<option value="${e(t.id)}" ${v?.team_id === t.id ? "selected" : ""}>${e(t.name)}</option>`,
    )
    .join(
      "",
    )}</select></label></div><div class="form-section-heading"><span class="step-number">2</span><div><h2>Schedule & status</h2><p>All dates and times use ${e(TIMEZONE)}.</p></div></div><div class="form-grid"><label class="field">Ingress date & time<input name="ingress_datetime" type="datetime-local" value="${e(v ? localInput(v.ingress_datetime) : localInput(new Date()))}"/></label><label class="field">Expected release date & time<input name="expected_release_datetime" type="datetime-local" value="${e(localInput(v?.expected_release_datetime))}"/></label><label class="field">Operational status<select name="overall_status">${VEHICLE_STATUSES.filter(
    (s) => s !== "Released",
  )
    .map(
      (s) =>
        `<option ${s === (v?.overall_status || "Pending") ? "selected" : ""}>${s}</option>`,
    )
    .join(
      "",
    )}</select></label></div>${!v ? '<div class="form-section-heading"><span class="step-number">3</span><div><h2>Work items</h2><p>One task per line. You can add or change tasks later.</p></div></div><label class="field"><span class="sr-only">Initial work items</span><textarea name="initial_tasks" rows="5" maxlength="10000" placeholder="Wash & decontamination&#10;Paint correction&#10;PPF application&#10;Final inspection"></textarea></label>' : ""}<label class="field notes-field">Job notes<textarea name="notes" rows="3" maxlength="5000" placeholder="Special instructions, customer requests or things to watch…">${val("notes")}</textarea></label><div class="form-error" role="alert"></div><div class="form-actions"><button type="button" class="button secondary" ${v ? 'data-action="back-job"' : 'data-page="board"'}>Cancel</button><button class="button primary" type="submit">${icon("check")}${v ? "Save changes" : "Add vehicle"}</button></div></form>`;
}
function addPage() {
  return `${title("NEW JOB", "Add vehicle", "Create a job record with team, schedule, and starting work items.")}<section class="surface vehicle-form-surface">${vehicleForm()}</section>`;
}
function showModal(html, cls = "") {
  modal.className = cls;
  modal.innerHTML = html;
  if (!modal.open) modal.showModal();
}
function closeModal() {
  modal.close();
  state.selected = null;
}
function modalHeader(eyebrow, titleText) {
  return `<div class="modal-header"><div><div class="eyebrow">${e(eyebrow)}</div><h2 id="modal-title">${e(titleText)}</h2></div><button class="icon-button" data-action="close" aria-label="Close dialog">${icon("close")}</button></div>`;
}
function openJob(id) {
  state.selected = id;
  const v = state.data.vehicles.find((v) => v.id === id);
  if (!v) return;
  const released = v.overall_status === "Released";
  showModal(
    `${modalHeader("VEHICLE JOB", v.vehicle_name)}<div class="job-subtitle">${e(v.color)} <span>·</span> ${e(v.package_label || "No package")} ${statusBadge(v.overall_status)}</div><div class="job-summary"><div><span>Assigned team</span><strong>${e(teamName(v))}</strong></div><div><span>Ingress</span><strong>${formatDate(v.ingress_datetime)} · ${formatTime(v.ingress_datetime)}</strong></div><div><span>Expected release</span><strong>${formatDate(v.expected_release_datetime)} · ${formatTime(v.expected_release_datetime)}</strong></div>${released ? `<div><span>Actual release</span><strong>${formatDate(v.actual_release_datetime)} · ${formatTime(v.actual_release_datetime)}</strong></div>` : ""}</div>${warnings(v).length ? `<div class="job-warning">${icon("alert")} ${warnings(v).map(e).join(" · ")}</div>` : ""}<div class="section-heading job-task-heading"><h3>Work items <span class="count">${v.tasks.filter((t) => t.status === "Done").length}/${v.tasks.length}</span></h3>${!released ? '<button class="text-button" data-action="edit-vehicle">' + icon("edit") + " Edit vehicle</button>" : ""}</div><div class="job-tasks">${
      [...v.tasks]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(
          (t) =>
            `<div class="job-task"><span class="task-symbol ${statusClass(t.status)}">${t.status === "Done" ? icon("check") : t.status === "Blocked" ? icon("alert") : icon("clock")}</span><div class="task-name"><strong>${e(t.task_name)}</strong>${t.notes ? `<small>${e(t.notes)}</small>` : ""}${!released ? `<button class="task-edit text-button" data-edit-task="${e(t.id)}">Edit task</button>` : ""}</div><label class="task-status-label"><span class="sr-only">Status for ${e(t.task_name)}</span><select class="task-status ${statusClass(t.status)}" data-task="${e(t.id)}" ${released ? "disabled" : ""}>${TASK_STATUSES.map((s) => `<option ${s === t.status ? "selected" : ""}>${s}</option>`).join("")}</select></label></div>`,
        )
        .join("") ||
      '<p class="muted">No work items yet. Add the first task below.</p>'
    }</div>${!released ? '<form id="add-task-form" class="add-task-form"><label class="sr-only" for="new-task">New work item</label><input id="new-task" name="task_name" placeholder="Add a work item…" maxlength="200" required/><button class="button secondary" type="submit">' + icon("plus") + ' Add task</button><div class="form-error" role="alert"></div></form>' : ""}${v.notes ? `<div class="job-notes"><span class="small-label">JOB NOTES</span><p>${e(v.notes)}</p></div>` : ""}<div class="job-footer"><span class="muted small">${remaining(v)} task${remaining(v) === 1 ? "" : "s"} remaining</span>${!released ? `<button class="button ${v.overall_status === "Ready for Release" ? "primary" : "secondary"}" data-action="${v.overall_status === "Ready for Release" ? "release" : "mark-ready"}" ${remaining(v) > 0 ? "disabled" : ""}>${icon("circleCheck")}${v.overall_status === "Ready for Release" ? "Record release" : "Mark ready for release"}</button>` : '<span class="ready-note">' + icon("circleCheck") + " Release recorded</span>"}</div>`,
    "job-dialog",
  );
}
function editTask(id) {
  const v = state.data.vehicles.find((v) => v.id === state.selected),
    t = v.tasks.find((t) => t.id === id);
  showModal(
    `${modalHeader("WORK ITEM", "Edit task")}<form id="edit-task-form" data-id="${e(id)}"><label class="field">Task name<input name="task_name" value="${e(t.task_name)}" required maxlength="200"/></label><label class="field">Status<select name="status">${TASK_STATUSES.map((s) => `<option ${t.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label><label class="field">Notes / blocker<textarea name="notes" maxlength="2000" rows="3">${e(t.notes)}</textarea></label><label class="field">Order<input name="sort_order" type="number" min="0" max="9999" value="${t.sort_order}" required/></label><div class="form-error" role="alert"></div><div class="form-actions"><button type="button" class="button danger-quiet" data-delete-task="${e(id)}">Delete task</button><button type="button" class="button secondary" data-action="back-job">Cancel</button><button type="submit" class="button primary">Save task</button></div></form>`,
  );
}
async function refresh() {
  const data = await api.loadData();
  state.data = data;
  state.error = "";
  state.synced = new Date();
}
async function mutation(work, message, after) {
  if (state.busy) return;
  state.busy = true;
  const buttons = [
    ...document.querySelectorAll(
      "button:not([disabled]), select:not([disabled])",
    ),
  ];
  buttons.forEach((b) => (b.disabled = true));
  try {
    if (!api.demo && !navigator.onLine)
      throw new Error("You’re offline. Reconnect and try again.");
    await work();
    try {
      await refresh();
    } catch {
      throw new Error(
        "Your change was saved, but the latest data could not load. Refresh before making another change.",
      );
    }
    shell();
    after?.();
    toast(message);
  } catch (err) {
    toast(err.message || "Something went wrong. Try again.", true);
    const error = modal.open
      ? modal.querySelector(".form-error")
      : document.querySelector(".form-error");
    if (error) error.textContent = err.message;
  } finally {
    buttons.forEach((b) => {
      if (b.isConnected) b.disabled = false;
    });
    state.busy = false;
  }
}
function navigate(page) {
  if (state.busy) return;
  closeModal();
  state.page = page;
  shell();
  window.scrollTo({ top: 0, behavior: "instant" });
}
document.addEventListener("click", async (event) => {
  const button = event.target.closest("button, a.brand");
  if (!button || button.disabled) return;
  if (button.matches("a.brand")) {
    event.preventDefault();
    navigate("board");
    return;
  }
  const d = button.dataset;
  if (d.page) {
    if (d.plans !== undefined) state.historyTab = "plans";
    navigate(d.page);
    return;
  }
  if (d.view) {
    openJob(d.view);
    return;
  }
  if (d.filter) {
    state.filter = d.filter;
    shell();
    return;
  }
  if (d.team) {
    state.team = d.team;
    state.filter = "All Active";
    state.page = "board";
    shell();
    return;
  }
  if (d.day) {
    state.scheduleDate = d.day;
    shell();
    return;
  }
  if (d.history) {
    state.historyTab = d.history;
    shell();
    return;
  }
  if (d.planView) {
    state.planView = d.planView;
    shell();
    return;
  }
  if (d.editTask) {
    editTask(d.editTask);
    return;
  }
  if (d.deleteTask) {
    const task = state.data.vehicles
      .find((v) => v.id === state.selected)
      .tasks.find((t) => t.id === d.deleteTask);
    showModal(
      `${modalHeader("REMOVE WORK ITEM", "Delete this task?")}<p>${e(task.task_name)} will be removed from this vehicle.</p><div class="form-actions"><button class="button secondary" data-action="back-job">Cancel</button><button class="button danger" data-confirm-delete="${e(task.id)}">Delete task</button></div>`,
    );
    return;
  }
  if (d.confirmDelete) {
    const id = state.selected,
      task = state.data.vehicles
        .find((v) => v.id === id)
        .tasks.find((t) => t.id === d.confirmDelete);
    await mutation(
      () => api.deleteTask(task),
      "Task deleted.",
      () => openJob(id),
    );
    return;
  }
  if (d.snapshot) {
    const p = state.data.plans.find((p) => p.id === d.snapshot);
    showModal(
      `${modalHeader("SAVED SNAPSHOT", `Daily plan · ${p.plan_date}`)}<pre class="snapshot-text">${e(p.generated_text)}</pre><div class="form-actions"><button class="button secondary" data-copy-snapshot="${e(p.id)}">${icon("copy")} Copy plan</button><button class="button primary" data-download-snapshot="${e(p.id)}">${icon("download")} Download</button></div>`,
      "snapshot-dialog",
    );
    return;
  }
  if (d.copySnapshot) {
    copyText(
      state.data.plans.find((p) => p.id === d.copySnapshot).generated_text,
    );
    return;
  }
  if (d.downloadSnapshot) {
    const p = state.data.plans.find((p) => p.id === d.downloadSnapshot);
    download(p.generated_text, p.plan_date);
    return;
  }
  switch (d.action) {
    case "add":
      navigate("add");
      break;
    case "account":
      showModal(
        `${modalHeader("SHOP WORKSPACE", "Operations Manager")}<p>${api.demo ? "You’re exploring the demo workspace." : e(state.user?.email || "")}</p><div class="form-actions"><button class="button secondary" data-action="help">${icon("help")} Quick guide</button><button class="button secondary" data-action="logout">${icon("logout")} Log out</button></div>`,
      );
      break;
    case "close":
      closeModal();
      break;
    case "back-job":
      openJob(state.selected);
      break;
    case "clear-filters":
      state.filter = "All Active";
      state.search = "";
      state.team = "";
      shell();
      break;
    case "refresh":
      await mutation(async () => {}, "Board updated.");
      break;
    case "generate":
      if (!document.querySelector("#plan-date").reportValidity()) break;
      await mutation(
        async () => {},
        "Plan generated from the latest shop data.",
        () => {
          state.planText = generatePlan(
            state.data.vehicles,
            state.data.teams,
            state.planDate,
          );
          state.planSaved = false;
          state.planView = "preview";
          shell();
        },
      );
      break;
    case "save-plan":
      if (!state.planText.trim()) {
        toast("Generate a plan before saving.", true);
        break;
      }
      await mutation(
        () => api.savePlan(state.planDate, state.planText, state.user?.id),
        api.demo
          ? "Demo snapshot saved for this session."
          : "Plan snapshot saved.",
        () => {
          state.planSaved = true;
          shell();
        },
      );
      break;
    case "copy-plan":
      copyText(state.planText);
      break;
    case "download-plan":
      download(state.planText, state.planDate);
      break;
    case "edit-vehicle": {
      const v = state.data.vehicles.find((v) => v.id === state.selected);
      showModal(
        `${modalHeader("VEHICLE JOB", "Edit vehicle")}${vehicleForm(v)}`,
        "edit-dialog",
      );
      break;
    }
    case "mark-ready": {
      const id = state.selected,
        v = state.data.vehicles.find((v) => v.id === id);
      await mutation(
        () =>
          api.saveVehicle(
            { overall_status: "Ready for Release" },
            id,
            [],
            v.updated_at,
          ),
        "Vehicle marked ready for release.",
        () => openJob(id),
      );
      break;
    }
    case "release":
      showModal(
        `${modalHeader("VEHICLE HANDOVER", "Record actual release")}<p>Confirm the vehicle has left the shop. This moves the job to history and closes its work items.</p><form id="release-form"><label class="field">Actual release date & time<input type="datetime-local" name="actual" value="${localInput(new Date())}" max="${localInput(new Date())}" required/></label><div class="form-error" role="alert"></div><div class="form-actions"><button class="button secondary" type="button" data-action="back-job">Cancel</button><button class="button primary" type="submit">${icon("check")} Confirm release</button></div></form>`,
      );
      break;
    case "add-team":
      showModal(
        `${modalHeader("TEAM WORKLOAD", "Add a team")}<form id="team-form"><label class="field">Team name<input name="name" required maxlength="60" placeholder="e.g. Team D"/></label><div class="form-error" role="alert"></div><div class="form-actions"><button class="button secondary" type="button" data-action="close">Cancel</button><button class="button primary" type="submit">Add team</button></div></form>`,
      );
      break;
    case "help":
      showModal(
        `${modalHeader("QUICK GUIDE", "A smoother day in the shop")}<div class="guide"><h3>1. Bring vehicles onto the board</h3><p>Add the model, package, team, schedule and work items. Use Ingress for expected arrivals.</p><h3>2. Keep work moving</h3><p>Open a job and update tasks to Pending, Ongoing, Done or Blocked. Add notes to explain blockers. A blocked task or unfinished work due within 24 hours flags a vehicle for attention.</p><h3>3. Hand over with confidence</h3><p>Finish the tasks, mark the vehicle Ready for Release, then record the actual release when it leaves the shop.</p><h3>4. Close the day</h3><p>Generate tomorrow’s plan, review the draft and save a snapshot. Download or copy it for your handover.</p></div>`,
      );
      break;
    case "setup":
      showModal(
        `${modalHeader("CONNECT YOUR SHOP", "Ready for real operations")}<div class="guide"><p>This preview uses sample data held in memory.</p><ol><li>Create a Supabase project and run the migration in <code>supabase/migrations</code>.</li><li>Create the Operations Manager account and its profile using the README instructions.</li><li>Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, disable demo mode, then rebuild.</li></ol><p>The project README includes the complete Supabase and Netlify setup.</p></div>`,
      );
      break;
    case "logout":
      if (api.demo) {
        state.signedOutDemo = true;
        state.data = { vehicles: [], teams: [], plans: [] };
        state.planText = "";
        loginPage();
      } else {
        try {
          const { error } = await api.supabase.auth.signOut();
          if (error) throw error;
          state.data = { vehicles: [], teams: [], plans: [] };
          state.planText = "";
          state.user = null;
          loginPage();
        } catch (err) {
          toast(err.message, true);
        }
      }
      break;
    case "enter-demo":
      state.signedOutDemo = false;
      await refresh();
      state.page = "board";
      shell();
      break;
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "search") {
    state.search = event.target.value;
    document.querySelector("#vehicle-grid").innerHTML = cardsContent();
  }
  if (event.target.id === "plan-text") {
    state.planText = event.target.value;
    state.planSaved = false;
    const save = document.querySelector('[data-action="save-plan"]');
    save.disabled = false;
    save.innerHTML = icon("check") + " Save snapshot";
    document.querySelector(".draft-tag").textContent = "Draft";
  }
});
document.addEventListener("change", async (event) => {
  const el = event.target;
  if (el.id === "team-filter") {
    state.team = el.value;
    document.querySelector("#vehicle-grid").innerHTML = cardsContent();
  }
  if (el.id === "status-filter") {
    state.filter = el.value;
    shell();
  }
  if (el.id === "sort") {
    state.sort = el.value;
    document.querySelector("#vehicle-grid").innerHTML = cardsContent();
  }
  if (el.id === "schedule-date" && el.value) {
    state.scheduleDate = el.value;
    shell();
  }
  if (el.id === "plan-date" && el.value) {
    state.planDate = el.value;
    state.planText = "";
    state.planSaved = false;
    state.planView = "preview";
    shell();
  }
  if (el.dataset.task) {
    const id = state.selected,
      v = state.data.vehicles.find((v) => v.id === id),
      t = v.tasks.find((t) => t.id === el.dataset.task),
      old = t.status;
    await mutation(
      () => api.updateTask(t, { status: el.value }),
      "Task updated.",
      () => openJob(id),
    );
    if (el.isConnected) el.value = old;
  }
});
document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target,
    f = Object.fromEntries(new FormData(form));
  try {
    if (form.id === "login-form") {
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = "Signing in…";
      try {
        const { data, error } = await api.supabase.auth.signInWithPassword({
          email: f.email.trim(),
          password: f.password,
        });
        if (error) throw error;
        state.user = data.user;
        await authorize();
        await refresh();
        state.page = "board";
        shell();
      } finally {
        btn.disabled = false;
        btn.textContent = "Login";
      }
      return;
    }
    if (form.id === "vehicle-form") {
      const id = form.dataset.id || null,
        values = {
          vehicle_name: f.vehicle_name.trim(),
          color: f.color.trim(),
          package_label: f.package_label.trim(),
          team_id: f.team_id || null,
          ingress_datetime: toISO(f.ingress_datetime),
          expected_release_datetime: toISO(f.expected_release_datetime),
          overall_status: f.overall_status,
          notes: f.notes.trim(),
        };
      if (!values.vehicle_name) throw new Error("Enter a vehicle name.");
      if (
        values.ingress_datetime &&
        values.expected_release_datetime &&
        values.expected_release_datetime < values.ingress_datetime
      )
        throw new Error("Expected release must be after ingress.");
      const tasks = (f.initial_tasks || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (tasks.length > 100 || tasks.some((t) => t.length > 200))
        throw new Error(
          "Use up to 100 work items, each no longer than 200 characters.",
        );
      if (
        values.overall_status === "Ready for Release" &&
        (id
          ? remaining(state.data.vehicles.find((v) => v.id === id))
          : tasks.length) > 0
      )
        throw new Error(
          "Complete all work items before marking this vehicle ready.",
        );
      await mutation(
        () => api.saveVehicle(values, id, tasks, form.dataset.version || null),
        id ? "Vehicle updated." : "Vehicle added to the board.",
        () => {
          if (id) openJob(id);
          else {
            state.page = "board";
            state.filter = "All Active";
            state.team = "";
            state.search = "";
            shell();
            window.scrollTo({ top: 0, behavior: "instant" });
          }
        },
      );
    }
    if (form.id === "add-task-form") {
      const id = state.selected,
        v = state.data.vehicles.find((v) => v.id === id),
        name = f.task_name.trim();
      if (!name) throw new Error("Enter a work item.");
      await mutation(
        () =>
          api.addTask(
            id,
            name,
            Math.max(-1, ...v.tasks.map((t) => t.sort_order)) + 1,
          ),
        "Work item added.",
        () => openJob(id),
      );
    }
    if (form.id === "edit-task-form") {
      const id = state.selected,
        t = state.data.vehicles
          .find((v) => v.id === id)
          .tasks.find((t) => t.id === form.dataset.id);
      if (!f.task_name.trim()) throw new Error("Enter a task name.");
      await mutation(
        () =>
          api.updateTask(t, {
            task_name: f.task_name.trim(),
            status: f.status,
            notes: f.notes.trim(),
            sort_order: Number(f.sort_order),
          }),
        "Task updated.",
        () => openJob(id),
      );
    }
    if (form.id === "release-form") {
      const id = state.selected,
        v = state.data.vehicles.find((v) => v.id === id),
        actual = toISO(f.actual);
      if (new Date(actual) > new Date())
        throw new Error("Actual release cannot be in the future.");
      if (v.ingress_datetime && actual < v.ingress_datetime)
        throw new Error("Actual release must be after ingress.");
      await mutation(
        () => api.releaseVehicle(id, actual, v.updated_at),
        "Release recorded. Vehicle moved to history.",
        closeModal,
      );
    }
    if (form.id === "team-form") {
      if (!f.name.trim()) throw new Error("Enter a team name.");
      await mutation(
        () => api.addTeam(f.name.trim()),
        "Team added.",
        closeModal,
      );
    }
  } catch (err) {
    const target = form.querySelector(".form-error");
    if (target) target.textContent = err.message;
    toast(err.message, true);
  }
});
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Plan copied to clipboard.");
  } catch {
    toast(
      "Clipboard unavailable. Select and copy the plan text, or download it.",
      true,
    );
  }
}
function download(text, date) {
  const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = `daily-operations-plan-${date}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Plan downloaded.");
}
function loginPage(message = "") {
  document.title = "Login · Detailing Operations Manager";
  closeModal();
  app.innerHTML = `<div class="login-page"><div class="login-brand"><img src="/icon.svg" alt=""/><span>DETAILING<br/><small>OPERATIONS MANAGER</small></span></div><section class="login-surface"><div class="eyebrow">YOUR SHOP WORKSPACE</div><h1>Welcome back.</h1><p>Sign in to keep the shop moving.</p>${api.demo ? '<div class="demo-login"><p>Demo mode uses sample data for this session.</p><button class="button primary full-width" data-action="enter-demo">Enter demo workspace ' + icon("arrow") + "</button></div>" : !api.configured ? '<div class="error-banner">Connect your Supabase project to enable login. Follow the setup instructions in README.md.</div>' : `<form id="login-form"><label class="field">Email<input name="email" type="email" autocomplete="username" required placeholder="manager@yourshop.com"/></label><label class="field">Password<input name="password" type="password" autocomplete="current-password" required placeholder="Enter your password"/></label><div class="form-error" role="alert">${e(message)}</div><button type="submit" class="button primary full-width">Login ${icon("arrow")}</button></form>`}<div class="login-footnote">For your Operations Manager account.<br/>Contact your shop administrator if you need access.</div></section><p class="login-copyright">Every vehicle. Every step. Under control.</p></div>`;
}
async function authorize() {
  const { data, error } = await api.supabase
    .from("profiles")
    .select("id, role")
    .eq("id", state.user.id)
    .single();
  if (error || data?.role !== "operations_manager") {
    await api.supabase.auth.signOut();
    state.user = null;
    throw new Error(
      "This account is not configured as the Operations Manager. Ask your administrator to create its profile.",
    );
  }
}
async function init() {
  if (api.demo) {
    await refresh();
    shell();
    return;
  }
  if (!api.configured) {
    loginPage();
    return;
  }
  api.supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      state.user = null;
      state.data = { vehicles: [], teams: [], plans: [] };
      state.planText = "";
      loginPage();
    } else if (session) state.user = session.user;
  });
  try {
    const { data, error } = await api.supabase.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      loginPage();
      return;
    }
    state.user = data.session.user;
    await authorize();
    await refresh();
    shell();
  } catch (err) {
    loginPage(err.message);
  }
}
window.addEventListener("online", () => {
  document.querySelector("#offline-notice")?.remove();
  if (api.demo || state.user)
    toast("Connection restored. Refresh the board to load the latest data.");
});
window.addEventListener("offline", () => {
  if (api.demo || state.user) {
    const main = document.querySelector("main");
    if (main && !document.querySelector("#offline-notice")) {
      const notice = document.createElement("div");
      notice.id = "offline-notice";
      notice.className = "error-banner";
      notice.textContent = "You’re offline. Reconnect before saving changes.";
      main.prepend(notice);
    }
  }
});
modal.addEventListener("click", (event) => {
  if (event.target === modal) {
    const r = modal.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      closeModal();
  }
});
modal.addEventListener("cancel", () => {
  state.selected = null;
});
if ("serviceWorker" in navigator && import.meta.env.PROD)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
init();
