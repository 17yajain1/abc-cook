---
name: handoff
description: Write a handoff note so the next session can continue this work cheaply. Slash-command only.
disable-model-invocation: true
argument-hint: "[--force]"
---

# /handoff

Write one handoff note, update memory, print a one-line paste-to-start prompt. Never start the next task.

## 1. Locate
Run in Bash:
- `COMMON=$(git rev-parse --path-format=absolute --git-common-dir)`; MAIN = parent directory of COMMON (today `C:\Users\ashya\Music\ABC cook`).
- BRANCH = `git branch --show-current`; WT = `git rev-parse --show-toplevel`; HEAD = `git rev-parse HEAD`.
- Notes go to `MAIN/notes/handoff/` (create it if missing). Never write notes inside a worktree.
- `git fetch origin`. If the fetch fails, use the existing `origin/main` and record "fetch failed, origin/main may be stale" in the note. Local `main` is stale; never use it as a base.

## 2. Gate (skip entirely if the arguments contain `--force`)
1. `git status --porcelain --untracked-files=no` non-empty -> REFUSE (tracked changes only). Print the status and stop. Untracked files never block; list them (`git status --porcelain` lines starting `??`) as a warning under State in the note. The main checkout always has an untracked `ROADMAP.md`.
2. Changed areas: `git diff --name-only origin/main...HEAD`.
   - `apps/api/` changed -> from `apps/api`: `.venv/Scripts/python -m pytest -m "not llm" -q`; if `abc_cook/schedule/` changed also `.venv/Scripts/python -m pytest tests/test_schedule.py -q`.
   - `apps/web/` changed -> from `apps/web`: `npx tsc --noEmit`, plus `npx vitest run <only the test files changed on the branch or beside changed sources>`. NEVER run the full vitest suite (harness-synced worktrees break it).
   - Docs/notes-only change -> no tests; say so in the note.
3. Any command fails -> REFUSE. Print the exact command and the last 30 lines of its output. Stop. Do not write a note.

## 3. Gather (read-only)
- Commits ahead of base: `git log origin/main..HEAD --format="%h %s"`.
- Pushed? `git rev-list --count @{u}..HEAD` (no upstream = "not pushed, no upstream").
- Active plan file: the plan this session worked from (path given in the conversation or the memory entry). If none is evident, write "none".
- Matching memory file: the one in the project memory directory for this work (grep `MEMORY.md` for the branch, worktree or plan name). If none, you will create exactly one.

## 4. Write `MAIN/notes/handoff/<BRANCH with / replaced by ->-<YYYY-MM-DD>.md`
If the file exists, add `-2`, `-3`. Sections, in this order. Be terse; every line should save the next session a file read.

- **Goal** — one or two sentences.
- **State** — worktree WT, branch, HEAD SHA, pushed or not, fetch status, untracked-file warning if any. (`/pickup` checks these.)
- **Done** — commit SHAs with subjects; tests run and their result (command + pass/fail), or "gate skipped (--force)".
- **Decisions** — each with a one-line reason. Include owner decisions made in this session.
- **Next steps** — numbered, each with file paths. Carry every owner STOP / HARD STOP point **word for word**, in quotes, at the step it guards. Copy from the owner's messages and the plan file; never paraphrase. If none were given write "No STOP points stated."
- **Don't** — prohibitions (no push, no commit to main, no full vitest, etc.) and the ₹ budget with what is already spent. Word for word where the owner said it.
- **Read first** — specific files and § headings or line ranges. Never a whole big doc (`DESIGN_SYSTEM.md` is ~35k tokens).
- **Recommended model and effort** — the one line for this task, then the routing guide below, verbatim.
- **Design-rule check** — only for design-rule tasks: "List any shipped value that breaks a stated rule." The next session does this when it finishes the task.

### Routing guide (paste verbatim into the note)
```
Model/effort routing — pick by task kind, not by mood:
- Sonnet 5.5, medium: mechanical edits with a clear right answer, fixture/test fixes, doc moves, repointing, cleanup, running a plan that is already written and approved.
- Opus 5.5, high: tasks that must apply product or design rules (CLAUDE.md principles, DESIGN_SYSTEM.md, copy rules), scheduler/schema/extractor changes, anything with ambiguous scope, and all planning.
- Plan on Opus; implement in a fresh Sonnet session from the written plan when every decision is already made.
- Escalate to Opus if Sonnet needs two corrections on the same point, or the task touches parallelism, timing, or anything a cook could act on at a hot stove.
- Never use low effort for schedule/, schema/, or cooking-instruction wording.
```

## 5. Memory
No status in memory; all status lives in the note. In the ONE matching memory file keep exactly one line, `Latest handoff: <note path>`, replacing any earlier such line. Keep the file's single line in `MEMORY.md` pointing at it; do not edit anything else in `MEMORY.md`. If no matching file exists, create one (frontmatter per the memory rules) holding only that line plus a one-line description. Never create a second file for the same work.

## 6. Finish
Print the note's path, then the paste-to-start prompt as exactly ONE line in a code block:

`/pickup <note-filename>`

(File name only, no extra lines: a slash command takes the rest of the message as its argument.) Then tell the owner to run `/clear` or open a new session and paste it. Stop. Do not begin the next step, run more tools, or summarise the work again.
