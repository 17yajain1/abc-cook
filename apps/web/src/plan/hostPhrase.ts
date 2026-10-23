/**
 * How the multitask note names the step that holds a wait: "while the tomato base cooks", "while the rice
 * soaks". Step labels are imperative ("Cook tomato base"), so the phrase turns the verb into the thing's
 * own: a closed list of cooking verbs, the rest of the label as the object, "the {object} {verb}s".
 *
 * Anything that doesn't read cleanly falls back to quoting the step: during "{Step name}". That covers a verb
 * not on the list, no object, a long object, or an object with a preposition in it ("Simmer to thicken").
 * Presentational only: it changes how a step is named, never what the plan says about it.
 */

// Singular forms; the plural-object form is the bare verb ("the beans soak"). Closed on purpose.
const VERBS: Record<string, string> = {
  cook: 'cooks',
  soak: 'soaks',
  simmer: 'simmers',
  boil: 'boils',
  rest: 'rests',
  proof: 'proofs',
  marinate: 'marinates',
  chill: 'chills',
  bake: 'bakes',
  fry: 'fries',
  roast: 'roasts',
  steam: 'steams',
}

// Words that make an object read as a clause rather than a thing.
const CLAUSE_WORDS = new Set([
  'to', 'until', 'till', 'for', 'in', 'on', 'with', 'and', 'or', 'then', 'at', 'into', 'over', 'by', 'before',
  'after', 'from', 'of', 'while', 'when', 'so',
])

const ARTICLES = new Set(['the', 'a', 'an'])

const MAX_OBJECT_WORDS = 4

/** A plural object: ends in "s" but not "ss" ("potatoes", "beans", not "grass"). */
function isPlural(object: string): boolean {
  const last = object.split(/\s+/).pop() ?? ''
  return /s$/i.test(last) && !/ss$/i.test(last)
}

/** "while the tomato base cooks", or `during "Wait before serving"`. */
export function hostPhrase(label: string): string {
  const quoted = `during "${label}"`
  const words = label.trim().split(/\s+/).filter(Boolean)
  const verb = (words[0] ?? '').toLowerCase()
  const singular = VERBS[verb]
  if (!singular) return quoted

  let rest = words.slice(1)
  if (rest.length > 0 && ARTICLES.has(rest[0].toLowerCase())) rest = rest.slice(1)
  if (rest.length === 0 || rest.length > MAX_OBJECT_WORDS) return quoted
  for (const w of rest) {
    if (CLAUSE_WORDS.has(w.toLowerCase())) return quoted
    // Letters, with a hyphen or apostrophe inside: no digits, brackets or other punctuation.
    if (!/^[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*$/u.test(w)) return quoted
  }
  const object = rest.join(' ')
  return `while the ${object} ${isPlural(object) ? verb : singular}`
}
