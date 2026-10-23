import type { Ingredient, SourceRef } from '@abc-cook/schema'

import { UNDO_WINDOW_MS } from '@/cooking/constants'
import { current, handover, lifecycle, role, running, stepPosition, waitSubject } from '@/cooking/select'
import type { CookingModel, CookingSession, SessionConflict } from '@/cooking/types'
import { attentionTag } from '@/lib/attention'
import { displayCue } from '@/lib/displayCue'
import { cueShownWith } from '@/lib/doneness'
import { formatMinutes } from '@/lib/duration'
import { choiceFactor, type ServingsChoice } from '@/lib/servings'
import { servingsCopy } from '@/lib/servingsCopy'
import { STEP_AMOUNT_NOTE, STEP_TIME_NOTE, stepAmountHint, stepNeedsAmountNote, textHasTimePhrase } from '@/lib/stepNote'
import { canonicalSourceKey, thumbnailUrlFor } from '@/library/sourceKey'

import { endedAgo, handsOffLine, sentence, sinceText, timeLeft, timerLength } from './copy'
import { canResolveConflictTarget } from './conflictResolve'
import { needRows, quantityChips, type NeedRow } from './quantity'
import {
  backTarget,
  meanwhileRows,
  pageOrder,
  ticks,
  upNext,
  waitingNext,
  type MeanwhileRow,
  type Tick,
  type UpNextView,
} from './stepPage'
import { strips, timerSheet, type StripView } from './timers'
import { shouldHoldWakeLock } from './wakeLock'

/**
 * The screen-selection and copy layer for Cooking Mode (M3.4; PR 2 CP2-CP4). Every fact
 * this file reads comes from the real selectors (`@/cooking/select`) — nothing here
 * recomputes `current`, `handover`, `role` or any other scheduling/session decision. This
 * file only turns their outputs into the strings and action descriptors the screens render.
 *
 * PR 2 CP4: four layouts are left. The step page (CP3); the waiting screen (V2Wait) for a
 * step whose timer is running, viewed or chosen because nothing else needs the cook; the
 * done screen (V2Done); and the stale message. A timer's end is a banner (`timers.ts`
 * `strips`), never a takeover; there is no start, leaving or returning screen.
 *
 * `conflict` is deliberately not a `ScreenId` case `resolveScreen`/`buildCookingView`
 * ever reach — a plan-key conflict means the stored session does not belong to `model`
 * at all, so there is no `(model, session)` pair to build a view from. The caller
 * (`CookingModeScreen`) renders that screen directly from `OpenResult.conflict`, via
 * `buildConflictView`.
 */

export type ScreenId =
  | 'task'
  | 'handsoff_pending'
  /** The waiting screen of a viewed step whose timer is running (PR 2 CP4: V2Wait). */
  | 'step_running'
  /** PR 2 CP2: the step page for a viewed step that is already done. */
  | 'step_done'
  /** The waiting screen chosen when nothing needs the cook; the three ids keep the wake-lock
   * rules (`wakeLock.ts`) apart: held on `wait`, released on the long two. */
  | 'wait'
  | 'long_wait'
  | 'sitting_break'
  | 'stale'
  | 'done'
  /** Produced only by the caller directly from `OpenResult` — never by `resolveScreen`.
   * See this file's top comment. */
  | 'conflict'

