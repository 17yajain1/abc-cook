"""Recipe extraction: LLM adapters, versioned prompts, and the validation/repair loop.

Empty until M2. The shape it will take is specified in docs/COOKING_GRAPH.md §5 and §6:

- `adapters/` — one provider behind an adapter interface. Route handlers never import
  a provider SDK directly.
- `prompts/` — versioned prompt files (`v1.md`, `v2.md`). Never inline a prompt in Python.
- `validate.py` — the §5 graph invariants, as hard gates.

One LLM call per import; a second only when the repair pass fires.
"""
