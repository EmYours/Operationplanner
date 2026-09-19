# Detailing Operations Manager

A vehicle-first workspace for one Operations Manager. Built with HTML, CSS, vanilla JavaScript, Supabase Auth and PostgreSQL. Vite bundles the static frontend for Netlify; there is no application server.

## Run locally

Install Node.js 22.12+ (or Node.js 24), then run:

```sh
npm ci
npm run dev
```

Open **http://localhost:5187**. An unconfigured development server opens a labeled demo with sample vehicles. Demo edits and snapshots exist only in memory and reset on a page reload. No sample data is inserted into Supabase.

```sh
npm test        # Domain rules and PostgreSQL/RLS tests
npm run build  # Static production files in dist/
npm run preview # Preview the build at http://localhost:4187
```

A production build without Supabase configuration shows a setup message. To publish a demo deliberately, set `VITE_DEMO_MODE=true` before building. Leave this false for the real shop.

## Connect Supabase

1. Create a Supabase project.
2. Run [001_initial.sql](supabase/migrations/001_initial.sql) once in that project's SQL Editor. It creates the schema, constraints, indexes, RLS policies, transactional functions and five default teams. Use a new migration for future schema changes; this initial migration is not intended to run twice.
3. In Supabase Authentication, disable new user sign-ups and anonymous sign-ins. Create one email/password user manually, using the dashboard's user creation action. Confirm its email in the dashboard as needed. There is no registration page in this app.
4. Copy the new user's UUID, then run this SQL as the database administrator, replacing the placeholders:

   ```sql
   insert into public.profiles (id, email, role)
   values (
     'REPLACE_WITH_AUTH_USER_UUID'::uuid,
     'manager@yourshop.example',
     'operations_manager'
   );
   ```

   A valid Auth account alone cannot access shop data. An administrator must provision its Operations Manager profile. Create only the one manager profile for this MVP.

