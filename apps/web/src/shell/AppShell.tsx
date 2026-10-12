import { useState } from 'react'

import type { ImportMeta, RecipePlanResponse } from '@abc-cook/schema'

import type { Library } from '@/library/store'
import { CopySheet } from '@/home/CopySheet'
import { HomeScreen } from '@/home/HomeScreen'
import { useClipboardUrl } from '@/home/useClipboardUrl'
import { ImportProgress, isProgressPhase } from '@/import/ImportScreen'
import { useImportJob } from '@/import/useImportJob'
import type { MapLayout } from '@/map/layout'
import type { RenderPlan } from '@/plan/derive'
import { LibraryScreen } from '@/library/LibraryScreen'

import { BottomNav, type Tab } from './BottomNav'
import { devToolsEnabled } from './flags'

/** Remembered across the shell unmounting (opening a plan replaces it), so leaving a plan
 * returns to the tab the person was on. */
let lastTab: Tab = 'home'

/**
 * The browsing shell: three tabs under a floating nav. `App` swaps the whole shell out for
 * a plan, an import or Cooking mode, so everything here is a browsing screen held for
 * seconds (docs/DESIGN_SYSTEM.md § Register: Home and browse screens).
 */
export function AppShell({
  library,
  onOpenSaved,
  onPick,
  onImport,
  onImported,
}: {
  library: Library
  onOpenSaved: (id: string) => void
  onPick: (recipeId: string) => void
  onImport: () => void
  onImported: (
    plan: RenderPlan,
    map: MapLayout,
    payload: RecipePlanResponse,
    importMeta: ImportMeta,
  ) => void
}) {
  const [tab, setTabState] = useState<Tab>(lastTab)
  const setTab = (next: Tab) => {
    lastTab = next
    setTabState(next)
  }

  // The shell owns the import job so the Copy sheet can start one. Submissions come from
  // click handlers only — a mount effect would double-fire under StrictMode.
  const job = useImportJob(onImported)
  const clipboard = useClipboardUrl()
  const [sheetOpen, setSheetOpen] = useState(false)

  const openSheet = () => {
    setSheetOpen(true)
    void clipboard.checkOnOpen()
  }
  const cancelImport = () => {
    job.reset()
    setSheetOpen(false)
  }

  if (isProgressPhase(job.phase)) return <ImportProgress job={job} onCancel={cancelImport} />

  return (
    <div data-testid="app-shell" className="relative h-full overflow-hidden bg-home-ground text-home-ink">
      {tab === 'home' && <HomeScreen onOpenCopy={openSheet} />}
      {tab === 'cookbook' && (
        <LibraryScreen
          savedRecipes={library.list()}
          onOpenSaved={onOpenSaved}
          onPick={onPick}
          onImport={onImport}
          showSamples={devToolsEnabled()}
          bottomInset
        />
      )}
      {tab === 'planner' && (
        <div className="px-5 pt-16 text-[15px] text-home-ink-2">Planner is coming soon.</div>
      )}
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
          onKeepWaiting={job.keepWaiting}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  )
}
