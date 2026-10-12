import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse, SavedRecipe } from '@abc-cook/schema'

import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import { start } from '@/cooking/engine'
import { deriveCookingModel } from '@/cooking/model'
import type { CookingSession } from '@/cooking/types'

import { selectContinue } from './continueCooking'

const KADAI = kadaiPaneer as RecipePlanResponse
const MODEL = deriveCookingModel(KADAI)
const T0 = 1_700_000_000_000
const HOUR = 3_600_000

const saved: SavedRecipe = {
  id: 'abc',
  payload: KADAI,
  saved_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  source_key: 'text:kadai',
}
const libraryEntry = (id: string) => (id === saved.id ? saved : undefined)

function session(planKey: string, patch: Partial<CookingSession> = {}): CookingSession {
  const s = start(null, MODEL, planKey, T0, 'Kadai paneer')
  if ('reason' in s) throw new Error('start rejected')
  return { ...s, ...patch }
}

describe('selectContinue', () => {
  it('is null with no session', () => {
    expect(selectContinue(null, T0, libraryEntry)).toBeNull()
  })

  it('shows an active library session with the step line from the existing selector', () => {
    const info = selectContinue(session('library:abc'), T0 + 60_000, libraryEntry)
    expect(info).toMatchObject({ planKey: 'library:abc', title: 'Kadai paneer', sourceKey: 'text:kadai' })
    expect(info?.step).toEqual({ n: 1, total: MODEL.order.length })
  })

  it('still shows a session the person left', () => {
    const left = session('library:abc', { leftAt: T0 + 1000 })
    expect(selectContinue(left, T0 + 2000, libraryEntry)).not.toBeNull()
  })

  it('shows a server session with the title only, never a step estimate', () => {
    const info = selectContinue(session('server:kadai-paneer'), T0 + 60_000, libraryEntry)
    expect(info?.title).toBe('Kadai paneer')
    expect(info?.step).toBeNull()
    expect(info?.sourceKey).toBeNull()
  })

  it('shows a stale session with its state and no step line', () => {
    const info = selectContinue(session('library:abc'), T0 + 500 * HOUR, libraryEntry)
    expect(info).toMatchObject({ planKey: 'library:abc', title: 'Kadai paneer', state: 'stale', step: null })
  })

  it('marks a live session active', () => {
    expect(selectContinue(session('library:abc'), T0 + 60_000, libraryEntry)?.state).toBe('active')
  })

  it('hides finished and legacy (no totalMin) sessions', () => {
    expect(selectContinue(session('library:abc', { finishedAt: T0 + 1000 }), T0 + 2000, libraryEntry)).toBeNull()
    expect(selectContinue(session('library:abc', { totalMin: undefined }), T0 + 1000, libraryEntry)).toBeNull()
  })

  it('hides a session Resume cannot reach', () => {
    expect(selectContinue(session('import:some-uuid'), T0 + 1000, libraryEntry)).toBeNull()
    expect(selectContinue(session('library:deleted'), T0 + 1000, libraryEntry)).toBeNull()
  })
})
