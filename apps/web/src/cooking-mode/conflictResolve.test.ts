import { describe, expect, it } from 'vitest'

import { canResolveConflictTarget, resolveConflictTarget } from './conflictResolve'

/**
 * CP1b (M3.4.5 session-lockout plan) — pure resolution logic only. No React render,
 * no `Library`/`fetchPlan` — `hasLibraryEntry` is a plain injected predicate, matching
 * this repo's "no jsdom" limit for the cooking screens (`App.tsx`'s actual navigation
 * wiring is exercised by hand, not by a render test — same tier as the rest of Cooking
 * Mode's screen-level code).
 */

describe('resolveConflictTarget — CP1b test 1: Go To library recipe', () => {
  it('a library: planKey whose id still exists resolves to that library entry', () => {
    expect(resolveConflictTarget('library:kadai-id', (id) => id === 'kadai-id')).toEqual({
      kind: 'library',
      id: 'kadai-id',
    })
  })
})

describe('resolveConflictTarget — CP1b test 2: Go To an existing server recipe', () => {
  it('a server: planKey always resolves — fetchPlan is an existing, already-used resolver', () => {
    expect(resolveConflictTarget('server:kadai', () => false)).toEqual({ kind: 'server', recipeId: 'kadai' })
  })
})

describe('resolveConflictTarget — CP1b test 3: no existing resolver hides Go To', () => {
  it('a planKey prefix with no resolution path in this codebase reports unresolved', () => {
    // This repo has exactly two resolvers (library:, server:) and one deliberately
    // unresolvable form (import:). An unrecognized prefix is the concrete stand-in for
    // "no existing resolver exists" — there is no third resolution path to fall back to.
    expect(resolveConflictTarget('unknown:xyz', () => true)).toEqual({ kind: 'unresolved' })
  })

  it('import: is never resolvable, regardless of the predicate — CP1c\'s identity work, not CP1b\'s', () => {
    expect(resolveConflictTarget('import:abc123', () => true)).toEqual({ kind: 'unresolved' })
  })
})

describe('resolveConflictTarget — CP1b test 4: an unresolved plan hides Go To', () => {
  it('a library: planKey whose id no longer exists in the library reports unresolved', () => {
    expect(resolveConflictTarget('library:deleted-id', () => false)).toEqual({ kind: 'unresolved' })
  })
})

describe('canResolveConflictTarget', () => {
  it('mirrors resolveConflictTarget\'s kind, collapsed to a boolean', () => {
    expect(canResolveConflictTarget('library:kadai-id', (id) => id === 'kadai-id')).toBe(true)
    expect(canResolveConflictTarget('library:missing', () => false)).toBe(false)
    expect(canResolveConflictTarget('server:kadai', () => false)).toBe(true)
    expect(canResolveConflictTarget('import:abc123', () => true)).toBe(false)
  })
})
