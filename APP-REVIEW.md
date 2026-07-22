# Full App Review — Redundancies, Issues, and Page-by-Page Layout

Supersedes the board-only notes in REDESIGN-PLAN.md. This is the step-back view: what I'd change about the whole app before touching individual tiles.

---

## Part 1 — The big structural problems

### 1.1 The same logic is written 6 times

The "explode a scheduled item into per-day, per-employee chunks" algorithm exists in **six places**, each slightly different:

| Location | Used for |
|---|---|
| `WeeklyBoard.buildChunks()` | the board |
| `WeeklyBoard.calculateLiveForecast()` | Live mode |
| `Dashboard.expandChunksForRange()` | today/week panels |
| `Planner.buildChunks()` | planner views |
| `MobileViewer` (own copy) | phone view |
| `lib/smartAssign.buildScheduleChunks()` | suggestions |

Guard limits differ (120 vs 240 vs 365 iterations), sorting differs, manual-segment handling differs. Any fix must be made 6 times, and views can disagree about the same schedule. **This is the single highest-value refactor in the app: one `lib/chunks.ts`, used everywhere.**

### 1.2 Two competing "fix my schedule" systems

- **Weekly Board** → Smart Assign (lib/smartAssign.ts): preview panel, scoring, locks, apply/results.
- **Planner** → its own hand-rolled issue engine + `suggestOpenMoves()` + "Preview Smart Assign Rebalance" + its own undo.

They have similar names, different logic, and can give different answers. The Planner version also duplicates dependency/test-gate warnings that `lib/scheduleWarnings.ts` already computes. **Pick one engine (the lib), and make Planner a consumer of it.**

### 1.3 Three overlapping "what's wrong" feeds

Schedule Warnings (lib), Planner Issues (inline), and Dashboard's "Needs Attention"/"At Risk" (inline, third implementation) all re-derive problems from the schedule. A user sees three differently-worded problem lists in three places. **One warnings engine, one severity model, rendered by all pages.**

### 1.4 Duplicated data fields (sync bugs waiting)

- `assembly.status==='On Hold'`/`holdReason` **and** the separate `holds[]` list, manually synced in `changeAsm` — the Holds page can drift from reality if edits happen elsewhere (Master Schedule status dropdown does not sync holds).
- `pto` vs `timeOffDates` — legacy pair, both written.
- `trainedProjectIds` vs `preferredProjectIds` and `limitAutoAssignToTrainedProjects` vs `preferPreferredProjects` — always written in pairs to mean the same thing.
- `dependsOn` doubles as "dependency list" (multi) and "sequence after" (single) — the Projects card writes a single value and sets `overrideDependencies`, the old table wrote multi-select. Same field, two meanings.
- `percent`/`status` sync logic exists in `syncAssemblyPercentStatus`, again in Weekly Board `updateCompletion`, again in Master Schedule inline edits.

**Plan: migrate to single canonical fields (a one-time migrate() pass), and route every mutation through one `lib/mutations.ts` (e.g. `setPercent`, `setHold`, `assignEmployee`) so the sync rules live once.**

### 1.5 Dead code

`ProjectAssemblyTable` (the entire 19-column editable table + `BatchPicker` + its duplicate `completionCap`/`hasHeldSubs`), `LibraryItemRow`, `Crud`/`CrudInner`, and `K` are **never rendered**. `lib/autoAssign.ts` is a 1-line stub. Delete all of it (~150 dense lines).

### 1.6 Hardcoded constants that contradict Settings

Test-gate math on the Weekly Board uses a hardcoded `remaining -= 10` (hrs/day) in `addShopWaitDays` and `scheduleWait`, while the scheduler uses `dailyHours(settings)`. They agree only because the default settings happen to equal 10. Change workday times in Settings and the board's test-release dates silently diverge from the scheduler's. Same class of issue: Dashboard's "next production day" assumes Mon–Thu and ignores Friday OT and custom employee schedules.

### 1.7 Persistence risks