export type ActionDescriptor =
  /** `clearView` (PR 2 CP2): the step was started from a view naming it, so the caller
   * follows the start with `view(null)` and the cook moves on, as Done does. */
  | { kind: 'startNode'; nodeId: string; clearView?: boolean }
  | { kind: 'markDone'; nodeId: string }
  /** PR 2 CP1: the timer sheet's "Stop timer" (CP3). */
  | { kind: 'stopNode'; nodeId: string }
  /** PR 2 CP1: navigation only. Up next, Back, All steps and the Meanwhile rows emit it. */
  | { kind: 'view'; nodeId: string | null }
  /** `ms` (PR 2 CP3.0): the amount to add; absent is the engine's default (`EXTEND_MS`). */
  | { kind: 'extend'; nodeId: string; ms?: number }
  /** The stale screen's "Carry on". */
  | { kind: 'touch' }
  /** PR 2 CP4: the stale screen's "Start again": one atomic replace, then step 1. */
  | { kind: 'startAgain' }
  /** P1 #6 §C3: reverses `lastTransition` — the "Undo" link (PR 2 CP2's label). */
  | { kind: 'undo' }
  /** P1 #6 §C4: "Finished cooking" — ends the session, then leaves (`onFinish`). */
  | { kind: 'finish' }
  /** PR 2 CP4: the done screen's Back — show the last step (local UI, never persisted). */
  | { kind: 'review' }
  /** PR 2 CP4: All steps' "End cook" — ends the session, then leaves Cooking Mode (`onExit`). */
  | { kind: 'endAndExit' }

export interface ActionButton {
  label: string
  solid: boolean
  action: ActionDescriptor
}

/** Which layout the shell draws (PR 2 CP4). */
export type Layout = 'step' | 'waiting' | 'done' | 'message'

/** PR 2 CP4 (V2Wait): the waiting block, built from the timer sheet's own figures
 * (`timerSheet`), so the sheet and the screen can't disagree. */
export interface WaitingView {
  /** "48" + "min left"; "1 hr 12 min" + "left"; "Time's up" + `null` once it has ended. */
  big: string
  unit: string | null
  ended: boolean
  /** "Ready around 1:42 PM. We'll ring when it's done." (wake lock held), the long-wait
   * alarm line (released), or "Timer ended 4 min ago" once it has ended. */
  line: string
  fraction: number
  /** "Add 5 min": from now on an expired timer (CP4.0). */
  add: ActionButton
  /** The tasks of the windows this step hosts (the recipe page's "Meanwhile, do these"). */
  meanwhile: MeanwhileRow[]
}

/** PR 2 CP4 (V2Done). */
export interface DoneView {
  /** The recipe's YouTube thumbnail, or `null`: no image and no gap. */
  thumbnail: string | null
  /** The picture's alt text: "‹Title›, from the recipe's video". */
  alt: string
  /** One line from the session: "All 8 steps, in 1 hr 22 min." / "Done in 1 hr 22 min." */
  line: string
}

