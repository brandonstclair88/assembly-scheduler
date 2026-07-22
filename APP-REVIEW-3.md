# App Audit #3 — Post-Completion Health Check

Third pass, after all items from APP-REVIEW and APP-REVIEW-2 shipped. This audit covered the previously-unreviewed corners (middleware, AI Agent route, mobile-host route, page shells) and re-checked the recent refactors for introduced problems. Codebase: ~3,200 lines of components + ~2,500 lib/CSS, split cleanly per tab.

**Overall verdict: healthy.** No duplicated engines remain, all mutations flow through one path, data is conflict-guarded and backed up server-side, and every page follows the list→detail pattern. What's left below is small — four genuine fixes, a few nice-to-haves, and one known architectural wart that's fine to live with.

## Genuine fixes (small, worth doing)

**F1. Basic-auth requires the username to be exactly `scheduler`.** `middleware.ts` compares the full `Basic base64("scheduler:password")` string, so someone typing their own name as username gets rejected even with the right password — a support trap for anyone you share the link with. Fix: decode the credentials and compare only the password.

**F2. Undo Apply can fight a backup restore.** The board's undo stack survives tab switches (by design), but it isn't cleared when you restore a backup or import data. Clicking "Undo Apply" right after a restore would overwrite the restored assemblies with pre-restore board state. Fix: clear the stack whenever data is wholesale-replaced (restore, import, reset).

**F3. Mobile page title still says "v91".** `app/mobile/page.tsx` metadata. One-line rename.

**F4. Two spurious imports.** `load` is imported but unused in AdminTab and PlanTab (a string in the code tripped the import generator). Harmless, but two-second removals.

## Nice-to-haves (optional)

**N1. Flow view chips could be clickable** — jump to the Weekly Board with that assembly focused (the intent plumbing already exists via `focusWeeklyBoard`).

**N2. AI Agent is behind the app.** It works (server-proxied, key never in browser), but its snapshot mislabels assembly `type` as `phase`, it caps replies at 1,000 tokens, and it doesn't know about newer concepts (locks vs. drafts vs. flow). A refresh of its snapshot/system prompt would make it noticeably smarter about the current app.

**N3. Toast stack is unbounded** if many errors fire at once; capping at ~4 visible would be tidier.

**N4. globals.css is one 2,500-line file.** All live rules now, but per-page splitting would help future work.

## Known wart (fine to live with)

**W1. Nested component definitions.** TaskCard, the detail panel, and the Smart Assign panels are defined *inside* WeeklyBoard (the codebase's original pattern), which means React re-creates them on every board render. It works and has been stable, but it's the main reason board renders do more work than they need to; hoisting them to top-level components with props is the one remaining structural improvement if the board ever feels slow with a large dataset.

## Verified clean this pass

- All 24 browser popups converted; no raw `alert`/`confirm` remain outside the deliberate fallback.
- No nested exports, unbalanced delimiters, or unresolved imports in any component file.
- API routes: data (conflict-guarded), backups (CRUD + restore + safety snapshot), ai-agent (key server-side, errors surfaced), mobile-host (LAN detection) — all sound.
- Middleware covers pages *and* API routes; statics excluded correctly.
- Shared engines: chunks, migrate, format, mutations, persistence each exist exactly once and are imported everywhere they're needed; MobileViewer can no longer drift.
- Legacy field pairs mirrored canonically in one place; AI Agent reads canonical fields.
- Dead CSS from all removed UI pruned; new features (toasts, confirm, flow view, move row) styled with dark-mode variants.

## Suggested action

Do F1–F4 as one small commit; pick up N1/N2 if wanted. Then the sensible move is to *stop* — use the app for a few weeks and let real friction, not audits, drive the next change.
