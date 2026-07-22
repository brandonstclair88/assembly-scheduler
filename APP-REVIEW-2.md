# App Audit #2 — Post-Redesign State

Follow-up to APP-REVIEW.md after: Phase A (foundation), Phase B (7-tab IA), Phase C1/C2 (board identity + flow lines), and Items 1–5 (data safety, dashboard, projects, people, planner consolidation). Codebase is now ~8,500 lines. What remains, ordered by value.

## A. Correctness & drift risks

**A1. MobileViewer has its own `migrate()`.** The mobile viewer duplicates the data-migration function plus fmtDate/splitIds/taskHours/completion math (~100 lines). If the desktop schema evolves, mobile silently mis-migrates. Highest-priority remaining refactor: extract `lib/migrate.ts` and `lib/format.ts`, import from both.

**A2. Two chunk-engine copies remain (known, deliberate).** `calculateLiveForecast` (board Live mode) and `smartAssign.buildScheduleChunks` are genuinely different algorithms, but they re-implement the same day-iteration/capacity walk. Move both onto helpers from `lib/chunks.ts` so calendar rules live once.

**A3. Dashboard "Next Production Day" still assumes Mon–Thu.** Ignores Friday OT and custom employee schedules. Should walk forward with `capacityForDate` instead.

**A4. `dependsOn` still means two things.** Sequence-after (single, from the Projects dropdown) vs dependency list (multi, legacy). Add a one-time migration to a separate `sequenceAfterId` field and keep `dependsOn` purely for dependencies.

**A5. Legacy field pairs still written.** `pto`/`timeOffDates`, `trainedProjectIds`/`preferredProjectIds`, `limitAutoAssignToTrainedProjects`/`preferPreferredProjects`. One-time migration to canonical names; AIAgent's snapshot still reads a legacy one (`limitAutoAssignToTrainedProjects`).

**A6. Percent/status sync exists in 3 places.** `syncAssemblyPercentStatus`, board `updateCompletion`, and hold-sync in `changeAsm`. The planned `lib/mutations.ts` (setPercent / setHold / assignEmployee) would make every path consistent.

## B. UX polish

**B1. 24 native `alert()`/`confirm()` dialogs.** Most disruptive on the board, where drag-validation failures pop a blocking browser alert mid-drag. Replace with an in-app confirm dialog and toast notifications.

**B2. Library Tree Builder edits shared subs inline.** Typing in a sub's P/N inside a top-level's tree silently changes that sub for every other top level using it. Make tree rows read-only labels with an "edit this sub" jump.

**B3. Global search doesn't deep-link.** Clicking an assembly result opens the Projects tab but not that project/assembly. The `panelIntent` plumbing already exists — wire search results to it.

**B4. No keyboard alternative to drag.** Add a "Move…" control in the board's detail panel (pick employee + date, runs the same canDrop/draft path). Helps precision and accessibility.

**B5. Detail panel navigation.** Small win: prev/next buttons cycling through the focused assembly's family (the same set the flow lines trace).

## C. Code health

**C1. File split (the big one left).** App.tsx is 2,048 lines / MobileViewer 1,102. Now that Vercel verifies builds, split into `components/tabs/*` + `components/shared/*`. Biggest remaining maintainability win; purely mechanical.

**C2. Dead CSS.** ~45+ orphaned rule blocks from removed UI: `completionEdit` (12), `pageNav*` (24), `dragHandle` (9), `subNumber`, `sequenceHint`, old Holds/Backup styles. Prune pass on globals.css (2,526 lines); optionally split per page.

**C3. Orphaned files/naming.** `lib/sqljs.d.ts` is a leftover stub (sql.js is gone) — delete. README still titled v91/talks about old nav — refresh. Folder name still says "sqlite" (renaming the folder breaks your git checkout path — only do it deliberately).

## D. Bigger optional ideas

**D1. Flow view.** The full always-on spaghetti as a Plan sub-tab: assemblies as nodes, dependency + phase-order arrows, same assembly colors as the board.

**D2. Real undo for board applies.** Draft mode covers pre-apply; an undo stack for the last few Apply Changes / Smart Assign runs would cover post-apply regret. (The DB backups are the coarse fallback.)

**D3. Login sessions.** Basic-auth shared password is fine for now; per-person logins would enable "who changed what" history later.

## Suggested batches

1. **Quick wins:** A3, A5 (+A4 migration), C3, C2. Small, safe, one push.
2. **Shared-code batch:** A1 (migrate/format extraction), A2, A6 — ends the drift class for good.
3. **File split:** C1 (mechanical, big diff, do alone).
4. **UX batch:** B1–B5.
5. **Optional:** D1/D2 when the mood strikes.
