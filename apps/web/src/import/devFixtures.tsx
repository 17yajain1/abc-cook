import { StrictMode, useState } from 'react'
import type { Root } from 'react-dom/client'

import type { ImportJobResponse, RecipePlanResponse } from '@abc-cook/schema'

import kadhi from '@/__fixtures__/kadhi-pakora.plan-response.json'
import { createLibrary, type StorageLike } from '@/library/store'
import { derivePlan } from '@/plan/derive'
import { PlanScreen } from '@/plan/PlanScreen'
import type { ImportHandlers } from './handOff'
import { ImportScreen } from './ImportScreen'

/** The dev fixtures never reach a finished import, so neither handler runs. */
const NOOP_HANDLERS: ImportHandlers = { save: () => ({ status: 'idle' }), open: () => {} }

/**
 * DEV ONLY. Reachable through `main.tsx` solely behind `import.meta.env.DEV`, so Vite
 * removes this module (and the `importFixture` query name) from a production build.
 *
 * Renders the real `ImportScreen` and the real `useImportJob`, with `fetch` answered by a
 * script instead of the API: no import, no LLM, no key, no spend. The oEmbed call is
 * answered here too; only the thumbnail image itself loads from YouTube. Open
 * `/?importFixture=<state>` and tap "Get the plan". `duplicate` instead seeds an in-memory
 * Cookbook with one recipe and pastes a different spelling of its link.
 */

const VIDEO = 'https://www.youtube.com/watch?v=TYZNzCnNGwA'
const BLOG = 'https://kitchen.example/recipes/pumpkin-pancakes'

const TITLE = 'How To Make Pumpkin Pancakes'
const CHANNEL = 'This Crazy Kitchen'
const DESCRIPTION = [
  'Fluffy pumpkin pancakes with warm autumn spices. These keep well, freeze well, and are ready in one pan.',
  '',
  'You will need a whisk, a large bowl and a non-stick pan. Use canned pumpkin purée, not pumpkin pie filling.',
  '',
  'Serve with butter and maple syrup, or with yoghurt and toasted pecans.',
].join('\n')

type FixtureName = 'instant' | 'description' | 'draft' | 'blog' | 'unavailable' | 'incomplete'

const acquired = { title: TITLE, channel: CHANNEL, description: DESCRIPTION }

