import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { ingredientsById } from '@/cooking-mode/quantity'
import { buildCookingView } from '@/cooking-mode/viewModel'

import { ADD_TIME_MS, EXTEND_MS } from './constants'
import * as engine from './engine'
import { deriveCookingModel } from './model'
import { current, executable, handover, running } from './select'
import type { CookingModel, CookingSession, Rejected } from './types'

/**
 * PR 2 CP1 rule 10 — random-order replay. Every fixture plan, driven by seeded random
 * sequences of any action on any node id, in any order. After each accepted action the
 * owner's guardrails must hold: going to a step never completes it, marking one step
 * done never completes another, a running timer keeps running until the cook ends or
 * stops it. The PRNG lives in this test only; the engine itself stays deterministic.
 */

const FIXTURES = {
  ...import.meta.glob('../__fixtures__/*.plan-response.json', { eager: true, import: 'default' }),
  ...import.meta.glob('../__fixtures__/fgc58/*.plan-response.json', { eager: true, import: 'default' }),
} as Record<string, RecipePlanResponse>

const SEQUENCES = 25
const ACTIONS = 80
const T0 = 1_700_000_000_000
const extendsAccepted = { one: 0, five: 0 }

/** mulberry32: a small seeded PRNG, so a failure replays exactly. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Kind =
  | 'markDone'
  | 'startNode'
  | 'stopNode'
  | 'extend'
  | 'skip'
  | 'acknowledge'
  | 'undo'
  | 'view'
  | 'leave'
  | 'resume'
  | 'touch'
  | 'advance'

const KINDS: Kind[] = [
  'markDone',
  'markDone',
  'startNode',
  'startNode',
  'stopNode',
  'extend',
  'skip',
  'acknowledge',
  'undo',
  'view',
  'leave',
  'resume',
  'touch',
  'advance',
  'advance',
]

interface Step {
  kind: Kind
  nodeId: string | null
  /** `extend` only (CP3.0): the amount to add; `undefined` takes the default one minute. */
  ms?: number
}

function apply(model: CookingModel, s: CookingSession, step: Step, now: number): CookingSession | Rejected {
  const id = step.nodeId!
  switch (step.kind) {
    case 'markDone':
      return engine.markDone(s, model, id, now)
    case 'startNode':
      return engine.startNode(s, model, id, now)
    case 'stopNode':
      return engine.stopNode(s, model, id, now)
    case 'extend':
      return engine.extend(s, model, id, now, step.ms)
    case 'skip':
      return engine.skip(s, model, id, now)
    case 'acknowledge':
      return engine.acknowledge(s, model, now)
    case 'undo':
      return engine.undo(s, model, now)
    case 'view':
      return engine.view(s, model, step.nodeId, now)
    case 'leave':
      return engine.leave(s, model, now)
    case 'resume':
      return engine.resume(s, model, now)
    case 'touch':
      return engine.touch(s, now)
    case 'advance':
      return s
  }
}

function isPassed(model: CookingModel, s: CookingSession, id: string): boolean {
  const consumers = model.nodes[id].consumers
  return consumers.length > 0 && consumers.every((c) => s.nodes[c].state === 'done')
}