export interface CookingView {
  screenId: ScreenId
  layout: Layout
  topRecipe: string
  showTopRight: boolean
  label: string | null
  title: string
  instr: string | null
  qty: string | null
  /** F2 ingredient chips: one `quantityPhrases` entry per consumed ingredient (structured
   * amount + name, never parsed from the instruction). Only on `task`/`handsoff_pending`,
   * which no longer set `qty`; `[]` everywhere else. Display only — not controls. */
  chips: string[]
  /** R4: `chips`, structured. `text` is exactly the `chips` string at the same index; `unscaled`
   * marks an amount the scaler could not scale at this factor, drawn with a visual mark, and
   * `label` is then its accessible name ("2 tsp salt — amount for 4 servings"). The shell
   * draws these, not `chips`, which stays the string list tests and keys read. */
  chipItems: Array<{ text: string; unscaled: boolean; label?: string }>
  /** R4: "Amounts in this step's text are for N servings." — only at a factor other than 1,
   * and only for a step whose label or instruction quotes an amount. */
  servingsNote: string | null
  /** R4 F1: "Times are for N servings. A bigger batch can take longer." Shown once per session,
   * on its first step screen, when the factor is 2 or more. Later steps and a smaller factor
   * get `null`. */
  timesNote: string | null
  /** R6b B3 (ii): "Timers stay as planned. Changing times comes later." Only on the task screen of a step the
   * cook edited whose text now has a time phrase. No "Edited" mark anywhere; the timer is still the scheduler's. */
  stepTimeNote: string | null
  /** R6b B26: "Ingredient amounts don't change with the step." when the edited text's amounts moved and the step
   * lists an ingredient (the page's B20 condition, one helper). Shown after the time note. No "Edited" mark. */
  stepAmountNote: string | null
  /** "Added by ABC Cook, not in the video" under the instruction when the step was added
   * (FGC-3). `null` on every other screen and for every step from the source. */
  addedNote: string | null
  note: string | null
  /** "Step N of M" on the step and waiting screens (PR 2 CP2: N is the recipe-page number,
   * `stepNumbers`, falling back to the execution order). `null` everywhere else. */
  step: string | null
  /** PR 2 CP2: the Up next block (`stepPage.ts`'s `upNext`; "When it's done" on a waiting
   * screen), navigation only. `null` on the finish step and elsewhere. */
  upNext: UpNextView | null
  /** PR 2 CP2: one progress tick per page step, on the step and waiting screens only. */
  ticks: Tick[] | null
  /** "Back": to the previous page step (a view, never a completion), or the done screen's
   * `review`. `null` on page step 1 and on the stale screen. */
  back: ActionButton | null
  /** PR 2 CP2: "Done." under the text of a done step (`step_done`), which has no primary. */
  stateLine: string | null
  primary: ActionButton | null
  /** The Undo link (drawn outside the footer, so it never moves the primary) or the stale
   * screen's "Start again". */
  secondary: ActionButton | null
  /** PR 2 CP3: the step on a step or waiting screen; `null` everywhere else. */
  nodeId: string | null
  /** PR 2 CP3/CP4: the rails and banners under the top bar (`timers.ts` `strips`), on the
   * step and waiting screens only; `[]` elsewhere. */
  strips: StripView[]
  /** PR 2 CP3: a not-started hands-off step's tag ("Hands-off" / "Low attention"), its
   * "About 1 hr. ..." line by tag (`handsOffLine`; `null` without a length) and the
   * quiet "Mark as done" link (owner answer 5). `null` on every other page. */
  handsOff: { tag: string; line: string | null; markDone: ActionButton } | null
  /** PR 2 CP3: how you know the step is ready, as stored, shown after "Ready when:" — only
   * when the step text doesn't already say it (`cueShownWith`) and the cue is showable
   * (`displayCue`). On the not-done step pages and the waiting screen. */
  cue: string | null
  /** PR 2 CP3: "You'll need" rows (`needRows`); `label` is the R4 accessible name of an
   * amount the scaler could not scale. `[]` off the step pages. */
  need: Array<NeedRow & { label?: string }>
  /** PR 2 CP3: the step's ingredients, for the step text's bolding (`EmphasisText`, D6):
   * only the fields it reads, so no ingredient id reaches the view. */
  consumed: Pick<Ingredient, 'name' | 'qty' | 'qty_text' | 'qty_amount' | 'unit'>[]
  /** PR 2 CP3: the session's servings factor, for the same bolding. */
  factor: number
  /** PR 2 CP4: the waiting block, on the waiting screens only. */
  waiting: WaitingView | null
  /** PR 2 CP4: the done screen's picture and line. */
  done: DoneView | null
}

interface ScreenResolution {
  id: ScreenId
  nodeId: string | null
}

/** The step pages (task, hands-off, done) and the waiting screens. */
const STEP_SCREENS: ScreenId[] = ['task', 'handsoff_pending', 'step_done']
const WAITING_SCREENS: ScreenId[] = ['step_running', 'wait', 'long_wait', 'sitting_break']

function sinkOf(model: CookingModel): string {
  return model.order.find((id) => model.nodes[id].isSink) ?? model.order[model.order.length - 1]
}

/**
 * Which screen, in order: `lifecycle` first (finished: the done screen, or the step the cook
 * went Back to while `reviewing`; stale), then the viewed step (PR 2 CP2), then `current`,
 * then the waiting screen. PR 2 CP4: a handover no longer takes over the screen — its timer
 * is a banner — so with nothing to do the waiting screen shows the first handover producer,
 * else the wait subject, else (several pans, none the subject) the soonest running timer.
 */
