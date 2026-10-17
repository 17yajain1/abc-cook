import { describe, expect, it } from 'vitest'

import type { ImportJobResponse } from '@abc-cook/schema'

import { importMetaFrom } from './importMeta'
import { FAILURE_COPY, phaseFor, type Phase } from './phase'
import { statusLineFor } from '../plan/PlanScreen'

const ctx: { jobId: string; token: number; attempt: number; maxPolls: number; url: string | null } = {
  jobId: 'j1',
  token: 7,
  attempt: 0,
  maxPolls: 250,
  url: 'https://youtu.be/abc',
}
const acquired = { title: 'T', channel: 'C', description: 'D' }

function phaseOf(job: ImportJobResponse, over: Partial<typeof ctx> = {}): Phase {
  const decision = phaseFor(job, { ...ctx, ...over })
  if (decision.kind !== 'phase') throw new Error(`expected a phase, got ${decision.kind}`)
  return decision.phase
}

describe('phaseFor — failed jobs', () => {
  it.each(['unavailable', 'incomplete'] as const)('a failed job with failure %s is the failed phase', (failure) => {
    const phase = phaseOf({
      job_id: 'j1',
      status: 'failed',
      error: 'an older build shows this',
      result: { status: 'failed', failure },
      acquired,
    })
    expect(phase).toEqual({ kind: 'failed', failure, url: ctx.url, preview: null, acquired })
  })

  it('keeps the blog preview on a failed phase', () => {
    const preview = { title: 'P', ingredients: ['1 onion'], instructions: [] }
    const phase = phaseOf({
      job_id: 'j1',
      status: 'failed',
      result: { status: 'failed', failure: 'unavailable' },
      preview,
    })
    expect(phase.kind === 'failed' && phase.preview).toEqual(preview)
  })

  it('carries a null url for a pasted text, so Try again knows to resubmit the text', () => {
    const phase = phaseOf(
      { job_id: 'j1', status: 'failed', result: { status: 'failed', failure: 'unavailable' } },
      { url: null },
    )
    expect(phase.kind === 'failed' && phase.url).toBeNull()
  })

  it('a failed job with no failure keeps today’s error path', () => {
    const withMessage = phaseOf({ job_id: 'j1', status: 'failed', error: 'It broke.', acquired })
    expect(withMessage).toEqual({ kind: 'error', message: 'It broke.', preview: null, acquired })
    const bare = phaseOf({ job_id: 'j1', status: 'failed' })
    expect(bare).toMatchObject({ kind: 'error', message: 'The import failed.' })
    const noKind = phaseOf({ job_id: 'j1', status: 'failed', result: { status: 'failed' } })
    expect(noKind.kind).toBe('error')
  })

  it('never routes a failure through the not-grounded screen', () => {
    const phase = phaseOf({
      job_id: 'j1',
      status: 'failed',
      result: { status: 'failed', failure: 'incomplete' },
    })
    expect(phase.kind).not.toBe('not_grounded')
  })
})

describe('phaseFor — the other statuses are unchanged', () => {
  it('method_not_grounded is the not_grounded phase and stops polling', () => {
    const job: ImportJobResponse = { job_id: 'j1', status: 'method_not_grounded' }
    expect(phaseFor(job, ctx)).toEqual({
      kind: 'phase',
      phase: { kind: 'not_grounded', job },
      keepPolling: false,
    })
  })

  it('no_recipe_found is the no_recipe phase', () => {
    expect(phaseOf({ job_id: 'j1', status: 'no_recipe_found' })).toEqual({ kind: 'no_recipe' })
  })

  it('an in-flight job keeps polling and carries what the server has so far', () => {
    const decision = phaseFor({ job_id: 'j1', status: 'extracting', acquired }, ctx)
    expect(decision).toEqual({
      kind: 'phase',
      phase: { kind: 'polling', status: 'extracting', preview: null, acquired },
      keepPolling: true,
    })
  })

  it('past the poll ceiling it becomes slow, keeping the job id for Keep waiting', () => {
    const decision = phaseFor({ job_id: 'j1', status: 'validating' }, { ...ctx, attempt: 250 })
    expect(decision).toMatchObject({
      kind: 'phase',
      phase: { kind: 'slow', jobId: 'j1', token: 7, status: 'validating' },
      keepPolling: false,
    })
  })

  it('a done job with a plan is left to the hook', () => {
    const job = {
      job_id: 'j1',
      status: 'done',
      result: { status: 'done', graph: {}, plan: {}, stages: [] },
    } as unknown as ImportJobResponse
    expect(phaseFor(job, ctx)).toEqual({ kind: 'done' })
  })

  it('a done job without a plan is not treated as finished', () => {
    const decision = phaseFor({ job_id: 'j1', status: 'done', result: { status: 'done' } }, ctx)
    expect(decision.kind).toBe('phase')
  })
})

describe('failure copy', () => {
  it('has one sentence per failure kind, and neither offers a retry for incomplete', () => {
    expect(FAILURE_COPY.unavailable).toBe("We couldn't reach our recipe reader. Try again in a minute.")
    expect(FAILURE_COPY.incomplete).toBe("We couldn't finish reading this recipe.")
  })
})

describe('the Plan simplified notice fires for a repair outage', () => {
  it('warnings degraded + repair_unavailable → the existing "Plan simplified" line', () => {
    const meta = importMetaFrom({
      status: 'done',
      warnings: ['degraded', 'repair_unavailable'],
    })
    expect(meta.degraded).toBe(true)
    expect(statusLineFor(meta)).toBe('Plan simplified — steps run one after another.')
  })

  it('repair_unavailable alone does not claim a simplified plan', () => {
    const meta = importMetaFrom({ status: 'done', warnings: ['repair_unavailable'] })
    expect(meta.degraded).toBe(false)
  })
})
