"""PreToolUse hook (matcher: Bash) that keeps verbose build/test output out of context.

Invoked directly as `python3 truncate-output-hook.py` from settings.json -- not through
a nested bash script. On this Windows/Git-Bash setup, one bash process exec'ing another
bash process through a #!/usr/bin/env bash shebang fails intermittently ("couldn't
create signal pipe"); spawning python3 (or perl) directly from the single bash process
that already runs the hook command is reliable, so every hop in this design uses that
path instead.

PostToolUse hooks cannot rewrite or drop tool output that already entered context (only
append additionalContext), so this rewrites the Bash *command* before it runs: a matching
command gets piped through an inline perl filter that keeps the first/last 1500 chars and
drops the noisy middle when the total exceeds 3000 chars. permissionDecision is set to
"allow" only for matched commands, so the rewritten command -- which no longer text-matches
the existing Bash(npm run *) etc. allow rules -- doesn't newly prompt for approval.
"""

import json
import re
import sys

PATTERN = re.compile(r"npm run|npx tsc|npx vite|pytest")

TRUNCATE_FILTER = (
    r"perl -0777 -ne "
    r"""'my $s=$_; my $len=length($s); """
    r"""if ($len>3000) { my $o=$len-3000; """
    r"""print substr($s,0,1500),"\n[... $o chars omitted ...]\n",substr($s,-1500); """
    r"""} else { print $s; }'"""
)


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return

    tool_input = payload.get("tool_input") or {}
    command = tool_input.get("command") or ""
    if not command or not PATTERN.search(command):
        return

    wrapped = f"( {command} ) 2>&1 | {TRUNCATE_FILTER}; exit ${{PIPESTATUS[0]}}"

    updated_input = dict(tool_input)
    updated_input["command"] = wrapped

    output = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": (
                "truncate-output-hook.py: wrapped for output truncation "
                "(npm run/npx tsc/npx vite/pytest)"
            ),
            "updatedInput": updated_input,
        }
    }
    json.dump(output, sys.stdout)


if __name__ == "__main__":
    main()
