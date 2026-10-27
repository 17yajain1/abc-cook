import { useState, useSyncExternalStore } from 'react'

import type { RecipePlanResponse } from '@abc-cook/schema'

import type { SessionStore } from '@/cooking/store'
import type { Library } from '@/library/store'
import { selectContinue } from '@/home/continueCooking'
import { DiscoverScreen } from '@/feed/DiscoverScreen'
import { DiscoverSection } from '@/feed/DiscoverSection'
import { useFeed } from '@/feed/useFeed'
import { CopySheet } from '@/home/CopySheet'
import { HomeScreen } from '@/home/HomeScreen'
import { useClipboardUrl } from '@/home/useClipboardUrl'
import { ImportProgress, isProgressPhase } from '@/import/ImportProgress'
import type { ImportHandlers } from '@/import/handOff'
import { useImportJob } from '@/import/useImportJob'
import { PlannerScreen } from '@/planner/PlannerScreen'
import { LibraryScreen } from '@/library/LibraryScreen'

import { BottomNav, type Tab } from './BottomNav'
import { devToolsEnabled, feedEnabled } from './flags'
import { useHomeSurface } from './useHomeSurface'

/** Remembered across the shell unmounting (opening a plan replaces it), so leaving a plan
 * returns to the tab the person was on. */
let lastTab: Tab = 'home'

/** The tab the shell opens on its next mount (R5: Remove lands on the Cookbook). */
export function rememberTab(tab: Tab): void {
  lastTab = tab
}

/**
 * The browsing shell: three tabs under a floating nav. `App` swaps the whole shell out for
 * a plan, an import or Cooking mode, so everything here is a browsing screen held for
 * seconds (docs/DESIGN_SYSTEM.md § Register: Home and browse screens).
 */
export function AppShell({
  library,
  sessionStore,
  onResume,
  onOpenSaved,
  onPick,
  onImport,
  importHandlers,
  onOpenFeedRecipe,
}: {
  library: Library
  sessionStore: SessionStore
  /** Reuses `App`'s `goToConflict`: resolves `library:`/`server:` plan keys. */
  onResume: (planKey: string) => void
  onOpenSaved: (id: string, opts?: { alreadySaved?: boolean }) => void
  onPick: (recipeId: string) => void
  onImport: () => void
  importHandlers: ImportHandlers
  onOpenFeedRecipe: (payload: RecipePlanResponse) => void
}) {
  const [tab, setTabState] = useState<Tab>(lastTab)
  const [seeAll, setSeeAll] = useState(false)
  const setTab = (next: Tab) => {
    lastTab = next
    setSeeAll(false)
    setTabState(next)
  }

  // The shell owns the import job so the Copy sheet can start one. Submissions come from
  // click handlers only — a mount effect would double-fire under StrictMode.
  const session = useSyncExternalStore(sessionStore.subscribe, sessionStore.getState)
  const nowMs = Date.now()
  const continueInfo = selectContinue(session, nowMs, library.get)
  const job = useImportJob(importHandlers, {
    findSaved: (key) => library.findBySource(key),
    // A pasted link the person already saved opens that entry; nothing is fetched or spent.
    onDuplicate: (saved) => {
      setSheetOpen(false)
      onOpenSaved(saved.id, { alreadySaved: true })
    },
  })
  const clipboard = useClipboardUrl()
  const [sheetOpen, setSheetOpen] = useState(false)
  // Null with the flag off: nothing loads, and the section is not rendered at all.
  const feed = useFeed(feedEnabled(), library, onOpenFeedRecipe)

  const openSheet = () => {
    // A failed attempt's message does not outlive the sheet.
    job.clearError()
    setSheetOpen(true)
    void clipboard.checkOnOpen()
  }
  const cancelImport = () => {
    job.reset()
    setSheetOpen(false)
  }

  // Which register owns the page behind the app: Home and Planner paint the Home ground on
  // the root (so the safe-area strip and over-scroll match); Cookbook (Plan register) and the
  // import-progress screens keep the Plan paper. Cleared when the shell unmounts for a plan.
  const progress = isProgressPhase(job.phase)
  useHomeSurface(!progress && tab !== 'cookbook')

  if (progress) return <ImportProgress job={job} onCancel={cancelImport} />

  return (
    <div data-testid="app-shell" className="relative h-full overflow-hidden bg-home-ground text-home-ink">
      {tab === 'home' && seeAll && feed && <DiscoverScreen feed={feed} onBack={() => setSeeAll(false)} />}
      {tab === 'home' && !(seeAll && feed) && <HomeScreen
          recipes={library.list()}
          continueInfo={continueInfo}
          onResume={onResume}
          onOpenCopy={openSheet}
          onOpenCookbook={() => setTab('cookbook')}
          onOpenPlanner={() => setTab('planner')}
          discover={feed && <DiscoverSection feed={feed} onSeeAll={() => setSeeAll(true)} />}
        />}
      {tab === 'cookbook' && (
        <LibraryScreen
          savedRecipes={library.list()}
          session={session}
          now={nowMs}
          onOpenSaved={onOpenSaved}
          onPick={onPick}
          onImport={onImport}
          showSamples={devToolsEnabled()}
          bottomInset
        />
      )}
      {tab === 'planner' && <PlannerScreen />}
      <BottomNav tab={tab} onChange={setTab} />
      {sheetOpen && (
        <CopySheet
          url={job.url}
          onUrlChange={job.setUrl}
          clipboardUrl={clipboard.clipboardUrl}
          phase={job.phase}
          onSubmit={(url) => {
            job.setUrl(url)
            job.submit(url)
          }}
          onPasteTap={clipboard.readOnPasteTap}
          onPasteText={() => job.setPhase({ kind: 'paste', error: null })}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  )
}
