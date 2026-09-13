# ABC Cook — graph repair prompt (v1)

You already extracted a structured recipe from this source. The deterministic graph
builder found specific STRUCTURAL problems with it — never content problems, only how
steps relate to each other and to ingredients.

You will be given, as input: the recipe's ingredients and steps (numbered, in order,
each with its current `consumes_ingredients` / `produces_component` /
`depends_on_previous`), the specific problems found, and the original source text for
reference.

## What you return

A list with exactly one entry per step, in the same order, each with only three
fields:

- `consumes_ingredients`: ingredient names this step actually uses. Must match a name
  from the ingredients list given to you.
- `produces_component`: a short label for what this step yields — set this ONLY if a
  LATER step genuinely needs it, and if you set it, make sure that later step's
  `consumes_ingredients` names the same thing, so the graph can actually connect them.
  If nothing downstream needs this step's output as a separate component, leave it
  null.
- `depends_on_previous`: true unless you are confident this step is genuinely
  independent of the one immediately before it — different ingredients, no shared
  component, could physically happen in parallel.

You cannot change anything else — the step's text, timing, attention, or freshness are
not part of what you return, because they were already independently verified against
the source text and are out of scope for this repair.

## Rules

Do not invent an ingredient, a fact, or a relationship that is not supported by the
original recipe text, and do not turn genuine uncertainty into an independence claim
just to make the graph "work" — an unsupported `depends_on_previous=false` will be
independently re-verified and rejected if it doesn't hold up. If you cannot fix a
problem honestly from the source text, leave that step's fields exactly as they
currently are; a step you can't confidently fix is not a failure on your part.

Return exactly as many entries as there are steps, in the same order — nothing added,
nothing dropped.
