"""Per-serving recipe nutrition: a USDA food table, a gram resolver and a calculator.

Pure except `match.py`, whose one batched LLM call per recipe picks a food for the lines the
deterministic matcher cannot place. See notes/3a-nutrition/part-a-plan.md and b2-plan.md.
"""

NUTRITION_VERSION = 2
"""Bumped when the calculator's arithmetic or rules change (recompute is free; only a new food
mapping can cost an LLM call). 2: fat defaults by cooking method, optional extras, shadow label."""