function resolveScreen(model: CookingModel, session: CookingSession, now: number, reviewing: boolean): ScreenResolution {
  const lc = lifecycle(model, session, now)
  if (lc === 'finished') {
    if (!reviewing) return { id: 'done', nodeId: null }
    const id = session.viewing != null && session.viewing in model.nodes ? session.viewing : sinkOf(model)
    return { id: viewedScreen(model, session, id), nodeId: id }
  }
  if (lc === 'stale') return { id: 'stale', nodeId: null }

  // The cook chose to look at a step: show it whatever its state.
  const viewed = session.viewing
  if (viewed != null && viewed in model.nodes) return { id: viewedScreen(model, session, viewed), nodeId: viewed }

  const cur = current(model, session)
  if (cur != null) return { id: model.nodes[cur].occupiesCook ? 'task' : 'handsoff_pending', nodeId: cur }

  const r = role(model, session, now)
  if (r === 'handover') return { id: 'wait', nodeId: handover(model, session, now)!.producers[0] }
  const subject = waitSubject(model, session, now)?.nodeId ?? running(model, session)[0] ?? null
  if (subject != null) return { id: r === 'task' ? 'wait' : r, nodeId: subject }

  // Nothing to do and nothing running (only reachable through out-of-order states): the
  // first step not yet done, else the finish step.
  const left = model.order.find((id) => session.nodes[id].state !== 'done') ?? sinkOf(model)
  return { id: viewedScreen(model, session, left), nodeId: left }
}

/** The screen a viewed step gets, by its state. */
function viewedScreen(model: CookingModel, session: CookingSession, nodeId: string): ScreenId {
  const s = session.nodes[nodeId].state
  if (s === 'done') return 'step_done'
  if (s === 'running') return 'step_running'
  return model.nodes[nodeId].occupiesCook ? 'task' : 'handsoff_pending'
}

export interface CookingViewOptions {
  recipeTitle: string
  /** R4: the session's servings choice (`session.servingsChoice`); absent is factor 1. */
  choice?: ServingsChoice | null
  /** R6b: ids of the steps whose text the cook edited (`OverlayResult.editedSteps`). Absent is none. */
  editedSteps?: ReadonlySet<string>
  /** R6b: for each edited step, its instruction as imported (`OverlayResult.importedSteps`). */
  importedSteps?: ReadonlyMap<string, string>
  /** PR 2 CP2: the recipe-page number of each step (`stepNumbers(derivePlan(...).stages)`).
   * Absent, or missing a step, falls back to the execution order. */
  pageNumbers?: ReadonlyMap<string, number>
  /** PR 2 CP4: the done screen's Back was tapped, so a finished cook shows its steps.
   * Local UI state (`CookingModeScreen`), never persisted. */
  reviewing?: boolean
  /** PR 2 CP4: the done screen's picture (`recipeThumbnail`); absent or `null` is none. */
  thumbnail?: string | null
  /** For tests: the clock's locale (default: the device's). */
  locale?: string
}

const UNDO_ELIGIBLE_SCREENS: ScreenId[] = [...STEP_SCREENS, ...WAITING_SCREENS, 'done']

/** The undo link (P1 #6 plan §C3): shown for `UNDO_WINDOW_MS` timed from the *persisted*
 * `lastTransition.at` — never a timer of its own, so it survives the phone sleeping. It
 * takes the `secondary` slot, which the shell draws outside the footer (PR 2 CP3), so it
 * never moves the primary. `onScreen` is the step the screen is about: the step on a step
 * or waiting screen, the finish step on the done screen. */
function applyUndoOverride(
  v: CookingView,
  model: CookingModel,
  session: CookingSession,
  now: number,
  onScreen: string | null,
): void {
  if (!UNDO_ELIGIBLE_SCREENS.includes(v.screenId)) return
  const t = session.lastTransition
  if (t == null) return
  if (now - t.at >= UNDO_WINDOW_MS) return
  v.secondary = { label: undoLabel(model, t, onScreen), solid: false, action: { kind: 'undo' } }
}

