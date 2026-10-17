import { StrictMode } from 'react'
import type { Root } from 'react-dom/client'

import type { ImportJobResponse } from '@abc-cook/schema'

import { ImportScreen } from './ImportScreen'

/**
 * DEV ONLY. Reachable through `main.tsx` solely behind `import.meta.env.DEV`, so Vite
 * removes this module (and the `importFixture` query name) from a production build.
 *
 * Renders the real `ImportScreen` and the real `useImportJob`, with `fetch` answered by a
 * script instead of the API: no import, no LLM, no key, no spend. The oEmbed call is
 * answered here too; only the thumbnail image itself loads from YouTube. Open
 * `/?importFixture=<state>` and tap "Get the plan".
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

type FixtureName = 'instant' | 'description' | 'blog' | 'unavailable' | 'incomplete'

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

export function mountImportFixture(root: Root, name: string): void {
  if (!(name in JOBS)) {
    root.render(<p>Unknown importFixture “{name}”. Try: {Object.keys(JOBS).join(', ')}.</p>)
    return
  }
  const key = name as FixtureName
  installFetch(key)
  root.render(
    <StrictMode>
      <ImportScreen initialUrl={JOBS[key].url} onImported={() => {}} onCancel={() => {}} />
    </StrictMode>,
  )
}
