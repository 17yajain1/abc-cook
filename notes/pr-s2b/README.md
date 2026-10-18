# PR-S2b capture scripts

Headless-Chrome captures of the import reading screen at 360x697, driven against the replay API
from PR-S2a. No live LLM, no YouTube, no phone. `notes/` is gitignored; these files are
force-added so later PRs can re-run them.

## Run

1. Vite pointed at the replay API (port 5174 is in the replay server's CORS list):

   ```
   cd apps/web
   VITE_API_BASE=http://127.0.0.1:8765 npx vite --port 5174 --strictPort --host 127.0.0.1
   ```

2. A scenario (the script starts and stops the replay API itself, with `OPENAI_API_KEY` and
   `LLM_API_KEY` set to invalid values in that child only):

   ```
   node notes/pr-s2b/shots.cjs <scenario> <outdir>
   ```

   Scenarios: `croissant-ok` (shots 1, 2, 4, 5, 6, 7, the top bar and the activity dot), `chole-ok`
   (3), `stall-draft` (8a, 9a), `stall-nodraft` (8b, 9b), `retry` (10), `paste` (11), `blog-ready`
   (12), `network-error` (13), `auto-handoff` (14). The stall scenarios take about 80 s (the 60 s
   idle watchdog). `PYTHON` overrides the interpreter, `BASE` the web origin.

   Each shot logs `#root`'s computed background and `data-surface`: it must be `rgb(251, 248, 244)`
   and `home` before a capture is trusted (`body` itself is transparent until a Home screen sets
   `data-surface`).

## Recipe-page baseline

`baseline.cjs <outdir>` renders the recipe page's Ingredients tab for three fixtures (kadhi-pakora,
pumpkin-pancakes, chicken-biryani: top, bottom and the whole panel). `python imgdiff.py <a> <b>`
pixel-diffs two directories. The shared `IngredientList` refactor, the `IngredientRow` quantity cap
and `joinQtyUnit` were each checked this way: identical to the pre-change render.

`w1.cjs` is the earlier single-scenario capture the W1 checkpoint used; `shots.cjs` supersedes it.

## Files

- `lib.cjs` browser launch (system Chrome via the project's playwright-core) and fixture library seed
- `thumb.png` the stand-in thumbnail (nothing is fetched from YouTube)
- `shots.cjs`, `w1.cjs`, `baseline.cjs`, `imgdiff.py`