function checkStep(
  model: CookingModel,
  prev: CookingSession,
  next: CookingSession,
  step: Step,
  now: number,
  where: string,
): void {
  const ackProducers = step.kind === 'acknowledge' ? (handover(model, prev, now)?.producers ?? []) : []
  // Done on the finish step, or "It's done" on its handover (CP1.1): either finishes the cook.
  const earlyFinish =
    (step.kind === 'markDone' || step.kind === 'acknowledge') && prev.finishedAt == null && next.finishedAt != null

  const newlyDone = model.order.filter((id) => prev.nodes[id].state !== 'done' && next.nodes[id].state === 'done')
  const expectedDone =
    step.kind === 'markDone' ? [step.nodeId!] : step.kind === 'acknowledge' ? ackProducers : []
  expect(new Set(newlyDone), `${where}: newly done`).toEqual(new Set(expectedDone))

  for (const id of model.order) {
    const a = prev.nodes[id]
    const b = next.nodes[id]

    if (a.state === 'done' && b.state !== 'done') {
      expect(step.kind, `${where}: ${id} left done`).toBe('undo')
    }

    if (a.state === 'running') {
      const changed = b.state !== 'running' || b.endsAt !== a.endsAt
      if (changed) {
        const own = step.nodeId === id
        const allowed =
          (step.kind === 'extend' && own && b.state === 'running') ||
          (step.kind === 'stopNode' && own) ||
          (step.kind === 'markDone' && own) ||
          (step.kind === 'acknowledge' && ackProducers.includes(id)) ||
          (earlyFinish && b.state === 'pending') ||
          // CP2a: undoing the start that began this timer takes it back to not started.
          (step.kind === 'undo' &&
            prev.lastTransition?.kind === 'start' &&
            prev.lastTransition.entries.some((e) => e.nodeId === id) &&
            b.state === 'pending')
        expect(allowed, `${where}: running ${id} changed by ${step.kind}(${step.nodeId})`).toBe(true)
      }
    }

    if (a.state !== 'running' && b.state === 'running') {
      const ok = (step.kind === 'startNode' && step.nodeId === id) || step.kind === 'undo'
      expect(ok, `${where}: ${id} became running by ${step.kind}`).toBe(true)
    }
  }

  if (step.kind === 'extend') {
    const a = prev.nodes[step.nodeId!]
    const b = next.nodes[step.nodeId!]
    if (a.state !== 'running' || b.state !== 'running') throw new Error(`${where}: extend on a timer that isn't running`)
    // CP4.0: an expired timer is extended from now, not from its old end.
    expect(b.endsAt, `${where}: extend amount`).toBe(Math.max(a.endsAt, now) + (step.ms ?? EXTEND_MS))
    expect(b.endsAt, `${where}: endsAt = startedAt + planned + extendedMs`).toBe(
      b.startedAt + model.nodes[step.nodeId!].durationTypical * 60_000 + b.extendedMs,
    )
  }
  // CP4.0: every accepted cook action refreshes lastSeenAt.
  expect(next.lastSeenAt, `${where}: lastSeenAt after ${step.kind}`).toBe(now)
  if (step.kind === 'view') expect(next.nodes, `${where}: view changed a node`).toEqual(prev.nodes)
  if (earlyFinish) expect(running(model, next), `${where}: running after finish`).toEqual([])

  const cur = current(model, next)
  if (cur != null) {
    expect(executable(model, next, cur), `${where}: current ${cur} not executable`).toBe(true)
    expect(isPassed(model, next, cur), `${where}: current ${cur} is passed`).toBe(false)
  }
}

describe('CP1 — random-order replay over every fixture', () => {
  const entries = Object.entries(FIXTURES).sort(([a], [b]) => a.localeCompare(b))

  it('covers the top-level fixtures and fgc58', () => {
    expect(entries.length).toBeGreaterThanOrEqual(16)
    expect(entries.some(([path]) => path.includes('/fgc58/'))).toBe(true)
  })

  it.each(entries)('%s: no step is completed except by an explicit Done / It\'s done', (path, payload) => {
    const model = deriveCookingModel(payload)
    const ingredients = ingredientsById(payload.graph.ingredients)
    const ids = model.order
    let accepted = 0

    for (let seq = 0; seq < SEQUENCES; seq++) {
      const rand = prng(seq * 7919 + path.length)
      let now = T0
      let s = engine.start(null, model, `test:${model.graphId}`, now) as CookingSession

      for (let i = 0; i < ACTIONS; i++) {
        const kind = KINDS[Math.floor(rand() * KINDS.length)]
        if (kind === 'advance') {
          now += Math.floor(rand() * 20 * 60_000)
          continue
        }
        now += Math.floor(rand() * 5_000)
        const nodeId = kind === 'view' && rand() < 0.2 ? null : ids[Math.floor(rand() * ids.length)]
        const step: Step = { kind, nodeId, ...(kind === 'extend' && rand() < 0.5 ? { ms: ADD_TIME_MS } : {}) }
        const where = `${path} seq ${seq} action ${i}`

        const seenBefore = s.lastSeenAt
        const result = apply(model, s, step, now)
        if (engine.isRejected(result)) {
          // CP4.0: a rejected action never touches lastSeenAt.
          expect(s.lastSeenAt, `${where}: lastSeenAt after a rejected ${kind}`).toBe(seenBefore)
          continue
        }
        accepted++
        if (kind === 'extend') extendsAccepted[step.ms === ADD_TIME_MS ? 'five' : 'one']++
        checkStep(model, s, result, step, now, where)
        s = result
        expect(
          () => buildCookingView(model, s, now, ingredients, { recipeTitle: payload.graph.title, leaving: false }),
          `${where}: buildCookingView threw`,
        ).not.toThrow()
      }
    }

    expect(accepted).toBeGreaterThan(SEQUENCES * 10)
  })

  // Runs after the fixtures above (tests in a file run in order).
  it('accepted extends with both amounts (default one minute and ADD_TIME_MS)', () => {
    expect(extendsAccepted.one).toBeGreaterThan(0)
    expect(extendsAccepted.five).toBeGreaterThan(0)
  })
})
