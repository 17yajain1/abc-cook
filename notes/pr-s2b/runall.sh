#!/bin/sh
# Runs the remaining scenarios one after another (they share API port 8765).
cd "$(dirname "$0")"
for s in chole-ok blog-ready paste auto-handoff network-error retry stall-draft stall-nodraft; do
  rm -rf "s-$s"
  node shots.cjs "$s" "s-$s" > "s-$s.log" 2>&1
  echo "$s exit=$?" >> runall.log
done
echo ALLDONE >> runall.log
