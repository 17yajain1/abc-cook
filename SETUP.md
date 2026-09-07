# Setup

## 1. Prerequisites

- **Node.js 18+** (Claude Code needs it, and so does the Vite app)
- **Python 3.12**
- **git**
- A terminal you like. macOS/Linux native; on Windows use WSL.

## 2. Install Claude Code

```bash
npm install -g @anthropic-ai/claude-code
claude          # run inside the project directory; it walks you through auth
```

Your Claude.ai subscription covers it — no separate API key needed for Claude Code
itself. (The API key in §5 is for *your app's* recipe extraction, a different thing.)

Docs: https://docs.claude.com/en/docs/claude-code/overview

There's also a VS Code / JetBrains extension and a Code tab in the Claude desktop app,
if you'd rather not live in the terminal. Same engine.

## 3. Drop these files in

```bash
mkdir -p ~/code/abc-cook && cd ~/code/abc-cook
git init
# copy CLAUDE.md, SETUP.md, docs/, .claude/ in here
mkdir -p apps/api apps/web packages/schema
git add -A && git commit -m "docs: project spec and Claude Code config"
```

Push to a private GitHub repo. Not for collaboration — for the ability to roll back
when a Claude Code session goes sideways at 1am.

## 4. Get the Figma Make code out

Your Figma Make project already contains a real React + TypeScript + Vite app
(`src/App.tsx`, `vite.config.ts`, `package.json`, the imported images). Export or copy
that into `apps/web/`, then:

```bash
cd apps/web && npm install && npm run dev -- --host
```

The `--host` flag lets you open it on your phone over local wifi. **Do all UI review on
the phone**, never in a desktop browser window resized to look like a phone.

Once it runs, commit it as-is before changing anything. That commit is your "the
prototype worked" checkpoint.

## 4b. Add the frontend-design skill

Your command was right. `frontend-design` lives at `skills/frontend-design/` in
Anthropic's public skills repo:

```bash
npx skills add https://github.com/anthropics/skills --skill frontend-design
```

Or as a Claude Code plugin marketplace, if you'd rather manage it that way:

```
/plugin marketplace add anthropics/skills
```

Worth knowing what it actually does before you rely on it. It pushes for a written
design brief — palette, type, layout concept, principles — *before* any code, and it
carries a list of the visual patterns that mark a design as AI-generated. Your current
prototype hits five of them; see `docs/GRAPH_VIEW.md` §6 and the "Under review" section
of `docs/DESIGN_SYSTEM.md`.

Other skills worth having later: `pptx` if you ever pitch this, `xlsx` for cost
modelling. Not now.

## 4c. Connect Figma

Figma's MCP server gives Claude Code structured access to your files — components,
variables, layout data, and Figma Make resources specifically, which is what your
prototype is. It can also write back to the canvas.

There are two versions. **Use the remote one** — Figma now recommends it for almost
everyone; the local desktop server is for specific org/enterprise cases. The remote
server installs as a Claude Code plugin that bundles the MCP config plus some Figma
Agent Skills:

```bash
claude plugin install figma@claude-plugins-official
```

Then restart Claude Code, run `/plugin`, arrow across to the **Installed** tab, select
`figma`, and hit Enter to open the auth page. Allow access, then run `/plugin` again —
it should show as connected.

**One thing to check before you spend time on this:** the Figma MCP server needs a full
or dev seat. Other seat types may hit usage limits. Given you ran out of Figma Make AI
credits yesterday, confirm your seat covers it before building the workflow around it.

The remote server is **link-based**: you copy a link to a specific frame or layer and
paste it into your prompt, rather than Claude Code browsing your file. That makes the
version discipline concrete — keep a short list somewhere of "v1 = …, v2 = …, v4 =
current" with the frame links, and paste the right one. Otherwise Claude Code will
happily build from a version you already rejected.

Docs: https://help.figma.com/hc/en-us/articles/39888612464151-Claude-Code-and-Figma-Set-up-the-MCP-server

## 5. Environment

```bash
cp .env.example .env
```

You'll need:

| Variable | Where from |
|---|---|
| `LLM_PROVIDER` | `anthropic` \| `openai` \| `google` |
| `LLM_API_KEY` | Your provider console. Set a hard spend cap on day one. |
| `LLM_MODEL` | Start with the cheapest vision-capable model in that family |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` | Supabase project settings — not needed until M5 |

`.env` is gitignored. `.env.example` is committed and must list every variable.

## 6. First session

```bash
cd ~/code/abc-cook
claude
```

Then, verbatim:

> Read CLAUDE.md and docs/COOKING_GRAPH.md. Then scaffold apps/api: FastAPI + Pydantic
> v2, the schema models from §2, and an empty schedule package with the module layout
> from the spec. No scheduler logic yet, no LLM code. Show me the file plan before
> writing.

Then M1 from `docs/ROADMAP.md`.

## 7. Habits that make Claude Code work well here

- **Ask for a plan before big changes.** "Show me the file-level diff first" costs one
  turn and saves an hour of untangling.
- **`/clear` between milestones.** A long context full of M1 debugging makes M2 worse.
- **Commit at every working state.** Small commits; you're the only reviewer.
- **Keep `CLAUDE.md` current.** When you make a decision that surprised you, add a line.
  It's the file that stops the same argument recurring in every session.
- **Don't let it write the scheduler and the tests in one go.** Write the expected plan
  by hand first (you can do this — it's the Kadai Paneer table), then have it make the
  code match. Otherwise the tests just encode whatever the code happened to do.

---

## Open decisions — worth settling before M1

**1. Vite vs Next.js.** Recommendation: stay on Vite. The prototype is already there,
the app is a PWA, and there's no SEO surface until you have public recipe pages. If
shareable recipe links become a growth channel, migrating a component tree to Next.js
later is a weekend, not a rewrite.

**2. LLM provider.** The extractor sits behind an adapter, so this is reversible and
shouldn't block anything. Pick whichever console you already have billing set up in and
move on. Revisit after M4's eval numbers.

**3. The name.** "ABC Cook" works well — clear, memorable, and not tied to a single cuisine.
"Indian cooking app" when the product isn't inherently Indian, and it's hard to spell
for anyone outside India. Not urgent. Don't buy a domain yet; naming after you've
watched ten people use it is cheaper than renaming after you've branded it.

**4. Where the scheduler runs.** Recommendation: Python, server-side. It's your
language, it's testable, and plans are cacheable. A TypeScript port for offline
replanning is a real option later — the graph is small — but two implementations of the
moat is two chances to be subtly wrong.
