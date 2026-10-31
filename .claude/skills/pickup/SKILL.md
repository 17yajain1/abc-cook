---
name: pickup
description: Resume work from a handoff note, verifying the worktree and HEAD first. Slash-command only.
disable-model-invocation: true
argument-hint: "<note file name or path>"
---

# /pickup

## 1. Find the note
MAIN = parent directory of `git rev-parse --path-format=absolute --git-common-dir`. Use the note named in the arguments (path, or file name under `MAIN/notes/handoff/`). With no argument use the newest file in `MAIN/notes/handoff/` by modified time. None found -> say so and stop.

## 2. Verify state (before reading anything else)
Compare the note's **State** section with: `git rev-parse --show-toplevel`, `git branch --show-current`, `git rev-parse HEAD`, `git status --porcelain --untracked-files=no`.
- Any difference in worktree, branch or HEAD, or tracked changes in the tree -> STOP. Print note value vs actual value for each mismatch and ask the owner how to proceed. Do not read further, edit, or run the next step. Untracked files never block.

## 3. Read only what the note says
Until the restatement below, read only the items under **Read first**, nothing else, and never a whole large doc. Do not re-derive anything under **Decisions**; they are binding.

## 4. Restate, then begin
Print, briefly: the next step, every STOP point **word for word** from the note, and the **Don't** list. Then:
- If the next step is itself a STOP or needs owner input, stop here.
- Otherwise begin the next step. Once it begins, read what that step requires, but never a whole large doc (use ranges or § headings). Halt at the first STOP point.
- If the note has a **Design-rule check** section, do it when the task is finished.

If the session's model/effort differs from the note's recommendation, say so in one line and continue.
