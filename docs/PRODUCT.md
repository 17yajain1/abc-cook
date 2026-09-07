# ABC Cook — Product

## The problem

> **Recipes are written for reading, not for cooking.**

Everything follows from that sentence. The world does not need more recipes; there are
millions. What's missing is an interface for the twenty minutes you spend at the stove:

1. Ingredients live far from the instructions that use them.
2. It's hard to see what combines with what.
3. It's hard to see what can happen at the same time.
4. Timers are the user's problem to remember.
5. Videos need constant rewinding.
6. Screenshots saved from Instagram are useless a week later.
7. Indian recipes in particular have many ingredients, multiple masala stages,
   staggered additions, and "cook until…" instructions with no time attached.

## The product

**Turn any recipe into a cooking plan.**

Input: screenshot, cookbook photo, URL, YouTube/Instagram link, pasted text.
Output: a structured, interactive plan that tells you what to do now, what to do while
something cooks, and when things merge.

The internal representation is a dependency graph; the user-facing artifact is the
Cooking Plan. See `COOKING_GRAPH.md`.

## Positioning against what exists

Three groups, and only one of them matters much.

**Recipe discovery (India)** — Veg Recipes of India (~990K visits/mo), Hebbar's Kitchen
(~680K organic/mo), Tarla Dalal (~390K/mo), Archana's Kitchen, Cookpad and Tasty (10M+
Play installs each). These own the discovery habit. We do not compete here and should
not try to. Their scale is the demand signal: India has an enormous recipe audience.

**Recipe management** — ReciMe is the serious one: imports from Instagram/TikTok/
YouTube/Pinterest, grocery lists, meal planning, scaling, 1M+ Play installs.

Their pipeline is: share a link from Instagram or YouTube, or type it in → get a clean
ingredient list and steps. That's a real service and they do it well. **But it ends
there.** They have solved *capture*. Nobody has solved *cook*.

So the boundary is clean, and it's worth stating in exactly these terms because it's
the whole pitch:

| | ReciMe | ABC Cook |
|---|---|---|
| Import from anywhere | ✅ | ✅ (table stakes, not a reason to exist) |
| Clean ingredients + steps | ✅ | ✅ |
| Organise, meal-plan, grocery list | ✅ | Not building |
| **Show how the dish is built** | ❌ | **✅ visual graph** |
| **Tell you what to do while something cooks** | ❌ | **✅ scheduler** |
| **Guide you through the cook** | Limited | **✅ cooking mode** |

We should not build a better recipe saver. We should be the thing people open *after*
they've got the recipe.

**Visual recipe converters** — GridRecipe (photo → grid, paid per conversion), Chart My
Recipes (URL/photo → flowchart, voice, AI assistant), Treecipes (recipe → tree, ~500
downloads). These are the direct competitors to a naive version of this idea, and this
is precisely why **"upload recipe → get a grid" cannot be the business.** They're all
small and new — that's the gap — but a prettier converter is a feature, not a moat.

The defensible thing is the layer underneath: a recipe representation rich enough to
schedule. Once you have that, the grid, the timeline, the step-by-step mode, the voice
mode and the printable IKEA-style sheet are all just renderers of the same object. That
is much harder to copy than asking an LLM for a flowchart.

## Naming and framing

Working name: **ABC Cook**. The IKEA "Cook This Page" campaign (2017, Leo Burnett, Canada
— parchment sheets with measured ingredient areas) is a useful reference point for the
pitch: *changing the recipe interface makes cooking dramatically easier; we're doing
that for every recipe on the internet.*

The signature format (the grid) is what people remember us for. It should not be the
only thing we do.

## MVP scope — v0.1

**In:**
- Import: image + pasted text (one LLM call → cooking graph)
- The scheduler and the Cooking Plan
- Cooking mode: one instruction at a time, timers, "while this cooks" tasks
- Parallel task detail → mark complete → return to the running timer
- Stage completion → next stage
- Local persistence of imported recipes

**Out, deliberately:**
- Accounts and social features
- Meal planning
- A recipe database or discovery feed
- Grocery delivery integration (see below)
- Video/YouTube import (do it after image and text work well)
- Native iOS/Android apps — ship a PWA, "Add to Home Screen"

## Ingredient shopping — Phase 3+, not now

Recipe → ingredients → quick-commerce price comparison (Blinkit / Zepto / Instamart /
BB Now / Flipkart Minutes) by pincode is a strong differentiator and was explored in
depth. It is also a completely separate product with its own hard problems. Parking it
is a scoping decision, not a rejection.

When it does come back, three things from that analysis should carry over:

- **Adapter architecture.** `CommerceProvider` with per-platform adapters. Never
  hard-code Blinkit or Zepto logic through the app.
- **The real AI problem is product matching**, not price display: "butter 50g" →
  *Amul Butter 100g ₹62* rather than *Amul Butter 500g ₹285*. Recipe ingredient →
  commercially purchasable SKU, quantity-aware.
- **Do not build on scraping.** It breaks, it may violate terms, and it makes the core
  product's reliability hostage to someone else's frontend. Phase 1 is deep-link
  handoff; anything richer needs a legitimate partner integration.

Phasing: (1) deep-link handoff → (2) partner availability + price comparison →
(3) multi-store basket optimisation → (4) pantry awareness ("you already have
turmeric — don't buy it"), which is the genuinely powerful one.

## Design principles

1. **Mobile-first, one-handed.** 390 × 844. Never force a desktop graph onto a phone —
   that decision was already tested and the vertical flow won.
2. **The graph is the map; step-by-step is the execution layer.** Don't try to show the
   whole graph while someone is cooking.
3. **Show, don't explain.** If a screen needs a paragraph to be understood, redesign the
   screen. The aha moment is *"oh — I can do those while the base cooks,"* and it should
   arrive without onboarding.
4. **Honest about parallelism.** When a recipe has nothing to parallelise, say nothing.
   Filler tasks ("clean your countertop") destroy trust in the ones that matter.
5. **Never state a time we haven't computed.** Every minute figure on screen comes from
   the scheduler.

## Economics

One LLM call per import; everything after that is deterministic and free. Rough budget
₹0.5–₹2 per import on a cheap vision model, ₹3–₹10 for hard recipes needing a stronger
model or a repair pass. Infrastructure for an early MVP sits comfortably under
₹10K/month (Supabase free/Pro, Cloud Run pay-per-use, small storage).

LLM cost is not the risk in this business. Product-market fit is.
