#!/usr/bin/env bash
# Filter mode: keeps the first/last 1500 chars of stdin and drops the noisy middle,
# for output over 3000 chars. Piped in by the wrapped command a matching PreToolUse
# invocation rewrites itself into (see truncate-output-hook.py, invoked directly by
# settings.json's PreToolUse/Bash hook, not through this file).
#
# Deliberately never invoked via a nested "bash <this file>" call: this Windows/
# Git-Bash setup fails intermittently ("couldn't create signal pipe") when one bash
# process execs another through a #!/usr/bin/env bash shebang. Bash-tool-spawned
# commands (npm run/npx tsc/npx vite/pytest) invoke this script directly by path,
# which is a single, reliable hop.

out="$(cat)"
len=${#out}
if (( len > 3000 )); then
  head_part="${out:0:1500}"
  tail_part="${out: -1500}"
  omitted=$(( len - 3000 ))
  printf '%s\n[... %d chars omitted ...]\n%s\n' "$head_part" "$omitted" "$tail_part"
else
  printf '%s' "$out"
fi