/** Owner answer 2 (PR 2 CP3): on the acted-on step's own screen (the transition's first
 * entry: the sink on an early finish, the first producer on an acknowledge) just "Undo";
 * anywhere else, what it undoes and where. A stored legacy `skip` keeps "Undo". */
function undoLabel(model: CookingModel, t: NonNullable<CookingSession['lastTransition']>, onScreen: string | null): string {
  const acted = t.entries[0]?.nodeId
  if (acted == null || acted === onScreen) return 'Undo'
  const name = model.nodes[acted]?.label
  if (name == null) return 'Undo'
  if (t.kind === 'done' || t.kind === 'acknowledge') return `Undo Done on ${name}`
  if (t.kind === 'start') return `Undo timer start on ${name}`
  if (t.kind === 'stop') return `Undo timer stop on ${name}`
  return 'Undo'
}

/** PR 2 CP4: the done screen's picture: the recipe's YouTube thumbnail, else `null`. */
export function recipeThumbnail(source: SourceRef): string | null {
  return thumbnailUrlFor(canonicalSourceKey(source))
}

/** PR 2 CP4: the done screen's one line, from session state only. The time is measured
 * (`finishedAt − startedAt`), never a plan figure. The step count only when every step is
 * done: otherwise we can't tell whether a step marked Done was really done, or whether
 * skipping one mattered, so the line says only how long it took. */
export function doneLine(model: CookingModel, session: CookingSession): string {
  const ms = (session.finishedAt ?? session.startedAt) - session.startedAt
  const time = ms < 60_000 ? 'under a minute' : formatMinutes(Math.round(ms / 60_000))
  const steps = model.order.length
  if (!model.order.every((id) => session.nodes[id].state === 'done')) return `Done in ${time}.`
  return steps === 1 ? `1 step, in ${time}.` : `All ${steps} steps, in ${time}.`
}

/**
 * `viewOf` (dc.html), ported: state -> every slot the shell renders. Requires an
 * *active* pairing between `session` and `model` — the caller must have already
 * resolved `open()` to `'ok'` (never `'conflict'`) before calling this.
 */
export function buildCookingView(
  model: CookingModel,
  session: CookingSession,
  now: number,
  ingredients: ReadonlyMap<string, Ingredient>,
  options: CookingViewOptions,
): CookingView {
  const reviewing = options.reviewing === true && session.finishedAt != null
  const scr = resolveScreen(model, session, now, reviewing)
  const v: CookingView = {
    screenId: scr.id,
    layout: 'message',
    topRecipe: options.recipeTitle,
    showTopRight: true,
    label: null,
    title: '',
    instr: null,
    qty: null,
    chips: [],
    chipItems: [],
    servingsNote: null,
    timesNote: null,
    stepTimeNote: null,
    stepAmountNote: null,
    addedNote: null,
    note: null,
    step: null,
    upNext: null,
    ticks: null,
    back: null,
    stateLine: null,
    primary: null,
    secondary: null,
    nodeId: null,
    strips: [],
    handsOff: null,
    cue: null,
    need: [],
    consumed: [],
    factor: choiceFactor(options.choice),
    waiting: null,
    done: null,
  }

  const isStep = STEP_SCREENS.includes(scr.id)
  if (isStep || WAITING_SCREENS.includes(scr.id)) {
    const cur = scr.nodeId!
    const n = model.nodes[cur]
    const copy = servingsCopy(options.choice ?? null)
    v.nodeId = cur
    v.label = n.label
    // "Step N of M": the recipe-page number of the step on the page.
    const order = pageOrder(model, options.pageNumbers)
    const pageN = order.indexOf(cur) + 1
    v.step = v.factor !== 1 ? copy.stepMeta(pageN, order.length) : `Step ${pageN} of ${order.length}`
    v.ticks = ticks(session, order, cur)
    const prev = backTarget(order, cur)
    v.back = prev != null ? { label: 'Back', solid: false, action: { kind: 'view', nodeId: prev } } : null
    // CP3: the cue as its own "Ready when:" line, only when the text doesn't already say it
    // (the recipe page's rule); never on a done step.
    if (scr.id !== 'step_done') {
      const shown = displayCue(n.donenessCue)
      v.cue = cueShownWith(n.instruction, shown) != null ? shown : null
    }

    if (isStep) {
      v.layout = 'step'
      buildStepPage(v, model, session, now, ingredients, options, cur, order, reviewing)
    } else {
      v.layout = 'waiting'
      buildWaiting(v, model, session, now, cur, order, options.locale)
    }
    applyUndoOverride(v, model, session, now, cur)
    return v
  }

  if (scr.id === 'done') {
    v.layout = 'done'
    v.topRecipe = ''
    v.showTopRight = false
    v.title = sentence(`${options.recipeTitle} is done`)
    v.done = {
      thumbnail: options.thumbnail ?? null,
      alt: `${options.recipeTitle}, from the recipe's video`,
      line: doneLine(model, session),
    }
    v.back = { label: 'Back', solid: false, action: { kind: 'review' } }
    v.primary = { label: 'Finished cooking', solid: true, action: { kind: 'finish' } }
    applyUndoOverride(v, model, session, now, sinkOf(model))
    return v
  }

  // stale (PR 2 CP4): wired, not removed — Home's Continue strip resumes a stale session here.
  v.showTopRight = false
  v.title = `You were last here ${sinceText(now - session.lastSeenAt)} ago.`
  v.instr = 'Carry on where you left off, or start again.'
  v.primary = { label: 'Carry on', solid: true, action: { kind: 'touch' } }
  v.secondary = { label: 'Start again', solid: false, action: { kind: 'startAgain' } }
  return v
}

