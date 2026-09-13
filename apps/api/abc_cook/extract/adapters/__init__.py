"""LLM provider adapters. `base.py` is the Protocol; each provider gets one file.

CLAUDE.md: "One provider behind an adapter interface, never call a provider SDK from
route handlers." `normalize.py` imports only `base.LLMAdapter` / `ExtractResult` —
never a concrete provider module — so swapping providers is a one-file change.
"""