- Every keystroke in unbuffered inputs (descriptions, notes, batch fields…) triggers a full-dataset POST to Neon. Needs debounce (~1–2s) + a tiny "Saved ✓ / Saving…" indicator.
- Two open browsers = silent last-write-wins data loss. Minimum fix: send `updated_at` with each save, reject stale writes, prompt to reload.
- Backups live in **browser localStorage** while data lives in **Postgres** — a new browser has no backup history, and clearing the browser deletes backups. Move snapshot history into a second DB table.
- Naming: folder/README/error text still say "SQLite"; storage is Neon Postgres. Cosmetic but confusing.

### 1.8 UI-pattern inconsistency (why pages feel chaotic)

Across pages there are four different editing paradigms (giant editable tables, tile + detail editor, inline card forms, native `confirm()`/`alert()` popups), three different filter-bar styles, and controls stacked wherever they fit. The pages that feel best (Assembly Library, Projects sidebar) share one pattern: **list on the left → detail editor on the right, with a single toolbar.** The redesign should make that the house pattern, plus: one shared `<Toolbar>`, `<FilterBar>`, `<DataCard>`, and a proper confirm/toast component instead of `alert()`.

---

## Part 2 — Page-by-page layout review

### Navigation (all pages)
14 destinations hidden behind a "Page ▾" dropdown — you can't see where you are or what exists. Primary/secondary split is arbitrary (Weekly Board is primary, Master Schedule secondary; Capacity/Planner/Availability overlap).
**Recommendation — consolidate 14 pages → 7 visible tabs:**

| New tab | Absorbs |
|---|---|
| **Today** | Dashboard |
| **Board** | Weekly Board |
| **Plan** | Planner + Monthly Calendar + Timeline + Capacity (as view toggles inside one page) |
| **Projects** | Projects + Holds (holds become a filter/badge, not a page) |
| **Library** | Assembly Library |
| **People** | Employees + Availability (one page: roster list → person detail with calendar) |
| **Admin** | Settings + Reports/Backup |
Persistent top tab bar (fits easily), global search stays. Master Schedule becomes an "export/table view" button on Board or Plan.

### Dashboard
Eight panels of mixed density; three of them (Priorities, Needs Attention, Schedule Warnings) are variations of the same problem list, and Project Health preview duplicates the Projects page. KPI strip is good.
**Layout fix:** 3 zones — KPI strip; ONE prioritized attention feed (merged warnings engine, severity-sorted, each row with its jump action); right rail with Today's crew (work by employee + who's out) and next shipments/test returns. Cuts 8 panels to 4 with zero information loss.

### Weekly Board
Before any schedule content you can stack: header + 3 toolbar groups + project-focus bar + draft notice + capacity `<pre>` dump + Smart Assign panel + results panel + warnings toggle. That's the chaos.
**Layout fix:** one slim toolbar (Month · Search · Filters ▾ · Density ▾ · Mode) with the rest in an overflow menu; Smart Assign and Warnings become right-side **drawers**, not inline panels that push the grid down; "Find open capacity"/"Show conflicts" results render as highlighted cells on the board itself instead of a raw text block. Tile redesign (span bars, assembly colors, popover) stays as specified in REDESIGN-PLAN.md.

### Planner
Good idea, but it's a second app bolted on: own issue engine, own rebalance, own undo, 5 view toggles that each render totally different layouts. Heatmap and Risk views are useful; Dependencies view duplicates warnings; Employee Load duplicates Capacity page.
**Fix:** Planner becomes the "Plan" tab shell hosting: Heatmap (capacity), Risk, Calendar (from Monthly Calendar), Timeline (Gantt). All four share the same filters, horizon, and the shared warnings/chunks engines. Delete its private issue/rebalance code.

### Monthly Calendar / Timeline / Capacity
Three separate pages, each with its own month picker and filters, each re-deriving groups from schedule. All become views inside Plan (above). The Gantt is decent; give it the same assembly/project colors as the Board so cross-view tracking works.

