# Production Scheduler — Review & Redesign Plan

Full-app review of v91, with an executable plan. No code has been changed.

---

## 1. What the app does well (keep all of this)

The **workflow logic is solid** and should be preserved exactly:

- Backward scheduling from ship date: Ship ← Inspect ← Test gate ← Build, with sub-assemblies feeding top levels
- Test as an external gate (estimated hours or manual return date) that consumes calendar but not employee capacity
- Per-employee daily capacity (custom schedules, Friday OT, time off, holidays, freeze window)
- Draft mode on the board — nothing saves until Apply Changes
- Smart Assign with preview/apply, locks, and protections
- Library templates → project instances with build groups and instance labels
- Project health, warnings, Today's Priorities, backups

## 2. Root causes of the split-tile problem

The scheduler produces one item per assembly-phase. The Weekly Board then **explodes each item into one tile per employee per day** (`buildChunks`). A 30-hour build becomes 3–4 near-identical full-size cards scattered across cells. Specific causes:

1. **No segment identity.** Every chunk of the same assembly renders the same card (same description, P/N, Job ID). Nothing says "Day 2 of 3" or "10–20 of 28 hrs." The only hints are tiny "split/Final" badges.
2. **No visual connection between segments.** Each day×employee cell is an independent list. Contiguous multi-day work renders as disconnected tiles instead of one continuous bar.
3. **Tile bloat.** Every tile carries a drag handle, lock button, 4–6 badges, progress bar, an inline % editor with help text, and overall %. The identity info drowns.
4. **Color codes the wrong thing.** The accent color is per *project*; the phase color is per *phase*. Nothing colors per *assembly*, which is the unit you're trying to track.
5. **Duplicated chunking logic.** The chunk-explosion algorithm exists 4 times: WeeklyBoard `buildChunks`, WeeklyBoard `calculateLiveForecast`, Dashboard `expandChunksForRange`, and Planner `buildChunks`. They can drift, and any board fix must be repeated.

### Structural issues found in the wider review

- `components/App.tsx` is 2,016 lines holding ~30 components; `globals.css` is 2,461 lines. Very hard to change safely.
- Repeated inline patterns everywhere: `s.sourceAssemblyId||String(s.id).split('|')[0]` appears ~30 times; date helpers are redefined in 6 components.
- README/db.ts say Neon Postgres but the folder is named "sqlite" and one error message still says "SQLite file" — cosmetic, but confusing.
- Whole app state is one JSON blob saved on every keystroke-level change (fine for single-planner use; noted as a future item, not urgent).
- `TaskCard` computes `hrsBefore` by scanning all chunks per render — O(n²)-ish on large boards; will get slow as data grows.

---

## 3. The redesign — how I would build the Weekly Board from your workflow logic

The mental model your logic implies: **an employee's week is a lane, and an assembly-phase is one continuous block of hours flowing through that lane.** The board should show blocks, not per-day confetti.

### 3a. Span bars instead of per-day tiles (the core change)

Keep the same grid (employee rows × Mon–Fri columns), but render each assembly-phase as **one bar per employee per week**, spanning the days it occupies:

```
            Mon        Tue        Wed        Thu
Alex     [■■■■ TLA-100 #1 · BUILD · 28h ■■■■■][SUB-2..]
Jamie    [SUB-200 #1 · 6h ][■ TLA-100 #1 INSPECT ■]
```

- A bar spanning Mon–Wed replaces three duplicate tiles. Day boundaries stay visible inside the bar (subtle ticks with per-day hours, e.g. `10 | 10 | 8`).
- If work is non-contiguous (skips a day off), the bar breaks into segments that share color and a connector marker, each labeled `1/2`, `2/2`.
- Per-day capacity badges, overload highlighting, Friday OT toggle, unavailable shading all stay exactly where they are.

### 3b. Assembly identity system

- **Stable color per assembly instance** (derived from assembly id), used as the bar fill tint. Phase stays as a left-edge stripe + badge (BUILD/INSPECT/SHIP), project as a small code chip. You instantly see "the green one" continuing across days, rows, weeks.
- **Hover/click an assembly → highlight every sibling segment** (all phases, all employees, all weeks in view) and dim everything else — including its Test-row entry. This alone solves "what is what."
- Each segment shows: `Day 2/3 · 18 of 28 hrs`, instance label, and completion state (your existing done/partial tile logic, kept).

