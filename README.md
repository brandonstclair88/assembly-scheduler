# Assembly Scheduler v91

This version saves scheduler data to a Postgres database (via [Neon](https://neon.tech)),
so it works on serverless hosts like Vercel — no local file storage, no persistent disk
required.

## Local development

```bash
npm install
npm run dev
```

You'll need a `DATABASE_URL` before the app can read or save data (see below). Everything
else works the same as before:

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

- **DATABASE_URL** — required. Connection string for your Postgres database. The table is
  created automatically on first use. See "Deploying to Vercel" below for the easiest way
  to get one.
- **ANTHROPIC_API_KEY** — required for the 🤖 AI Agent panel. It calls Claude through the
  server-side `app/api/ai-agent` route so the key never reaches the browser. Without it set,
  the AI Agent shows a clear setup error instead of failing silently.
- **SITE_PASSWORD** — recommended once this is reachable from outside your own machine.
  `middleware.ts` adds a shared-password gate (HTTP Basic Auth) covering every page and API
  route. If left unset, the app stays open (fine for local-only development). The browser
  will prompt for a username (any value works, e.g. `scheduler`) and this password.

## Deploying to Vercel (GitHub-connected)

1. **Push this project to a GitHub repo.** From this folder:
   ```bash
   git init
   git add .
   git commit -m "Assembly Scheduler v91"
   ```
   Then create a repo on GitHub (via github.com, or `gh repo create` if you have the GitHub
   CLI) and push to it — GitHub will show you the exact `git remote add` / `git push`
   commands for your new repo.

2. **Import the repo in Vercel.** Go to [vercel.com/new](https://vercel.com/new), sign in
   with GitHub, and import the repo. Vercel auto-detects Next.js — no build config needed.

3. **Add a Postgres database.** In your new Vercel project, go to Storage → Create Database
   (or Marketplace) → Neon → Postgres. Connecting it to your project automatically sets
   `DATABASE_URL` or `DATABASE_URL_UNPOOLED` in your project's environment variables — no
   copy-pasting connection strings required. (Note: `DATABASE_URL_UNPOOLED` is the direct
   connection; if only that's set, also add `DATABASE_URL` pointing to the pooled connection
   Neon shows in its dashboard, since serverless functions should use the pooled one.)

4. **Add the other environment variables.** In Project Settings → Environment Variables, add
   `ANTHROPIC_API_KEY` and `SITE_PASSWORD`.

5. **Deploy.** Vercel redeploys automatically on every push to your main branch from here on.

## What's included

- Weekly Board sticky headers, empty-row collapse, and ultra compact density
- Today's Priorities on desktop and mobile
- Desktop mobile QR access and stronger sub-assembly search
- Dark-mode readability polish across the dashboard, projects, availability, and board
- 🤖 AI Agent panel for Smart Assign analysis (server-proxied Claude calls)
- Shared-password gate for public deployments