/** The step page (PR 2 CP2/CP3): the instruction, the hands-off block, You'll need, Up
 * next and the primary. While `reviewing` a finished cook (PR 2 CP4) the primary is
 * "Finished cooking" and nothing that acts on the cook is offered. */
function buildStepPage(
  v: CookingView,
  model: CookingModel,
  session: CookingSession,
  now: number,
  ingredients: ReadonlyMap<string, Ingredient>,
  options: CookingViewOptions,
  cur: string,
  order: string[],
  reviewing: boolean,
): void {
  const n = model.nodes[cur]
  const factor = v.factor
  const copy = servingsCopy(options.choice ?? null)
  // V2.1 (1a order, reweighted): the step label is the screen's title and the full
  // instruction follows it untruncated.
  v.title = n.instruction
  const chips = quantityChips(n, ingredients, factor)
  v.chips = chips.map((chip) => chip.text)
  v.chipItems = chips.map((chip) => (chip.unscaled ? { ...chip, label: copy.chipLabel(chip.text) } : chip))
  // CP3: "You'll need" rows replace the chips on screen (`chips` stays for its tests).
  v.need = needRows(n, ingredients, factor).map((row) =>
    row.unscaled ? { ...row, label: copy.chipLabel(`${row.name}, ${row.amount ?? ''}`) } : row,
  )
  v.consumed = n.consumes.flatMap((id) => {
    const i = id.startsWith('ing_') ? ingredients.get(id) : undefined
    return i != null ? [{ name: i.name, qty: i.qty, qty_text: i.qty_text, qty_amount: i.qty_amount, unit: i.unit }] : []
  })
  v.servingsNote = factor !== 1 && stepNeedsAmountNote(n.label, n.instruction) ? copy.stepNote : null
  v.addedNote = n.addedLabel
  v.stepTimeNote = options.editedSteps?.has(cur) && textHasTimePhrase(n.instruction) ? STEP_TIME_NOTE : null
  const imported = options.importedSteps?.get(cur)
  v.stepAmountNote =
    options.editedSteps?.has(cur) && imported != null && stepAmountHint(imported, n.instruction, n.consumes) ? STEP_AMOUNT_NOTE : null
  // R4 F1: once per session, on its first step screen — the live count, not the page number.
  v.timesNote = stepPosition(model, session).n === 1 ? copy.timesNote : null
  if (v.screenId === 'step_done') v.stateLine = 'Done.'

  if (reviewing) {
    v.primary = { label: 'Finished cooking', solid: true, action: { kind: 'finish' } }
    return
  }

  // CP3: the rail; CP4: the banner in its place once a timer ends.
  v.strips = strips(model, session, now, order)
  v.upNext = upNext(model, session, now, cur, order)
  if (v.screenId === 'task') {
    v.primary = { label: 'Done', solid: true, action: { kind: 'markDone', nodeId: cur } }
  } else if (v.screenId === 'handsoff_pending') {
    const action: ActionDescriptor =
      session.viewing === cur ? { kind: 'startNode', nodeId: cur, clearView: true } : { kind: 'startNode', nodeId: cur }
    // FGC-37: the timer's length is the same number `startNode` times.
    const len = timerLength(n.durationTypical)
    v.primary = { label: len != null ? `Start ${len} timer` : "I've started it", solid: true, action }
    v.handsOff = {
      tag: attentionTag(n.attention) ?? 'Hands-off',
      line: handsOffLine(n.durationTypical, n.attention),
      markDone: { label: 'Mark as done', solid: false, action: { kind: 'markDone', nodeId: cur } },
    }
  }
}

