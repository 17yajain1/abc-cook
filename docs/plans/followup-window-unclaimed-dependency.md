# Follow-up: a window task whose dependency the window did not claim

**Status:** this is a plan only and is not implemented. I found it while planning PR-B4
(`docs/plans/pr-b4-implementation.md` §3) on 2026-10-15. B4 doesn't fix it, and doesn't
make it worse.

## Shape

§4.4 ownership walks the hands-on tasks that ran inside a host's interval and claims each
task that passes both gates: typical packing and the `duration_max` safety check. A task's
dependency can run inside that same interval and still be left **unclaimed** by the window
for three reasons:

- it fails the typical-packing gate;
- it fails the `duration_max` gate;
- it was already claimed by an earlier window (one task, one window).

The window then lists the consumer without its dependency.

## Why "Start with" misleads

With B4, `rank_in_window` follows the timeline. Rank 0 is the first **claimed** task to
start, but an unclaimed dependency still runs before it, during the window. The block says
"Start with this → Grind peanuts", while the cook actually has to roast first. Roast shows
up elsewhere as a serial step. Nothing in the window says it has to happen first.

No current golden or web fixture has this shape.

## Reproducing graph (synthetic, checked in memory 2026-10-15)

| id | attention | typical | max | depends_on |
|---|---|---|---|---|
| `host` | unattended | 14 | 14 | — |
| `roast` | hands_on | 5 | **13** | — |
| `grind` | hands_on | 5 | 5 | `roast` |
| `chutney` | hands_on | 3 | 3 | — |
| `serve` | hands_on (finish) | 1 | 1 | `host`, `grind`, `chutney` |

The window capacity is 14 × 0.9 = 12.6. The timeline is `roast` 0–5, `grind` 5–10 and
`chutney` 10–13, all inside the host interval.

`roast` fails the `duration_max` gate (13 > 12.6), so the window ends up as
`assigned = [grind, chutney]`, with `grind` at rank 0. That's the same before and after B4.

## Proposed direction: ownership, not rank

Rank can't fix this, because the dependency isn't in the list to rank. The change belongs
in §4.4 ownership. One candidate rule: **a window doesn't claim a task whose ancestor ran
inside the same host interval but was not claimed by this window.** That task then becomes
a serial step too, so the window never promotes a task the cook can't start yet.

Before choosing, look at:

- **Effect on the goldens.** It would likely be none today, but run all of them.
- **Whether dropping the consumer is too conservative.** An alternative is to claim the
  dependency anyway and warn when it exceeds the gate. That has to be checked against the
  "wrong advice" principle, because the gates exist so the advice stays safe.
- **The same check for dependencies claimed by an *earlier* window.** Is a dependency
  that's shown in another window block acceptable, or misleading?

This is a product decision, so it needs the owner's call before any implementation. It
would be a golden change and a `POSTPROCESS_VERSION` bump.
