import { webCookingSignals, type WebCookingSignals } from './cookingSignals'

/**
 * PR 2 CP4: the app's one `cookingSignals`, created once when this module loads. `App.tsx`
 * reaches it at startup (through `timerEndSignals.ts`), so its tap listeners are already on
 * `document` when Start cooking or Home's Resume is tapped: that tap unlocks the audio.
 * Under the node test environment there is no `document` or `AudioContext`, so it does nothing.
 */
export const cookingSignals: WebCookingSignals = webCookingSignals()
