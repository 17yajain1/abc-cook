# PR-B4: wait-window task order (scheduler `rank_in_window`)

**Owner decision 2026-10-14:** the fix belongs in the scheduler's `rank_in_window`, as a
separate PR-B4 with golden changes. **Must merge before R2**, like PR-B3: once R2 ships,
sabudana shows both orders on one screen (the outline's correct `Roast, Grind` above the
Plan card's `Grind, Roast`). Do not touch it in R2.

Found 2026-10-14 while building R2 Step 1. Read-only finding; nothing changed.

**Observation.** `WaitWindowBlock` renders `window.tasks` in `plan.windows[].assigned` order
(`derive.ts` maps `window.assigned` straight to `tasks`; the first is promoted as
"Start with this"). `assigned` is rank order (`rank_in_window`), not cooking order.

**Confirmed in the render** (sabudana-khichdi fixture, 390 px, Plan tab):
- Stage card "Cook": `Meanwhile: Grind peanuts, Roast peanuts, Make chutney`
- Expanded window block: `Start with this` -> **Grind peanuts**, then Roast peanuts, then Make chutney

`Grind peanuts` depends on `Roast peanuts`. The scheduler starts Roast at minute 5 and Grind
at minute 10 (`rank_in_window`: Grind 0, Roast 1, Make chutney 2). A cook following
"Start with this" would grind unroasted peanuts.

**Why it matters.** Same class as the R2 task-line problem, which R2 sidesteps by ordering
on `scheduled[].start_min` (decision 8, amended 2026-10-14). The Plan tab has no such
guard.

**Decided.** Fix in the scheduler: `rank_in_window` must respect dependencies among the window's own tasks, so "Start with this" names a task that can actually start first. This is a golden change, so it is surfaced, not silently regenerated. R2 keeps ordering its own task lines by `start_min`.