### Master Schedule
A 19-column editable table mixing read-only schedule output with live editing (%, status, ship date) — edits here bypass the hold-sync and percent rules elsewhere. Horizontal scroll with no frozen columns.
**Fix:** make it a read-only sortable/exportable table (frozen first 3 columns), row click → opens the assembly editor. All editing goes through the one mutations layer.

### Projects
The strongest page structurally (sidebar + collapsible sections) but overloaded: the TopLevelCard is ~15 fields + banner + summary strip + hint box, and every nested sub repeats ~10 inline fields; six collapsible sections precede the actual assemblies. The Project Calendar hidden inside is a fourth calendar implementation.
**Fix:** keep sidebar; reorder main column to lead with **Assemblies** (the thing you come here for), then Details/Timeline/Warnings collapsed. Slim TopLevelCard to the summary strip + phase checklist, moving rarely-touched fields (batch, sequencing, test return, cap%) into an "Advanced" disclosure. Sub rows become one-line rows (P/N · employee · % · status) expanding on click. Project Calendar moves to the Plan tab with a project filter.

### Assembly Library
Best page in the app — list → editor, clear sections. Two real issues: the Tree Builder edits the *shared library sub* inline (changing a P/N there silently changes it for every other top level using it — should be read-only labels + "edit sub" link), and Delete/Archive/Where-Used rely on `alert()`.

### Employees
A table where single cells contain an entire search-and-pick component (ProjectTrainingPicker) and a 5-day hours grid. Rows are ~300px tall; horizontal scroll; impossible to scan.
**Fix:** People page = roster list (name, active, role chips B/I/S, load) → person detail panel with Profile / Roles / Preferred projects / Weekly schedule / Time-off calendar (absorbing the Availability page's per-employee calendar). Company holidays move to Admin or a small card on People.

### Availability
Internally fine (calendar toggling works well) but it's 80% per-employee — merge into People as above; holidays are settings-like data.

### Holds
A page for data that's already on each assembly and auto-synced. Becomes a filter chip on Projects ("On Hold (3)") and a Dashboard feed line. Page deleted.

### Reports/Backup, Settings
Both fine, merge into Admin. Move backup storage server-side (1.7). Settings gains the debounced-save indicator and a "data health" line (last save, DB configured).

### Mobile Viewer
1,158-line parallel implementation of dashboard+board logic. After the shared chunks/warnings extraction it should shrink to a thin read-only renderer of the same data (~300 lines) and stop drifting from desktop numbers.

---

## Part 3 — Execution order

**Phase A — Foundation (no visible change)**
1. git init + commit; `npm run build` baseline.
2. Extract `lib/chunks.ts`, `lib/mutations.ts`, `lib/format.ts`; point all 6 chunk copies and all percent/hold/assign edits at them.
3. Delete dead code (1.5); fix hardcoded 10-hr day (1.6); debounced save + stale-write guard (1.7).
4. Split App.tsx into `components/tabs/*` + `components/shared/*` (Toolbar, FilterBar, Drawer, ConfirmDialog, DataCard).

**Phase B — Information architecture**
5. New 7-tab nav; merge Capacity/Calendar/Timeline into Plan; merge Availability into People; retire Holds page; Master Schedule → read-only view.
6. Dashboard → 4-zone layout on the unified warnings engine.

**Phase C — Weekly Board overhaul**
7. Span-bar board, assembly colors, sibling highlight, detail popover (per REDESIGN-PLAN.md), rendered from `lib/chunks.ts`.

**Phase D — Page polish**
8. Projects card slimming; Library tree-builder fix; People detail page; Mobile viewer slim-down; exports off the shared engine; dark-mode/print pass; rename SQLite → Postgres references.

Each phase ends with a commit and a smoke test (drag/apply, smart assign, imports/exports, mobile).

**Decisions (approved 2026-07-21):** 7-tab structure approved. Holds page retired **but placing assemblies on hold is unchanged** — hold/status fields stay on assemblies in Projects and the board; open holds surface as a Projects filter chip and Dashboard feed. Master Schedule goes read-only.
