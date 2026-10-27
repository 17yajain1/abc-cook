import { describe, expect, it } from 'vitest'

import {
  STEP_AMOUNT_HINT,
  STEP_AMOUNT_NOTE,
  stepAmountHint,
  stepTimeNote,
  stepAmountsChanged,
  stepNeedsAmountNote,
  TIME_PHRASE_SOURCE,
  textHasAmountNumber,
  textHasTimePhrase,
} from './stepNote'

// R6b D4/B10/B16. The R4 amount note's own cases live in stepNote.test.ts and are not touched.

describe('TIME_PHRASE (the R4 rule) is byte-identical to main', () => {
  it('has the same pattern source as at f2413f2', () => {
    expect(TIME_PHRASE_SOURCE).toBe(
      String.raw`(?:[0-9०-९]+(?:[.,/][0-9०-९]+)?|[¼-¾⅐-⅞])(?:\s?(?:[0-9०-९]+(?:[.,/][0-9०-९]+)?|[¼-¾⅐-⅞]))?(?:\s*(?:-|–|—|to)\s*(?:[0-9०-९]+(?:[.,/][0-9०-९]+)?|[¼-¾⅐-⅞])(?:\s?(?:[0-9०-९]+(?:[.,/][0-9०-९]+)?|[¼-¾⅐-⅞]))?)?\s*(?:[°˚º]\s*[CF]?|(?:mins?|minutes?|hrs?|hours?|secs?|seconds?|degrees?|मिनट|घंटा|घंटे|सेकंड)(?![\p{L}\p{M}]))`,
    )
  })

  it('the amount note still ignores a written time and still flags an amount', () => {
    expect(textHasAmountNumber('Wait 10 min')).toBe(false)
    expect(textHasAmountNumber('Add 2 eggs')).toBe(true)
    expect(stepNeedsAmountNote('Rest', 'Rest 2 hours.')).toBe(false)
  })
})

describe('textHasTimePhrase: numbers', () => {
  it.each([
    'Wait 10 min',
    'Rest 1½ hours',
    'Cook 10-15 minutes',
    'Cook 10–15 min',
    'Rest for 2 hrs',
    'Stir for 30 secs',
    'Stir for 1 second',
    'Rest 10 to 15 minutes',
    'Wait 10 मिनट',
    'Wait 10-15 मिनट',
    'Rest 2 घंटे',
  ])('is true for %j', (text) => {
    expect(textHasTimePhrase(text)).toBe(true)
  })

  it.each(['Bake at 350°F', 'Heat to 180 degrees', 'Add 2 minced garlic', 'Add 2 cups flour', 'Stir well', ''])(
    'is false for %j',
    (text) => {
      expect(textHasTimePhrase(text)).toBe(false)
    },
  )
})

describe('textHasTimePhrase: times in words (B10)', () => {
  it.each([
    'Chill in fridge for one hour.',
    'After one hour, mix the soaked sabudana gently.',
    'Ten minutes before serving, add the fried pakoras.',
    'let it cook for half hour; keep stirring',
    'fry about a minute a side',
    'Rest for half an hour.',
    'Rest for an hour.',
    'Wait a couple of minutes.',
    'Wait a few minutes.',
    'Simmer for forty-five minutes.',
    'Simmer for twenty minutes.',
    'Boil for two hours',
    'Leave it for thirty seconds.',
    'Rest for half-hour',
    'परोसने से दस मिनट पहले पकौड़े डालें।',
    'आधा घंटा पकाएं',
    'डेढ़ घंटे रखें',
    'ढाई घंटे रखें',
    'दो सेकंड रुकें',
  ])('is true for %j', (text) => {
    expect(textHasTimePhrase(text)).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(textHasTimePhrase('TEN MINUTES later')).toBe(true)
    expect(textHasTimePhrase('Half Hour')).toBe(true)
  })

  it.each([
    'Add one onion.',
    'Add 2 minced garlic.',
    'Bake at 350°F.',
    'Heat to 180 degrees.',
    'Add a minced onion.',
    'Use a hourglass.',
    'banana minutes',
    'Slice one tomato.',
    'एक प्याज़ काटें',
  ])('is false for %j', (text) => {
    expect(textHasTimePhrase(text)).toBe(false)
  })

  it('gives the same answer on repeated calls (no sticky regex state)', () => {
    const text = 'Rest for one hour and 10 min.'
    expect([textHasTimePhrase(text), textHasTimePhrase(text), textHasTimePhrase(text)]).toEqual([true, true, true])
    const none = 'Add one onion.'
    expect([textHasTimePhrase(none), textHasTimePhrase(none)]).toEqual([false, false])
  })
})

