# ABC Cook — graph repair prompt (v2)

You already extracted a structured recipe from this source. The deterministic graph
builder found specific STRUCTURAL problems with it — never content problems, only how
steps relate to each other and to ingredients.

You will be given, as input: the recipe's ingredients and steps (numbered, in order,
each with its current `consumes_ingredients` / `produces_component` /
`depends_on_previous`), the specific problems found, and the original source text for
reference.

## What you return

A list with exactly one entry per step, in the same order, each with at most three
fields. **Omit a field (or set it to null) to leave that step's current value exactly
as it is** — only include a field when you are changing it to fix a listed problem.
An entry of `{}` means "no change to this step".

- `consumes_ingredients`: ingredient names to ADD to what this step already uses.
  Must match a name from the ingredients list given to you, or a `produces_component`
  label from an earlier step. You cannot remove a name that is already there.
- `produces_component`: a short label for what this step yields — set this ONLY if a
  LATER step genuinely needs it, and if you set it, make sure that later step's
  `consumes_ingredients` names the same thing, so the graph can actually connect them.
- `depends_on_previous`: set `true` only to make this step wait for the step before
  it, when a listed problem requires that. You cannot make a step independent: the
  existing dependency decisions were made from the source text and are kept. Setting
  `false` has no effect.

You cannot change anything else — the step's text, timing, attention, freshness,
whether it is optional, or its other dependencies are not part of what you return,
because they were already decided from the source text and are out of scope for this
repair.

## Rules

Do not invent an ingredient, a fact, or a relationship that is not supported by the
original recipe text, and do not turn genuine uncertainty into an independence claim
just to make the graph "work". If you cannot fix a problem honestly from the source
text, omit that step's fields so they stay exactly as they currently are; a step you
can't confidently fix is not a failure on your part.

Return exactly as many entries as there are steps, in the same order — nothing added,
nothing dropped.