/**
 * The waiting screen (PR 2 CP4, V2Wait): the step's name, the time left, "Add 5 min", the
 * bar and the ready line, the Meanwhile block, "When it's done" and "It's done". The step's
 * own timer is left off the strips (no duplicate); once it ends, its banner is left off too
 * and the block here shows the end instead.
 */
function buildWaiting(
  v: CookingView,
  model: CookingModel,
  session: CookingSession,
  now: number,
  cur: string,
  order: string[],
  locale?: string,
): void {
  v.strips = strips(model, session, now, order, cur)
  v.upNext = waitingNext(model, session, now, cur, order)
  v.primary = { label: "It's done", solid: true, action: { kind: 'markDone', nodeId: cur } }
  const sheet = timerSheet(model, session, now, cur, order, cur, locale)
  if (sheet == null) return
  const s = session.nodes[cur]
  const endsAt = s.state === 'running' ? s.endsAt : now
  // Owner answer 6: "We'll ring" only where the wake lock is held.
  const ring = shouldHoldWakeLock(v.screenId)
    ? "We'll ring when it's done."
    : "Set an alarm too; we can't ring once your phone locks."
  v.waiting = {
    big: sheet.big,
    unit: sheet.unit,
    ended: sheet.ended,
    line: sheet.ended ? `Timer ended ${endedAgo(now - endsAt)}` : `${sheet.readyAt}. ${ring}`,
    fraction: sheet.fraction,
    add: { label: sheet.add.label, solid: false, action: sheet.add.action },
    meanwhile: meanwhileRows(model, session, now, cur, order),
  }
}

// ---------------------------------------------------------------------------
// Conflict — CP1a (M3.4.5 session-lockout plan); PR 2 CP4 (V2Conflict). Built from a
// `SessionConflict` (`@/cooking/types`), not a `(model, session)` pair — see the file-top
// comment.
// ---------------------------------------------------------------------------

export type ConflictActionKind = 'goTo' | 'endAndStart' | 'close'

export interface ConflictAction {
  kind: ConflictActionKind
  label: string
}

/** The blocking cook's soonest timer, read from the stored session. `stepName` is `null`
 * when this device can't name the step (a `server:` key has no payload here). */
export interface ConflictTimer {
  stepName: string | null
  endsAt: number
}

export interface ConflictViewModel {
  planKey: string
  title: string | null
  state: SessionConflict['state']
  /** "You're still cooking Kadai Paneer." (34/800, through `sentence`). */
  heading: string
  /** One line on the blocking cook's soonest timer (or none), then "Pick one cook to carry on with." */
  line: string
  /**
   * Always two (PR 2 CP4). With "Go to" possible: "Back to ‹A›" and "End it and cook ‹B›",
   * in CP-C order (`active`/`unknown` lead with going back; `stale`/`finished` with ending
   * it, since there is nothing live to go back to). Without (`canGoTo` false: an `import:`
   * key or a deleted entry): "End it and cook ‹B›" and "Back" (close). Index 0 is the
   * solid primary.
   */
  actions: ConflictAction[]
}

