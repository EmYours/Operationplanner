import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("PostgreSQL migration, access policies and vehicle lifecycle", async (t) => {
  const db = new PGlite();
  const manager = "11111111-1111-4111-8111-111111111111";
  const stranger = "22222222-2222-4222-8222-222222222222";
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    insert into auth.users values ('${manager}'),('${stranger}');`);
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/001_initial.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.query("insert into public.profiles(id,email) values($1,$2)", [
    manager,
    "manager@example.test",
  ]);
  const as = async (role, user = "") => {
    await db.exec(`reset role; set role ${role};`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
  };
  let id, taskId;
  const version = async () =>
    (
      await db.query(
        "select updated_at::text as version from vehicles where id=$1",
        [id],
      )
    ).rows[0].version;
  const edit = async (patch) =>
    db.query("select save_vehicle($1,$2::jsonb,$3::jsonb,$4::timestamptz)", [
      id,
      JSON.stringify(patch),
      "[]",
      await version(),
    ]);
  await t.test("anonymous users cannot read operational data", async () => {
    await as("anon");
    for (const table of [
      "profiles",
      "teams",
      "vehicles",
      "vehicle_tasks",
      "daily_plans",
    ])
      await assert.rejects(
        db.query(`select * from ${table}`),
        /permission denied/,
      );
    await assert.rejects(
      db.query("select save_vehicle(null,'{}','[]',null)"),
      /permission denied/,
    );
  });
  await t.test(
    "authenticated accounts without a provisioned profile have no shop access",
    async () => {
      await as("authenticated", stranger);
      assert.equal((await db.query("select * from teams")).rows.length, 0);
      await assert.rejects(
        db.query("insert into teams(name) values('Unauthorized')"),
        /row-level security/,
      );
      await assert.rejects(
        db.query("insert into profiles(id,email) values($1,$2)", [
          stranger,
          "x@example.test",
        ]),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select save_vehicle(null,'{}','[]',null)"),
        /access required/,
      );
    },
  );
  await t.test(
    "manager creates a vehicle with initial tasks atomically",
    async () => {
      await as("authenticated", manager);
      assert.equal((await db.query("select * from teams")).rows.length, 5);
      const values = {
        vehicle_name: "Test car",
        ingress_datetime: "2026-01-01T08:00:00Z",
        expected_release_datetime: "2026-01-03T08:00:00Z",
        overall_status: "Pending",
      };
      id = (
        await db.query(
          "select save_vehicle(null,$1::jsonb,$2::jsonb,null) as id",
          [JSON.stringify(values), '["Apply film","Inspect"]'],
        )
      ).rows[0].id;
      const tasks = (
        await db.query(
          "select * from vehicle_tasks where vehicle_id=$1 order by sort_order",
          [id],
        )
      ).rows;
      assert.equal(tasks.length, 2);
      assert.equal(tasks[0].status, "Pending");
      taskId = tasks[0].id;
      await assert.rejects(
        db.query("select save_vehicle(null,$1::jsonb,$2::jsonb,null)", [
          JSON.stringify({ ...values, vehicle_name: "Rollback car" }),
          '[""]',
        ]),
        /check constraint/,
      );
      assert.equal(
        (
          await db.query(
            "select * from vehicles where vehicle_name='Rollback car'",
          )
        ).rows.length,
        0,
      );
    },
  );
  await t.test(
    "task statuses are constrained, ongoing work advances the job, stale edits fail",
    async () => {
      const old = await version();
      await assert.rejects(
        db.query("update vehicle_tasks set status='Custom' where id=$1", [
          taskId,
        ]),
        /check constraint/,
      );
      await db.query("update vehicle_tasks set status='Ongoing' where id=$1", [
        taskId,
      ]);
      assert.equal(
        (
          await db.query("select overall_status from vehicles where id=$1", [
            id,
          ])
        ).rows[0].overall_status,
        "In Progress",
      );
      await assert.rejects(
        db.query(
          "select save_vehicle($1,$2::jsonb,$3::jsonb,$4::timestamptz)",
          [id, '{"notes":"stale"}', "[]", old],
        ),
        /changed in another session/,
      );
    },
  );
  await t.test(
    "unfinished work cannot be marked ready or released",
    async () => {
      await assert.rejects(
        edit({ overall_status: "Ready for Release" }),
        /Complete all work items/,
      );
      await assert.rejects(
        db.query("select release_vehicle($1,$2,$3)", [
          id,
          "2026-01-02T08:00:00Z",
          await version(),
        ]),
        /Mark the vehicle ready/,
      );
    },
  );
  await t.test(
    "reopening a task removes readiness and completion never auto-releases",
    async () => {
      await db.query(
        "update vehicle_tasks set status='Done' where vehicle_id=$1",
        [id],
      );
      assert.equal(
        (
          await db.query("select overall_status from vehicles where id=$1", [
            id,
          ])
        ).rows[0].overall_status,
        "In Progress",
      );
      await edit({ overall_status: "Ready for Release" });
      await db.query("update vehicle_tasks set status='Blocked' where id=$1", [
        taskId,
      ]);
      assert.equal(
        (
          await db.query("select overall_status from vehicles where id=$1", [
            id,
          ])
        ).rows[0].overall_status,
        "In Progress",
      );
      await db.query("update vehicle_tasks set status='Done' where id=$1", [
        taskId,
      ]);
      await edit({ overall_status: "Ready for Release" });
    },
  );
  await t.test(
    "actual release is explicit, validated and makes vehicle and tasks read-only",
    async () => {
      await assert.rejects(
        db.query("select release_vehicle($1,$2,$3)", [
          id,
          "2099-01-02T08:00:00Z",
          await version(),
        ]),
        /future/,
      );
      await assert.rejects(
        db.query("select release_vehicle($1,$2,$3)", [
          id,
          "2025-01-02T08:00:00Z",
          await version(),
        ]),
        /check constraint/,
      );
      await db.query("select release_vehicle($1,$2,$3)", [
        id,
        "2026-01-02T08:00:00Z",
        await version(),
      ]);
      assert.equal(
        (
          await db.query("select overall_status from vehicles where id=$1", [
            id,
          ])
        ).rows[0].overall_status,
        "Released",
      );
      await assert.rejects(
        edit({ notes: "Change after release" }),
        /read-only/,
      );
      await assert.rejects(
        db.query("update vehicle_tasks set status='Pending' where id=$1", [
          taskId,
        ]),
        /read-only/,
      );
      await assert.rejects(
        db.query("delete from vehicle_tasks where id=$1", [taskId]),
        /read-only/,
      );
      await assert.rejects(
        db.query(
          "insert into vehicle_tasks(vehicle_id,task_name) values($1,'New task')",
          [id],
        ),
        /read-only/,
      );
    },
  );
  await t.test(
    "snapshots cannot be edited or deleted; ownership cannot be forged",
    async () => {
      await db.query(
        "insert into daily_plans(plan_date,generated_text) values('2026-01-03','Daily handover')",
      );
      await assert.rejects(
        db.query("update daily_plans set generated_text='Changed'"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("delete from daily_plans"),
        /permission denied/,
      );
      await assert.rejects(
        db.query(
          "insert into daily_plans(plan_date,generated_text,created_by) values('2026-01-03','Forged',$1)",
          [stranger],
        ),
        /row-level security/,
      );
      assert.equal(
        (await db.query("select generated_text from daily_plans")).rows[0]
          .generated_text,
        "Daily handover",
      );
    },
  );
  await db.close();
});
