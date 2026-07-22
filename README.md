# Assembly Scheduler

Production scheduler for mechanical assembly work: backward scheduling from ship
dates through Build → Test → Inspect → Ship, per-employee daily capacity, drag-and-drop
weekly board, and Smart Assign.

Data is stored in Postgres (via [Neon](https://neon.tech)), so it works on serverless
hosts like Vercel — no local file storage required.

## Pages

- **Today** — KPI strip, one prioritized Needs Attention feed, Today's Crew, Coming Up
- **Board** — the Weekly Board: per-assembly colors, click-to-highlight with flow lines, drag-and-drop with draft mode, Smart Assign, Live Forecast
- **Plan** — Planner (capacity/risk/load/shipments/conflicts), Calendar, Timeline, Capacity, read-only Master Schedule
- **Projects** — project list with health filter and On Hold chip, assemblies, batches, holds
- **Library** — reusable assembly templates and sub-assembly trees
- **People** — roster and per-person detail (roles, preferred projects, weekly schedule) plus the Availability calendar
- **Admin** — settings, database-backed backups and restore

## Local development

```bash
npm install
npm run dev
```

```text
http://localhost:3000        desktop editor
http://localhost:3000/mobile read-only phone view
```

## Environment variables

Create a `.env.local` file in this folder (or set these in your host's dashboard for
production) with:

```text
DATABASE_URL=postgres://...
ANTHROPIC_API_KEY=sk-ant-...
SITE_PASSWORD=choose-a-strong-shared-password
```

- **DATABASE_URL** — required. Connection string for your Postgres database. Tables are
  created automatically on first use.
- **ANTHROPIC_API_KEY** — required for the 🤖 AI Agent panel (server-side proxy; the key
  never reaches the browser).
- **SITE_PASSWORD** — recommended once this is reachable from outside your own machine.
  `middleware.ts` adds a shared-password gate (HTTP Basic Auth) covering every page and
  API route.

## Deploying to Vercel (GitHub-connected)

1. Push to GitHub.
2. Import the repo at [vercel.com/new](https://vercel.com/new) — Next.js is auto-detected.
3. Add a Postgres database: project → Storage → Neon. This sets `DATABASE_URL`
   automatically (use the pooled connection string).
4. Add `ANTHROPIC_API_KEY` and `SITE_PASSWORD` in Project Settings → Environment Variables.
5. Vercel redeploys automatically on every push to main.

## Backups

Snapshots are stored in the database (`app_backups` table): automatic every ~30 minutes
while working, manual from Admin → Reports/Backup, most recent 40 kept. Restore always
creates a safety backup first. Saves are conflict-guarded — a stale browser tab is asked
to reload rather than being allowed to overwrite newer data.