describe('textHasTimePhrase: "second" (B16)', () => {
  it.each(['add a second layer', 'Add one second layer', 'Wait a second.', 'Wait one second.', 'एक सेकंड रुकें'])(
    'is false for %j (the singular, or the ordinal)',
    (text) => {
      expect(textHasTimePhrase(text)).toBe(false)
    },
  )

  it.each([
    'Wait thirty seconds.',
    'Wait two seconds.',
    'Wait a few seconds.',
    'Wait a couple of seconds.',
    'Wait ten secs.',
    'Wait 1 second.',
    'Wait 30 seconds.',
  ])('is true for %j', (text) => {
    expect(textHasTimePhrase(text)).toBe(true)
  })
})

describe('stepAmountsChanged (B20)', () => {
  it('is true when an amount outside a time phrase differs', () => {
    expect(stepAmountsChanged('Measure 3 cups flour and mix.', 'Measure 4 cups flour and mix.')).toBe(true)
    expect(stepAmountsChanged('Add 2 eggs.', 'Add 3 eggs.')).toBe(true)
  })

  it('is false when only a time changed', () => {
    expect(stepAmountsChanged('Add 2 eggs and bake 20 min.', 'Add 2 eggs and bake 40 minutes.')).toBe(false)
    expect(stepAmountsChanged('Cook 15 min.', 'Cook 25 min.')).toBe(false)
  })

  it('is false when the amounts are the same, however the text around them changed', () => {
    expect(stepAmountsChanged('Add 2 eggs.', 'Crack 2 eggs in.')).toBe(false)
    expect(stepAmountsChanged('Add 1 1/2 cups.', 'Add 1 1/2 cups of milk.')).toBe(false)
  })

  it('counts a number that was added or removed', () => {
    expect(stepAmountsChanged('Add eggs.', 'Add 2 eggs.')).toBe(true)
    expect(stepAmountsChanged('Add 2 eggs.', 'Add eggs.')).toBe(true)
  })

  it('uses the same number vocabulary as the amount note (fractions, Devanagari digits)', () => {
    expect(stepAmountsChanged('Add ½ cup.', 'Add ¾ cup.')).toBe(true)
    expect(stepAmountsChanged('Add २ अंडे।', 'Add ३ अंडे।')).toBe(true)
  })
})

describe('the shared copy', () => {
  it('has the approved wording', () => {
    expect(stepTimeNote(30, false)).toBe("The timer uses the recipe's 30 min.")
    expect(stepTimeNote(5, true)).toBe("The plan uses the recipe's 5 min.")
    expect(STEP_AMOUNT_HINT).toBe("Ingredient amounts don't change with the step. Edit the ingredient if you like.")
  })
})

describe('stepAmountHint (B20, B26): one helper for the page and cooking mode', () => {
  it('is true when an amount moved and the step lists an ingredient', () => {
    expect(stepAmountHint('Measure 3 1/3 cups flour.', 'Measure 4 cups flour.', ['ing_flour'])).toBe(true)
  })

  it('is false for a time-only change', () => {
    expect(stepAmountHint('Rest 10 min.', 'Rest 20 min.', ['ing_flour'])).toBe(false)
  })

  it('is false for a step with no ingredient, or only a component product', () => {
    expect(stepAmountHint('Add 2 eggs.', 'Add 3 eggs.', [])).toBe(false)
    expect(stepAmountHint('Add 2 eggs.', 'Add 3 eggs.', null)).toBe(false)
    expect(stepAmountHint('Add 2 eggs.', 'Add 3 eggs.', ['comp_batter'])).toBe(false)
  })

  it('has the cooking-mode wording, without the edit clause', () => {
    expect(STEP_AMOUNT_NOTE).toBe("Ingredient amounts don't change with the step.")
  })
})

describe('stepTimeNote (CP5.1 U2)', () => {
  it('a hands-off step names its timer, a hands-on step names the plan', () => {
    expect(stepTimeNote(30, false)).toBe("The timer uses the recipe's 30 min.")
    expect(stepTimeNote(5, true)).toBe("The plan uses the recipe's 5 min.")
  })

  it('the length is the one the timer names: rounded, hours spelled the same way', () => {
    expect(stepTimeNote(89.6, false)).toBe("The timer uses the recipe's 1 hr 30 min.")
    expect(stepTimeNote(120, false)).toBe("The timer uses the recipe's 2 hr.")
  })

  it('nothing under a minute, or with no length', () => {
    expect(stepTimeNote(0, false)).toBeNull()
    expect(stepTimeNote(0.4, true)).toBeNull()
  })
})
