import { describe, expect, it } from 'vitest'

import { hasNumber } from './amountNumber'
import { stepNeedsAmountNote, textHasAmountNumber } from './stepNote'

describe('textHasAmountNumber (A4: a number outside a time or temperature phrase)', () => {
  it.each([
    ['Wait 10 min', false],
    ['Wait 10 mins', false],
    ['Rest 2 hours', false],
    ['Rest 1 hr', false],
    ['Rest 30 sec', false],
    ['Rest 30 seconds', false],
    ['Cook 10-15 min', false],
    ['Cook 10–15 min', false],
    ['Cook 10 to 15 minutes', false],
    ['Bake 1½ hours', false],
    ['Bake 1 1/2 hours', false],
    ['Bake at 350°F', false],
    ['Bake at 180 °C', false],
    ['Bake at 350 degrees', false],
    ['Bake at 550˚F', false],
    ['Bake at 550ºF', false],
    ['10 मिनट पकाएं', false],
    ['2 घंटे रखें', false],
    ['2 eggs', true],
    ['Add 2 cups of flour', true],
    ['cook 10-15 min then add 2 cups', true],
    ['Add ½ tsp salt and wait 5 minutes', true],
    ['Stir well', false],
    ['', false],
  ])('%s -> %s', (text, expected) => {
    expect(textHasAmountNumber(text)).toBe(expected)
  })

  it('a word that merely starts with a time word is not a time word', () => {
    expect(textHasAmountNumber('Add 2 minced garlic')).toBe(true)
    expect(textHasAmountNumber('Add 3 secsion')).toBe(true)
  })
})

describe('stepNeedsAmountNote (W1-8: label and instruction both count)', () => {
  it('a number in the label alone shows the note', () => {
    expect(stepNeedsAmountNote('Measure 3 1/3 cups', 'Stir well.')).toBe(true)
  })
  it('a number in the instruction alone shows the note', () => {
    expect(stepNeedsAmountNote('Mix', 'Add 2 eggs.')).toBe(true)
  })
  it('time-only label and instruction do not', () => {
    expect(stepNeedsAmountNote('Rest 10 min', 'Wait 10 min.')).toBe(false)
  })
  it('a null label is fine', () => {
    expect(stepNeedsAmountNote(null, 'Add 2 eggs.')).toBe(true)
    expect(stepNeedsAmountNote(null, 'Stir.')).toBe(false)
  })
})

describe('hasNumber', () => {
  it('sees digits, vulgar fractions and Devanagari digits', () => {
    expect(hasNumber('2 cups')).toBe(true)
    expect(hasNumber('½ tsp')).toBe(true)
    expect(hasNumber('२ कप')).toBe(true)
    expect(hasNumber('to taste')).toBe(false)
    expect(hasNumber('a pinch')).toBe(false)
  })
})