5. Copy `.env.example` to `.env.local` and set:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
   VITE_DEMO_MODE=false
   VITE_SHOP_TIMEZONE=Asia/Manila
   ```

   These values are compiled into the browser bundle. Use the public anon key; **never use a service-role or secret key**. Do not commit `.env.local`.

6. Restart the development server. Sign in with the manager account. The authenticated app opens directly on the Operations Board.

The shop timezone must be a valid IANA timezone. All schedule inputs, day boundaries and plans use it even when a device is in another timezone. PostgreSQL stores instants as `timestamptz`.

## Deploy through GitHub and Netlify

1. Use the [Operationplanner repository](https://github.com/EmYours/Operationplanner). Commit `package-lock.json`; exclude `.env*`, `node_modules`, `dist` and browser artifacts as specified in `.gitignore`.
2. Import that repository into Netlify. [netlify.toml](netlify.toml) supplies the build command (`npm run build`), publish folder (`dist`), Node version, headers and SPA fallback.
3. Set the four environment variables above in Netlify's build environment. Keep `VITE_DEMO_MODE=false` and configure both Supabase values. Changing these variables requires a rebuild.
4. Deploy. In Supabase Auth URL configuration, set the production HTTPS origin as the Site URL.
5. On the deployed site, verify login, add a real test job, refresh to confirm persistence, complete its tasks, record release and save a plan. Sign out and confirm that the board is no longer visible.

GitHub Actions runs domain/database tests and a production build on pushes and pull requests. A live deployment still requires the Supabase configuration and Netlify setup above.

For a Supabase custom API domain, extend the `connect-src` policy in `netlify.toml` to that exact HTTPS/WSS host. The provided policy supports standard `*.supabase.co` endpoints. Fonts and icons are bundled locally.

## Daily workflow

- **Board:** active vehicles include scheduled ingress. The overview separately shows vehicles currently inside the shop, using ingress time for vehicles in Ingress status. Search matches model, color, package and team. Combine a team filter with a status filter; sort by priority, release time or vehicle name.
- **Add vehicle:** use a free-text package, a team, shop-local dates/times and optional initial tasks (one per line). Missing release details and unassigned teams remain visible as warnings.
- **View job:** add, rename, reorder or remove work items; record task notes or blockers; select Pending, Ongoing, Done or Blocked. Edit vehicle details, notes, team and overall status here.
- **Release:** complete all work, mark Ready for Release, then use Record release when the car actually leaves. Release requires a valid actual time, cannot be in the future, and makes the vehicle and tasks read-only in History. A job with no task list can be marked ready by the manager after their own inspection.
- **Team workload:** view active vehicles and unfinished work by team. Add teams without changing application code. Teams live in the database.
- **Schedule:** view ingress and expected release times for today, tomorrow or any selected date.
- **Daily plan:** choose a date, generate from current database data, review or edit the text, then save a snapshot. Copy or download the plan as plain text. Saved snapshots are available in History. A second save after editing creates a new snapshot.

Tasks never automatically release a vehicle. Starting a task moves an Ingress/Pending vehicle to In Progress. Adding or reopening incomplete work removes Ready for Release. Final Checking and readiness are manager decisions.

Warning rules:

| Warning         | Rule                                                                          |
| --------------- | ----------------------------------------------------------------------------- |
| Blocked         | At least one task is Blocked                                                  |
| Overdue         | Expected release is earlier than now and the vehicle is not Released          |
| At risk         | Release is within 24 hours and work remains; overdue jobs use Overdue instead |
| Missing release | No expected release is set                                                    |
| Unassigned team | No team, or the default Unassigned team                                       |

At risk is a schedule heuristic, not an estimate of task duration. Plans include active vehicles arriving on or before the plan date, releases due on/before that date, ingress on the date, team work, notes and current warnings. Released vehicles are excluded. Warning values reflect generation time.

## Data and reliability

- Supabase is the source of truth for operational records. The client loads paginated records on login, refresh, generation and after successful writes. Use Refresh to pick up changes made elsewhere; there is no realtime subscription.
- Writes complete before the UI reports success. Vehicle creation and initial tasks use one transaction. Vehicle edits and releases check the previous `updated_at`; task edits/deletion also reject stale versions.
- Parent-row locks serialize task changes against release. Constraints and triggers reject invalid states, dates and changes to released work.
- RLS restricts shop tables to administrator-provisioned manager profiles. Unauthenticated users and unprovisioned authenticated users have no operational access. Users cannot create/edit their own profiles. Saved plans permit reads and inserts, but no updates/deletes.
- The Supabase SDK stores login sessions in **sessionStorage**, allowing refresh within the tab. Signing out clears the session; a new browser session requires login. No operational records are written to localStorage, IndexedDB or the service-worker cache.
- Offline writes are not queued. Reconnect before saving. The PWA manifest and service worker provide an offline information page; they do not expose a cached shop board. Service workers register only in production on HTTPS (or localhost). Browser installation support varies.
- A save followed by a failed reload displays a specific message that the change was saved. Refresh before retrying so you do not duplicate a job or snapshot.

## Project map

| File                                  | Purpose                                                 |
| ------------------------------------- | ------------------------------------------------------- |
| `src/main.js`                         | Screens, forms and UI events                            |
| `src/styles.css`                      | Responsive visual system                                |
| `src/domain.js`                       | Timezone helpers, filters, warnings and plan generation |
| `src/api.js`                          | Supabase operations and isolated in-memory demo adapter |
| `src/demo.js`                         | Relative-date sample vehicles                           |
| `src/icons.js`                        | Local SVG icon system                                   |
| `supabase/migrations/001_initial.sql` | Database, RLS, lifecycle checks and RPCs                |
| `tests/`                              | Domain and database regression tests                    |
| `public/`                             | PWA manifest, icon, service worker and offline page     |

The database tests run the actual migration against PGlite (embedded PostgreSQL), with stub Auth identities and real PostgreSQL roles/RLS. They verify anonymous and unprovisioned access denial, atomic creation, task constraints, status transitions, stale edits, release rules and snapshot immutability. They do not replace a live Supabase Auth/PostgREST test.

Browser checks covered the mobile add/task/release/history flow, plan generation/edit/save/download, search, team creation, filters, tomorrow's schedule and layouts at 320/390 px. The production setup screen and service-worker offline fallback also passed. Production build and local database checks passed. Live authentication, remote persistence and deployed Netlify headers still need the configured-project verification described above.

## Troubleshooting

- **Demo appears instead of login:** remove `VITE_DEMO_MODE=true`, set both Supabase variables and restart/rebuild.
- **Account not configured:** ensure the `profiles.id` exactly matches the manually created Auth user's UUID.
- **Job changed in another session:** close the dialog, refresh the board, review the current job and apply your change again.
- **Network error:** check connectivity and the project URL. Confirm the Supabase project is available and the public key belongs to it.
- **Release rejected:** finish the work items, mark ready, then enter an actual time between ingress and now.
- **Port 5187 is occupied:** stop that development server or start with `npm run dev -- --port 5188`.

Reference: [Supabase password login](https://supabase.com/docs/reference/javascript/auth-signinwithpassword), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Vite static deployment](https://vite.dev/guide/static-deploy), and [Vite environment variables](https://vite.dev/guide/env-and-mode).
