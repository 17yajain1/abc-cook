import { describe, expect, it } from 'vitest'

import { ApiError, UNREACHABLE_MESSAGE } from '../api/client'
import { clearError, messageFor, type Phase } from './useImportJob'

describe('clearError (CP5.1 U6)', () => {
  it('an error becomes a clean entry', () => {
    const error: Phase = { kind: 'error', message: 'x', preview: null, acquired: null, draft: null }
    expect(clearError(error)).toEqual({ kind: 'entry' })
  })

  it('every other phase is returned unchanged', () => {
    const polling: Phase = { kind: 'polling', status: 'extracting', preview: null, acquired: null, draft: null }
    const paste: Phase = { kind: 'paste', error: 'nothing there' }
    expect(clearError(polling)).toBe(polling)
    expect(clearError(paste)).toBe(paste)
    const entry: Phase = { kind: 'entry' }
    expect(clearError(entry)).toBe(entry)
  })
})

describe('messageFor (CP5.1 U6)', () => {
  it('an unreachable API says so in plain words, with no address in it', () => {
    const msg = messageFor(new ApiError(0, 'Could not reach the API at http://localhost:8000. Is it running?'))
    expect(msg).toBe(UNREACHABLE_MESSAGE)
    expect(msg).not.toMatch(/localhost|8000|running/)
  })

  it('the API\'s own 422 sentence passes through; other statuses name the status', () => {
    expect(messageFor(new ApiError(422, 'That link has no recipe.'))).toBe('That link has no recipe.')
    expect(messageFor(new ApiError(500, 'boom'))).toBe('The server had a problem (500).')
  })
})