### 3c. Slim tiles + detail popover

Move the inline % editor, lock button, overall %, and reset-split out of every tile into a **click popover** per assembly:

- Mini phase timeline: Build → Test gate → Inspect → Ship with dates, late flags, dependency names
- % complete editor (build) / complete toggles (inspect, ship)
- Lock, reset split, jump-to-project
- Segment list (which employee, which day, how many hours)

Tiles then carry only: color, phase badge, description + instance, hours-this-block, day x/y, and status flag. Ultra density becomes genuinely ultra.

### 3d. Interactions preserved

- Drag a whole bar to move all its days; drag a single day-segment (grab the day tick) to split/move just that day — same `manualWorkSegments` model underneath, same draft/Apply flow, same guards (locks, freeze, capacity, test gates, ship-date checks).
- Unassigned row and In Test row keep working; unassigned bars show the Smart Assign suggestion chip as today.

---

## 4. Execution plan

### Phase 0 — Safety net (do first, ~30 min)
1. `git init` + initial commit (folder has a .gitignore but no repo yet — confirm; README implies git usage).
2. Verify `npm run build` passes clean before touching anything. Manual smoke checklist written down (board drag, apply, smart assign, exports, mobile view).

### Phase 1 — Refactor with zero behavior change (~1 session)
1. **Extract `lib/chunks.ts`** — the single chunk/segment engine: `expandChunks(data, schedule, range?)`, `liveForecast(...)`, `sourceIdOf(item)`, shared date helpers. Wire WeeklyBoard, Dashboard, Planner, and the exports to it. Delete the 4 duplicates.
2. **Split `App.tsx`** into `components/tabs/` (WeeklyBoard.tsx, Dashboard.tsx, Projects.tsx, …) and `components/shared/` (TaskCard, badges, CollapsibleSection, EmployeePicker). App.tsx keeps only shell/nav/state.
3. Add `lib/format.ts` (fmtDate, splitIds, etc.) to kill the redefinitions.
4. Verify: build passes, board behaves identically.

### Phase 2 — Weekly Board overhaul (~2 sessions)
1. New `WeekLaneGrid` renderer: CSS grid where bars use `grid-column: span N` within each employee row; day cells remain drop targets.
2. Assembly color assignment + highlight-siblings interaction (one `focusedAssemblyId` state, CSS dimming — same pattern as your existing project-focus dim).
3. Segment labels (`Day x/y`, cumulative hours) computed once in the chunk engine, not per-card render (fixes the O(n²) scan).
4. `AssemblyDetailPopover` with phase timeline, % editors, lock, segments; strip those controls from tiles.
5. Drag: whole-bar move + single-day split-move, mapped to existing `addBoardDraft`/`manualWorkSegments`/`applyBoardDrafts` unchanged.
6. Keep Current/Live modes; Live forecast bars get the existing Moved/Hold styling.
7. Density modes collapse bar height, not information.

### Phase 3 — Ripple views (~1 session)
1. Excel/PDF/print exports read from the shared chunk engine (output unchanged or improved with Day x/y column).
2. Dashboard "Work by Employee" and Planner reuse the engine.
3. Monthly Calendar + Gantt adopt the same assembly colors so cross-view tracking works.
4. Mobile viewer: same bar/segment labels in read-only form.

### Phase 4 — Verification & cleanup (~half session)
1. Run the smoke checklist on sample data + an imported backup of your real data.
2. Dark mode + print pass on the new board.
3. Rename stale "SQLite" references (error message, README title) to match the Neon reality.
4. Commit per phase so any step can be rolled back.

### Deliberately deferred (bigger overhaul, only if wanted later)
- Normalizing the single-JSON-blob storage into tables / multi-user safety (currently last-write-wins)
- Undo history for board edits (draft mode already covers most of it)
- Virtualized rendering for very large boards

---

## 5. Decision points before executing

1. **Bar granularity default:** whole-week span bars with day ticks (recommended) vs. keeping one-tile-per-day but grouped/connected visually (smaller change, less payoff).
2. **% editing location:** popover-only (recommended, cleanest tiles) vs. keep inline editor on the *last* segment of each assembly.
3. Phase 1 refactor is strongly recommended but the board overhaul could technically be done inside the current App.tsx if you want the fastest path (not advised — it's already at the edge of maintainability).
