import { useState } from 'react'

import type { Library } from '@/library/store'
import { HomeScreen } from '@/home/HomeScreen'
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
}: {
  library: Library
  onOpenSaved: (id: string) => void
  onPick: (recipeId: string) => void
  onImport: () => void
}) {
  const [tab, setTabState] = useState<Tab>(lastTab)
  const setTab = (next: Tab) => {
    lastTab = next
    setTabState(next)
  }

  return (
    <div data-testid="app-shell" className="relative h-full overflow-hidden bg-home-ground text-home-ink">
      {tab === 'home' && <HomeScreen onImport={onImport} />}
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
    </div>
  )
}
