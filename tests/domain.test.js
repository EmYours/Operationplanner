import test from "node:test";
import assert from "node:assert/strict";
import {
  dateKey,
  addDays,
  toISO,
  localInput,
  warnings,
  matchesFilter,
  generatePlan,
  escapeHtml,
  activeVehicles,
} from "../src/domain.js";
const now = new Date("2026-09-19T08:00:00Z");
const vehicle = (patch = {}) => ({
  id: "v1",
  vehicle_name: "Test car",
  color: "White",
  package_label: "Full PPF",
  team_id: "team-a",
  team_name: "Team A",
  overall_status: "In Progress",
  is_archived: false,
  ingress_datetime: "2026-09-18T02:00:00Z",
  expected_release_datetime: "2026-09-19T10:00:00Z",
  notes: "",
  tasks: [{ task_name: "Apply film", status: "Pending", sort_order: 0 }],
  ...patch,
});
test("shop dates cross midnight and month boundaries correctly", () => {
  assert.equal(dateKey("2026-09-19T17:30:00Z"), "2026-09-20");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(dateKey(null), "");
});
test("shop datetime input round trips independently from browser timezone", () => {
  assert.equal(toISO("2026-09-19T17:00"), "2026-09-19T09:00:00.000Z");
  assert.equal(localInput("2026-09-19T09:00:00Z"), "2026-09-19T17:00");
  assert.equal(toISO(""), null);
});
test("warnings distinguish unfinished due work, overdue, blockers and missing details", () => {
  assert.deepEqual(warnings(vehicle(), now), ["At risk"]);
  assert.deepEqual(
    warnings(
      vehicle({ expected_release_datetime: "2026-09-19T01:00:00Z" }),
      now,
    ),
    ["Overdue"],
  );
  assert.deepEqual(
    warnings(
      vehicle({
        overall_status: "Ready for Release",
        tasks: [{ status: "Done" }],
      }),
      now,
    ),
    [],
  );
  assert.deepEqual(
    warnings(
      vehicle({
        team_id: null,
        expected_release_datetime: null,
        tasks: [{ status: "Blocked" }],
      }),
      now,
    ),
    ["Blocked", "Missing release", "Unassigned team"],
  );
  assert.deepEqual(warnings(vehicle({ overall_status: "Released" }), now), []);
});
test("today and tomorrow release filters follow shop timezone", () => {
  assert.equal(matchesFilter(vehicle(), "Releasing Today", now), true);
  assert.equal(
    matchesFilter(
      vehicle({ expected_release_datetime: "2026-09-19T17:00:00Z" }),
      "Releasing Tomorrow",
      now,
    ),
    true,
  );
  assert.equal(matchesFilter(vehicle(), "Blocked", now), false);
});
test("plan includes carryovers, task states, team, ingress and notes but excludes released and future ingress", () => {
  const vehicles = [
    vehicle({ notes: "Check edges" }),
    vehicle({
      id: "released",
      vehicle_name: "Released car",
      overall_status: "Released",
    }),
    vehicle({
      id: "future",
      vehicle_name: "Future car",
      ingress_datetime: "2026-09-25T02:00:00Z",
    }),
    vehicle({
      id: "arrival",
      vehicle_name: "Arrival",
      overall_status: "Ingress",
      ingress_datetime: "2026-09-20T02:00:00Z",
    }),
  ];
  const text = generatePlan(
    vehicles,
    [{ id: "team-a", name: "Team A" }],
    "2026-09-20",
    now,
  );
  assert.match(text, /CARRYOVER/);
  assert.match(text, /\[Pending\] Apply film/);
  assert.match(text, /Check edges/);
  assert.match(text, /TEAM A/);
  assert.match(text, /Arrival/);
  assert.doesNotMatch(text, /Released car|Future car/);
  assert.equal(activeVehicles(vehicles).length, 3);
});
test("user-controlled HTML is escaped", () =>
  assert.equal(
    escapeHtml("<img src=\"x\" onerror='bad'>&"),
    "&lt;img src=&quot;x&quot; onerror=&#39;bad&#39;&gt;&amp;",
  ));