const JOBS: Record<FixtureName, { url: string; job: ImportJobResponse; oembed: boolean }> = {
  instant: {
    url: VIDEO,
    oembed: true,
    job: { job_id: 'fx', status: 'acquiring' },
  },
  description: {
    url: VIDEO,
    oembed: true,
    job: { job_id: 'fx', status: 'extracting', acquired },
  },
  // Mid-extraction: the source is read, five ingredients and three steps have streamed in.
  draft: {
    url: VIDEO,
    oembed: true,
    job: {
      job_id: 'fx',
      status: 'extracting',
      acquired,
      draft: {
        ingredients: [
          { name: 'All-purpose flour', group: null, prep_note: null, qty: '1 1/2', unit: 'cups' },
          { name: 'Brown sugar', group: null, prep_note: null, qty: '2', unit: 'tablespoons' },
          { name: 'Baking powder', group: null, prep_note: null, qty: '1', unit: 'tablespoon' },
          { name: 'Canned pumpkin purÃ©e', group: null, prep_note: null, qty: '1/2', unit: 'cup' },
          { name: 'Milk', group: null, prep_note: null, qty: '1', unit: 'cup' },
        ],
        ingredients_complete: true,
        steps: [
          { text: 'Whisk the flour, sugar and baking powder in a large bowl.' },
          { text: 'In a second bowl, whisk the milk and pumpkin, then pour it into the dry mix.' },
          { text: 'Cook a quarter cup of batter per pancake in a buttered pan until bubbles form, then flip.' },
        ],
        steps_complete: false,
        calls: 1,
      },
    },
  },
  blog: {
    url: BLOG,
    oembed: false,
    job: {
      job_id: 'fx',
      status: 'plan_building',
      acquired: { title: 'Pumpkin pancakes', channel: 'Kitchen Example', description: null },
      preview: {
        title: 'Pumpkin pancakes',
        ingredients: [
          '1 1/2 cups all-purpose flour',
          '2 tablespoons brown sugar',
          '1 tablespoon baking powder',
          '1 teaspoon pumpkin pie spice',
          '1 cup milk',
          '1/2 cup canned pumpkin purée',
          '1 egg',
          '2 tablespoons melted butter, plus more for the pan',
        ],
        instructions: [
          {
            heading: null,
            lines: [
              'Whisk the flour, sugar, baking powder, spice and a pinch of salt in a large bowl.',
              'In a second bowl, whisk the milk, pumpkin, egg and melted butter.',
              'Pour the wet mixture into the dry and stir until just combined; a few lumps are fine.',
              'Heat a buttered pan over medium heat and cook 1/4 cup of batter per pancake until bubbles form, then flip.',
            ],
          },
        ],
      },
    },
  },
  unavailable: {
    url: VIDEO,
    oembed: true,
    job: {
      job_id: 'fx',
      status: 'failed',
      error: "We couldn't reach our recipe reader. Try again in a minute.",
      result: { status: 'failed', failure: 'unavailable', warnings: [], ingredients: [] },
      acquired,
    },
  },
  incomplete: {
    url: VIDEO,
    oembed: true,
    job: {
      job_id: 'fx',
      status: 'failed',
      error: "We couldn't finish reading this recipe.",
      result: { status: 'failed', failure: 'incomplete', warnings: [], ingredients: [] },
      acquired,
    },
  },
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installFetch(name: FixtureName): void {
  const real = window.fetch.bind(window)
  const scripted = JOBS[name]
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('youtube.com/oembed')) {
      if (!scripted.oembed) return json(401, {})
      await new Promise((r) => setTimeout(r, 400))
      return json(200, { title: TITLE, author_name: CHANNEL })
    }
    if (/\/import$/.test(url) && init?.method === 'POST') return json(202, { job_id: 'fx' })
    if (/\/import\/fx$/.test(url)) return json(200, scripted.job)
    return real(input, init)
  }
}

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>()
  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }
  removeItem(key: string): void {
    this.data.delete(key)
  }
}

/** The duplicate case end to end: paste a youtu.be spelling of a saved watch link, get the
 * saved plan with "Already in your Cookbook" and Import again. No fetch is made. */
function DuplicateFixture() {
  const [library] = useState(() => {
    const lib = createLibrary(new MemoryStorage())
    lib.save(kadhi as RecipePlanResponse)
    return lib
  })
  const [shown, setShown] = useState<{ id: string } | null>(null)
  if (shown) {
    const saved = library.get(shown.id)!
    return (
      <PlanScreen
        plan={derivePlan(saved.payload, saved.import_meta?.provenance ?? null)}
        onBack={() => setShown(null)}
        onStartCooking={() => {}}
        save={{ status: 'saved', existing: true, onSave: () => {} }}
        importMeta={saved.import_meta ?? null}
        alreadySaved={{ onImportAgain: () => setShown(null) }}
      />
    )
  }
  return (
    <ImportScreen
      initialUrl="https://youtu.be/Oa2s0dklrRo?si=shared"
      findSaved={(key) => library.findBySource(key)}
      onDuplicate={(saved) => setShown({ id: saved.id })}
      importHandlers={NOOP_HANDLERS}
      onCancel={() => {}}
    />
  )
}

export function mountImportFixture(root: Root, name: string): void {
  if (name === 'duplicate') {
    window.fetch = async () => {
      throw new Error('the duplicate fixture must not touch the network')
    }
    root.render(
      <StrictMode>
        <DuplicateFixture />
      </StrictMode>,
    )
    return
  }
  if (!(name in JOBS)) {
    root.render(<p>Unknown importFixture “{name}”. Try: {[...Object.keys(JOBS), 'duplicate'].join(', ')}.</p>)
    return
  }
  const key = name as FixtureName
  installFetch(key)
  root.render(
    <StrictMode>
      <ImportScreen initialUrl={JOBS[key].url} importHandlers={NOOP_HANDLERS} onCancel={() => {}} />
    </StrictMode>,
  )
}
