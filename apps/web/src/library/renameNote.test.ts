import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import type { EditContext } from './ingredientEditor'
import { applyEdits, stepAnchor, type RecipeEdit } from './recipeEdits'
import { nameVariants, renameNoteSteps, renameOldNames, textMentionsName } from './renameNote'

const FIXTURES = import.meta.glob('../__fixtures__/*.plan-response.json', { eager: true, import: 'default' }) as Record<
  string,
  RecipePlanResponse
>
const byName = (name: string): RecipePlanResponse => structuredClone(FIXTURES[`../__fixtures__/${name}.plan-response.json`])
const AT = '2026-10-20T08:00:00.000Z'
function ctxFor(payload: RecipePlanResponse, edits: RecipeEdit[] = []): EditContext {
  return { payload, edits, overlay: applyEdits(payload, edits) }
}
type MutNode = { id: string; instruction: string }
const nodesOf = (p: RecipePlanResponse): MutNode[] => p.graph.nodes as unknown as MutNode[]

describe('nameVariants (B11)', () => {
  it('is the full name and its head before "(" or ",", each also with +s and +es', () => {
    expect(nameVariants('Besan (gram flour)').sort()).toEqual(
      ['Besan (gram flour)', 'Besan (gram flour)s', 'Besan (gram flour)es', 'Besan', 'Besans', 'Besanes'].sort(),
    )
    expect(nameVariants('Chicken, bone-in')).toContain('Chicken')
    expect(nameVariants('Oil').sort()).toEqual(['Oil', 'Oils', 'Oiles'].sort())
  })

  it('trims, and gives no empty variant', () => {
    expect(nameVariants('  Salt  ')).toContain('Salt')
    expect(nameVariants('(odd)').every((v) => v.length > 0)).toBe(true)
  })
})

describe('textMentionsName (D9)', () => {
  it('is case-insensitive and word-bounded', () => {
    expect(textMentionsName('Heat the OIL until hot.', 'Oil')).toBe(true)
    expect(textMentionsName('Bring it to a boil.', 'Oil')).toBe(false)
    expect(textMentionsName('Add the foil wrap.', 'Oil')).toBe(false)
  })

  it('accepts the head of a parenthesised name and a simple plural', () => {
    expect(textMentionsName('Add besan slowly.', 'Besan (gram flour)')).toBe(true)
    expect(textMentionsName('Add onions and garlic.', 'Onion')).toBe(true)
    expect(textMentionsName('Add chillies.', 'Chilly')).toBe(false)
    expect(textMentionsName('Add the chicken pieces.', 'Chicken, bone-in')).toBe(true)
  })

  it('regex-escapes the name', () => {
    expect(textMentionsName('Use 1+1 (twice).', '1+1')).toBe(true)
    expect(textMentionsName('Use 111.', '1+1')).toBe(false)
  })

  it('is Devanagari-safe: a following letter or mark is not a boundary', () => {
    expect(textMentionsName('प्याज़ काटें।', 'प्याज़')).toBe(true)
    expect(textMentionsName('प्याज़ी रंग', 'प्याज़')).toBe(false)
  })
})

describe('renameOldNames (B4)', () => {
  it('is the imported name and the name before this Save, once each', () => {
    expect(renameOldNames('Oil', 'Mustard oil')).toEqual(['Oil', 'Mustard oil'])
    expect(renameOldNames('Oil', 'Oil')).toEqual(['Oil'])
    expect(renameOldNames(null, 'Oil')).toEqual(['Oil'])
  })
})

describe('renameNoteSteps (D9)', () => {
  it('lists only steps that CONSUME the ingredient and whose text still has the old name', () => {
    const p = byName('kadhi-pakora')
    const ctx = ctxFor(p)
    // "oil" appears in several steps, but only one consumes ing_oil
    const mentioning = nodesOf(p).filter((n) => /\boil\b/i.test(n.instruction)).length
    expect(mentioning).toBeGreaterThan(1)
    expect(renameNoteSteps(ctx, 'ing_oil', ['Oil'])).toEqual(['step_heat_a_pan_and_add_oil'])
  })

  it('reads the overlaid text: a step the cook already fixed no longer counts', () => {
    const p = byName('kadhi-pakora')
    const at = nodesOf(p).findIndex((n) => n.id === 'step_heat_a_pan_and_add_oil')
    const fixed = ctxFor(p, [{ id: 's1', created_at: AT, op: 'set_step_text', anchor: stepAnchor(p, at), value: { text: 'Heat a pan and add mustard oil.' } } as RecipeEdit])
    expect(renameNoteSteps(fixed, 'ing_oil', ['Oil'])).toEqual(['step_heat_a_pan_and_add_oil'])
    const gone = ctxFor(p, [{ id: 's1', created_at: AT, op: 'set_step_text', anchor: stepAnchor(p, at), value: { text: 'Heat a pan and add the fat.' } } as RecipeEdit])
    expect(renameNoteSteps(gone, 'ing_oil', ['Oil'])).toEqual([])
  })

  it('matches either old name', () => {
    const p = byName('kadhi-pakora')
    expect(renameNoteSteps(ctxFor(p), 'ing_oil', ['Cooking fat', 'Oil'])).toHaveLength(1)
    expect(renameNoteSteps(ctxFor(p), 'ing_oil', ['Cooking fat'])).toEqual([])
  })

  it('several matches give several ids (the note then has no "Edit the step" link)', () => {
    const p = byName('sabudana-khichdi')
    expect(renameNoteSteps(ctxFor(p), 'ing_soaked_sabudana', ['Soaked Sabudana']).length).toBeGreaterThan(1)
  })

  it('never lists the serving-wait node', () => {
    const p = byName('kadhi-pakora')
    const ids = renameNoteSteps(ctxFor(p), 'ing_cumin', ['Cumin', 'Wait'])
    expect(ids.some((id) => id.startsWith('step_wait_before_serving'))).toBe(false)
  })
})
