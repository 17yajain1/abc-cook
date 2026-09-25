import type { Ingredient } from '@abc-cook/schema'

import {
  handover,
  holding,
  lifecycle,
  nextRequiredAt,
  requiredIfExpired,
  role,
  running,
  sheetOrder,
  sittingIndex,
  skipAllowed,
  waitSubject,
  whisperInput,
  current,
} from '@/cooking/select'
import type { CookingModel, CookingSession, SessionConflict } from '@/cooking/types'
import type { HeaderTiming } from '@/lib/duration'

import { aboutMinutes, cap, dayClock, splitCopy, wordFor } from './copy'
import { canResolveConflictTarget } from './conflictResolve'
import { quantityLine } from './quantity'

/**
 * The screen-selection and copy layer for Cooking Mode (M3.4), ported from the design
 * handoff's prototype (`Cooking Mode - M3.4 UI.dc.html`'s `screenOf`/`viewOf`/
 * `whisperFor`/`applySheet`). Every fact this file reads comes from the real M3.3
 * selectors (`@/cooking/select`) — nothing here recomputes `current`, `handover`,
 * `role`, `awayClass` or any other scheduling/session decision. This file only turns
 * their outputs into the strings and action descriptors the screens render.
 *
 * `conflict` is deliberately not a `ScreenId` case `resolveScreen`/`buildCookingView`
 * ever reach — a plan-key conflict means the stored session does not belong to `model`
 * at all, so there is no `(model, session)` pair to build a view from. The caller
 * (`CookingModeScreen`) renders that screen directly from `OpenResult.conflict`, via
 * this module's own `buildConflictView` (CP1a) — a separate, smaller view model than
 * `CookingView`, built from a `SessionConflict` rather than a `(model, session)` pair.
 */

export type ScreenId =
  | 'entry'
  | 'task'
  | 'handsoff_pending'
  | 'wait'
  | 'long_wait'
  | 'handover'
  | 'leaving'
  | 'returning'
  | 'sitting_break'
  | 'sitting_resume'
  | 'stale'
  | 'done'
  /** Produced only by the caller directly from `OpenResult` — never by `resolveScreen`.
   * See this file's top comment. */
  | 'conflict'

export type ActionDescriptor =
  | { kind: 'start' }
  | { kind: 'startNode'; nodeId: string }
  | { kind: 'markDone'; nodeId: string }
  | { kind: 'skip'; nodeId: string }
  | { kind: 'extend'; nodeId: string }
  | { kind: 'acknowledge' }
  | { kind: 'resume' }
  | { kind: 'touch' }
  | { kind: 'end' }
  /** Dismiss the local "leaving" screen without touching the session. */
  | { kind: 'stay' }
  /** Navigate back to the Plan view. Local UI only — never an engine action. */
  | { kind: 'seePlan' }

export interface ActionButton {
  label: string
  solid: boolean
  action: ActionDescriptor
}

export type Shell = 'paper' | 'dark' | 'field'

export interface CookingView {
  screenId: ScreenId
  shell: Shell
  topRecipe: string
  showTopRight: boolean
  label: string | null
  title: string
  instr: string | null
  qty: string | null
  note: string | null
  whisperText: string | null
  showLink: boolean
  primary: ActionButton | null
  secondary: ActionButton | null
}

export interface SheetRowView {
  nodeId: string
  label: string
  cue: string
  time: string
  dot: boolean
}

export interface SheetView {
  rows: SheetRowView[]
  note: string
  next: string | null
}

function endsAtOf(session: CookingSession, nodeId: string): number {
  const s = session.nodes[nodeId]
  return s.state === 'running' ? s.endsAt : Number.POSITIVE_INFINITY
}