/**
 * Whether a `planKey` is offered as a "Go to" destination (CP1a's shape, CP1b's real
 * check). Defaults to `resolveConflictTarget`'s prefix rule presuming every `library:`
 * id still exists — `server:`/`library:` addressable, `import:` never. The real,
 * App-wired check (`CookingModeScreen` passing a predicate backed by the actual
 * `Library`) additionally hides `library:` when that specific entry no longer exists.
 */
function defaultCanGoTo(planKey: string): boolean {
  return canResolveConflictTarget(planKey, () => true)
}

/** CP-C priority: `active` and `unknown` alike lead with "Back to"; `stale`/`finished` with "End it". */
function endAndStartLeads(state: SessionConflict['state']): boolean {
  return state === 'stale' || state === 'finished'
}

function conflictHeading(conflict: SessionConflict): string {
  const name = conflict.title ?? 'another recipe'
  if (conflict.state === 'stale') return `You left ${name} a while ago.`
  if (conflict.state === 'finished') return sentence(`You finished ${name}`)
  return sentence(`You're still cooking ${name}`)
}

function timerSentence(timer: ConflictTimer | null, now: number): string | null {
  if (timer == null) return null
  if (timer.endsAt > now) {
    const left = timeLeft(timer.endsAt - now).text
    // Keeps the step name's own casing: "Tomato base has 6 min left on its timer."
    return timer.stepName != null ? `${timer.stepName} has ${left} on its timer.` : `A timer has ${left}.`
  }
  const ago = endedAgo(now - timer.endsAt)
  return timer.stepName != null ? `${timer.stepName}'s timer ended ${ago}.` : `A timer ended ${ago}.`
}

/** The blocking session's soonest running timer, as the conflict screen names it. */
export function conflictTimer(
  session: CookingSession | null,
  stepName: (nodeId: string) => string | null,
): ConflictTimer | null {
  if (session == null) return null
  let best: { id: string; endsAt: number } | null = null
  for (const [id, s] of Object.entries(session.nodes)) {
    if (s.state === 'running' && (best == null || s.endsAt < best.endsAt)) best = { id, endsAt: s.endsAt }
  }
  return best != null ? { stepName: stepName(best.id), endsAt: best.endsAt } : null
}

/**
 * `buildConflictView` (CP1a, `canGoTo` CP1b, priority CP-C, PR 2 CP4's V2Conflict copy):
 * the conflict screen's heading, line and its two actions, from the `SessionConflict`
 * `engine.open()` reports plus the blocking cook's soonest timer.
 */
export function buildConflictView(
  conflict: SessionConflict,
  canGoTo: (planKey: string) => boolean = defaultCanGoTo,
  options: { recipeTitle: string; timer: ConflictTimer | null; now: number } = { recipeTitle: 'this', timer: null, now: 0 },
): ConflictViewModel {
  const goTo: ConflictAction = { kind: 'goTo', label: `Back to ${conflict.title ?? 'that recipe'}` }
  const endAndStart: ConflictAction = { kind: 'endAndStart', label: `End it and cook ${options.recipeTitle}` }
  const actions = canGoTo(conflict.planKey)
    ? endAndStartLeads(conflict.state)
      ? [endAndStart, goTo]
      : [goTo, endAndStart]
    : [endAndStart, { kind: 'close' as const, label: 'Back' }]
  const timer = timerSentence(options.timer, options.now)
  return {
    planKey: conflict.planKey,
    title: conflict.title,
    state: conflict.state,
    heading: conflictHeading(conflict),
    line: `${timer != null ? `${timer} ` : ''}Pick one cook to carry on with.`,
    actions,
  }
}
