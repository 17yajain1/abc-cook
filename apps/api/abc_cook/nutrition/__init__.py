"""Per-serving recipe nutrition: a USDA food table, a gram resolver and a calculator.

Pure except `match.py`, whose one batched LLM call per recipe picks a food for the lines the
deterministic matcher cannot place. See notes/3a-nutrition/part-a-plan.md and b2-plan.md.
"""

NUTRITION_VERSION = 4
"""Bumped when the calculator's arithmetic or rules change (recompute is free; only a new food
mapping can cost an LLM call). 2: fat defaults by cooking method, optional extras, shadow label.
3: servings from yield text, the unreviewed-pick guard on the label, dried-spice per-piece
weights, blends and charcoal as no_food, a poha proxy food. 4: "A or B C" lines share the head
noun, volume lines at the default density are `estimated` and flagged."""