function sheetTime(model: CookingModel, session: CookingSession, now: number, id: string): string {
  const rem = endsAtOf(session, id) - now
  if (rem <= 0) return 'done'
  const info = model.nodes[id]
  if (info.durationMax - info.durationMin > 15) return `~${Math.round(rem / 60_000)}m`
  const s = Math.round(rem / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

interface ScreenResolution {
  id: ScreenId
  currentNodeId: string | null
  nextNodeId: string | null
}

/** `screenOf` (dc.html), ported: `lifecycle` first, then the local "leaving" UI flag,
 * then the `leftAt` overlay, then `role` — the exact composition order the M3.4 session
 * summary's decision 2 settled on. `leaving` is local component state, never persisted
 * (mirrors the prototype's `s.leaving`) — see `CookingModeScreen`. */
function resolveScreen(
  model: CookingModel,
  session: CookingSession,
  now: number,
  leaving: boolean,
): ScreenResolution {
  const empty: ScreenResolution = { id: 'entry', currentNodeId: null, nextNodeId: null }
  const lc = lifecycle(model, session, now)
  if (lc === 'finished') return { ...empty, id: 'done' }
  if (lc === 'stale') return { ...empty, id: 'stale' }
  if (leaving) return { ...empty, id: 'leaving' }

  if (session.leftAt != null) {
    const h = handover(model, session, now)
    const nextId = h ? (h.consumer ?? h.producers[0]) : current(model, session)
    const last = sittingIndex(model, session)
    const next = nextId != null ? (model.sittingOf[nextId] ?? null) : null
    const crossed = model.sessions.length > 1 && next != null && last != null && next > last
    return { id: crossed ? 'sitting_resume' : 'returning', currentNodeId: null, nextNodeId: nextId }
  }

  const r = role(model, session, now)
  if (r === 'handover') return { ...empty, id: 'handover' }
  if (r === 'task') {
    const cur = current(model, session)
    if (cur == null) return { ...empty, id: 'wait' } // unreachable per select.ts's own contract; safe fallback
    return { id: model.nodes[cur].occupiesCook ? 'task' : 'handsoff_pending', currentNodeId: cur, nextNodeId: null }
  }
  return { ...empty, id: r }
}

/** `whisperFor` (dc.html), ported verbatim over the real `whisperInput`/`running`/
 * `holding` selectors — picks the soonest node worth naming that isn't the one already
 * on screen. */
function whisperFor(
  model: CookingModel,
  session: CookingSession,
  now: number,
  onScreenNodeId: string | null,
): string | null {
  const wi = whisperInput(model, session, now)
  const run = running(model, session)
  if (!wi) {
    const holdingIds = holding(model, session, now)
    if (holdingIds.length > 0) {
      return `${model.nodes[holdingIds[0]].label} is holding. Nothing needs you for it yet.`
    }
    return null
  }
  let id = wi.nodeId
  if (id === onScreenNodeId) {
    const others = run.filter((x) => x !== onScreenNodeId)
    if (others.length === 0) return null
    id = others[0]
  }
  const info = model.nodes[id]
  const rem = endsAtOf(session, id) - now
  if (rem <= 0) return `${info.label} is past its time and holding.`
  const tail = info.attention === 'periodic' ? ', so give it a stir when you pass.' : '.'
  return `${info.label} has about ${aboutMinutes(rem)} left${tail}`
}

export interface CookingViewOptions {
  recipeTitle: string
  leaving: boolean
}

/** The entry screen (`open()` -> no stored session): the one screen that quotes a
 * timing figure (M3.4 handoff §1/§5 — corrections table row 5). */
export function buildEntryView(model: CookingModel, recipeTitle: string, timing: HeaderTiming): CookingView {
  const degraded = model.warnings.includes('degraded')
  return {
    screenId: 'entry',
    shell: 'paper',
    topRecipe: '',
    showTopRight: false,
    label: null,
    title: recipeTitle,
    instr: timing.secondary ? `${timing.primary}. ${timing.secondary}.` : `${timing.primary}.`,
    qty: null,
    note: `${model.order.length} things to do${degraded ? ', and this one was read off a video, so the timings are rough.' : '.'}`,
    whisperText: null,
    showLink: false,
    primary: { label: 'Start cooking', solid: true, action: { kind: 'start' } },
    secondary: { label: 'See the plan', solid: false, action: { kind: 'seePlan' } },
  }
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
  const scr = resolveScreen(model, session, now, options.leaving)
  const v: CookingView = {
    screenId: scr.id,
    shell: 'paper',
    topRecipe: options.recipeTitle,
    showTopRight: true,
    label: null,
    title: '',
    instr: null,
    qty: null,
    note: null,
    whisperText: null,
    showLink: false,
    primary: null,
    secondary: null,
  }

  if (scr.id === 'task' || scr.id === 'handsoff_pending') {
    const cur = scr.currentNodeId!
    const n = model.nodes[cur]
    const c = splitCopy(n.instruction)
    v.label = n.label
    v.title = c.title
    v.instr = c.body
    v.qty = quantityLine(n, ingredients)
    v.note = n.donenessCue ? `${cap(n.donenessCue)}.` : null
    v.whisperText = whisperFor(model, session, now, cur)
    v.showLink = running(model, session).length > 0
    if (scr.id === 'task') {
      v.primary = { label: 'Done', solid: true, action: { kind: 'markDone', nodeId: cur } }
      if (skipAllowed(model, session)) {
        v.secondary = { label: 'Skip for now', solid: false, action: { kind: 'skip', nodeId: cur } }
      }
    } else {
      v.primary = { label: 'Started', solid: false, action: { kind: 'startNode', nodeId: cur } }
    }
    return v
  }

  if (scr.id === 'wait' || scr.id === 'long_wait') {
    const subject = waitSubject(model, session, now)
    const run = running(model, session)
    if (subject == null) {
      // No running node's own expiry would need the cook — every consumer is still
      // waiting on a sibling. Nothing to judge, so state the fact and offer nothing
      // (M3.4 session summary's "owner's eye wanted" call). Never fall back to naming
      // a node the selector did not choose.
      v.label = 'Nothing needs you'
      v.title = run.length > 1 ? `${cap(wordFor(run.length))} pans are running.` : 'One pan is running.'
      v.instr = run.length > 1 ? 'Nothing needs you until they are all done.' : 'Nothing needs you for it yet.'
      v.showLink = run.length > 0
      return v
    }
    const n = model.nodes[subject.nodeId]
    v.label = n.label
    if (n.donenessCue) {
      const c = splitCopy(`${cap(n.donenessCue)}.`)
      v.title = c.title
      v.instr = c.body
      v.primary = { label: "It's done", solid: false, action: { kind: 'markDone', nodeId: n.id } }
    } else {
      const c = splitCopy(n.instruction)
      v.title = c.title
      v.instr = c.body
    }
    if (scr.id === 'long_wait') v.note = `Ready around ${dayClock(now, endsAtOf(session, n.id))}.`
    v.secondary = { label: 'Give it longer', solid: false, action: { kind: 'extend', nodeId: n.id } }
    v.whisperText = whisperFor(model, session, now, n.id)
    v.showLink = run.length > 1
    return v
  }

  if (scr.id === 'handover') {
    const h = handover(model, session, now)!
    const p = model.nodes[h.producers[0]]
    v.shell = 'dark'
    v.label = p.label
    v.title =
      h.overrunMs >= 60_000
        ? `${cap(aboutMinutes(h.overrunMs))} past.`
        : `${p.label}${h.reason === 'must_attend' ? ' wants a look.' : ' is done.'}`
    v.instr =
      h.reason === 'consumer_ready' && h.consumer
        ? model.nodes[h.consumer].instruction
        : (p.donenessCue ? `${cap(p.donenessCue)}.` : p.instruction)
    v.primary =
      h.reason === 'must_attend'
        ? { label: "It's done", solid: false, action: { kind: 'acknowledge' } }
        : { label: 'On it', solid: true, action: { kind: 'acknowledge' } }
    v.secondary = { label: 'Needs a minute more', solid: false, action: { kind: 'extend', nodeId: h.producers[0] } }
    return v
  }

  if (scr.id === 'done') {
    v.topRecipe = ''
    v.showTopRight = false
    v.title = `${options.recipeTitle} is done.`
    v.instr = model.nodes[model.sinkId].instruction
    v.primary = { label: 'Finished cooking', solid: true, action: { kind: 'end' } }
    return v
  }

  // Away shell (field ground): leaving, returning, sitting_break, sitting_resume, stale.
  v.shell = 'field'
  v.showTopRight = false
  const run = running(model, session)
  const withEnd = (id: string) => `${model.nodes[id].label}, around ${dayClock(now, endsAtOf(session, id))}`

  if (scr.id === 'leaving') {
    v.label = 'Leaving'
    v.title =
      run.length === 0
        ? 'Nothing is on the heat.'
        : run.length === 1
          ? 'One thing is still on.'
          : `${cap(wordFor(run.length))} things are still on.`
    v.instr = 'Timers keep their own time whether the app is open or not.'
    v.note = run.length > 0 ? `${run.map(withEnd).join(' · ')}.` : null
    v.primary = { label: 'Back to cooking', solid: true, action: { kind: 'stay' } }
    v.secondary = { label: 'End the cook and clear the timers', solid: false, action: { kind: 'end' } }
  } else if (scr.id === 'returning') {
    v.label = 'Away'
    v.title = `You left about ${aboutMinutes(now - (session.leftAt ?? now))} ago.`
    v.instr = handover(model, session, now) != null ? 'Something is ready and waiting for you.' : 'Everything kept its own time.'
    v.note = run.length > 0 ? `${run.map(withEnd).join(' · ')}.` : null
    v.primary = { label: 'Back to cooking', solid: true, action: { kind: 'resume' } }
    v.secondary = { label: 'End the cook and clear the timers', solid: false, action: { kind: 'end' } }
  } else if (scr.id === 'sitting_resume') {
    const n = scr.nextNodeId ? model.nodes[scr.nextNodeId] : null
    v.label = 'Between sittings'
    v.title = 'Ready when you are.'
    v.instr = n ? n.instruction : 'Pick up where you left off.'
    v.primary = { label: 'Back to cooking', solid: true, action: { kind: 'resume' } }
  } else if (scr.id === 'sitting_break') {
    const next = nextRequiredAt(model, session)
    const host = run.length > 0 ? model.nodes[run[0]] : null
    v.label = 'Nothing to do'
    v.title = next != null ? `Nothing until ${dayClock(now, next)}.` : 'Nothing to do for now.'
    v.instr = host ? host.instruction : null
    v.note = 'Nothing here needs you before then.'
    v.showTopRight = true
  } else if (scr.id === 'stale') {
    v.label = 'Found a session'
    v.title = `You started this ${aboutMinutes(now - session.startedAt)} ago.`
    v.instr = 'Every timer here is long past.'
    v.primary = { label: 'Continue', solid: true, action: { kind: 'touch' } }
    v.secondary = { label: 'Start again', solid: false, action: { kind: 'end' } }
  }

  return v
}

/** `applySheet` (dc.html), ported: the read-only "What's cooking" overlay, over
 * `sheetOrder`/`requiredIfExpired` — never advances the cook, never reorders. */
export function buildSheetView(model: CookingModel, session: CookingSession, now: number): SheetView {
  const ids = sheetOrder(model, session, now)
  const req = ids.length > 0 && requiredIfExpired(model, session, now, ids[0])
  const rows: SheetRowView[] = ids.map((id, i) => ({
    nodeId: id,
    label: model.nodes[id].label,
    cue: model.nodes[id].donenessCue ? cap(model.nodes[id].donenessCue) : '',
    time: sheetTime(model, session, now, id),
    dot: i === 0 && req,
  }))
  const note = ids.length === 0 ? 'Nothing is cooking.' : req ? 'The marked one will want you first.' : 'Nothing here needs you yet.'
  const nextHands = model.order.find((id) => model.nodes[id].occupiesCook && session.nodes[id].state !== 'done')
  const next = nextHands ? `Next in your hands: ${model.nodes[nextHands].label}.` : null
  return { rows, note, next }
}

// ---------------------------------------------------------------------------
// Conflict — CP1a (M3.4.5 session-lockout plan). Built from a `SessionConflict`
// (`@/cooking/types`), not a `(model, session)` pair — see the file-top comment.
// ---------------------------------------------------------------------------

export type ConflictActionKind = 'goTo' | 'endAndStart' | 'close'

export interface ConflictAction {
  kind: ConflictActionKind
  label: string
}

export interface ConflictViewModel {
  planKey: string
  title: string | null
  state: SessionConflict['state']
  /** One line naming the other cook and, where known, its state — never a bare
   * "Already cooking" once a title is available (plan decision 1: "clearly identify the
   * other recipe when possible"). */
  message: string
  /**
   * Ordered `goTo?, endAndStart, close` (plan decision 1: "allow 'Go to <recipe>' when
   * that recipe can be resolved... allow 'End it and start this'... retain 'Close'").
   * `goTo` is present only when `canGoTo(planKey)` says so; `endAndStart`/`close` are
   * unconditional. `CookingModeScreen` (CP1b) wires each `kind` to real behavior —
   * `goTo` to `App.tsx`'s navigation, `endAndStart` to `session.end()`, `close` to
   * `onExit` — this module only decides which actions apply and how they read.
   */
  actions: ConflictAction[]
}

/**
 * Whether a `planKey` is offered as a "Go to" destination (CP1a's shape, CP1b's real
 * check). Defaults to `resolveConflictTarget`'s prefix rule presuming every `library:`
 * id still exists — `server:`/`library:` addressable, `import:` never (an unsaved
 * import has no address to return to once superseded — M3.4 CP2 investigation §1: a
 * fresh import's `graph.id` is a random UUID nothing else is keyed to). The real,
 * App-wired check (`CookingModeScreen` passing a predicate backed by the actual
 * `Library`) additionally hides `library:` when that specific entry no longer exists —
 * `buildConflictView`'s own `canGoTo` parameter, below, is how CP1b overrides this
 * default without `viewModel.ts` needing to know about the library at all.
 */
function defaultCanGoTo(planKey: string): boolean {
  return canResolveConflictTarget(planKey, () => true)
}

const CONFLICT_MESSAGE: Record<SessionConflict['state'], (title: string) => string> = {
  active: (title) => `${title} is still cooking.`,
  finished: (title) => `You already finished cooking ${title}.`,
  stale: (title) => `${title} was left a while ago.`,
  unknown: (title) => `${title} may still be cooking.`,
}

/**
 * `buildConflictView` (CP1a, `canGoTo` added CP1b): the conflict screen's copy and
 * action list, from the `SessionConflict` `engine.open()` reports. Never silently drops
 * the conflict (plan decision 2) — `endAndStart`/`close` are always present regardless
 * of `state`. `canGoTo` defaults to the prefix-only rule (every CP1a call site, and
 * every test that doesn't care about library existence, keeps working unchanged); the
 * real caller (`CookingModeScreen`) passes one backed by the actual `Library`.
 */
export function buildConflictView(conflict: SessionConflict, canGoTo: (planKey: string) => boolean = defaultCanGoTo): ConflictViewModel {
  const message =
    conflict.title != null ? CONFLICT_MESSAGE[conflict.state](conflict.title) : 'Another cook is already on.'

  const actions: ConflictAction[] = []
  if (canGoTo(conflict.planKey)) {
    actions.push({ kind: 'goTo', label: `Go to ${conflict.title ?? 'that recipe'}` })
  }
  actions.push({ kind: 'endAndStart', label: 'End it and start this' })
  actions.push({ kind: 'close', label: 'Close' })

  return { planKey: conflict.planKey, title: conflict.title, state: conflict.state, message, actions }
}
