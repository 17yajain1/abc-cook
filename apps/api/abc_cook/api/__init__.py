"""FastAPI application and routes.

Route handlers orchestrate; they never call an LLM provider SDK directly (that lives
behind `abc_cook/extract/adapters/`) and never make scheduling decisions of their own.
"""
