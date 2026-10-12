import type { ComponentType, SVGProps } from 'react'

import { BookIcon, CalendarIcon, HomeIcon } from '@/home/icons'

export type Tab = 'home' | 'cookbook' | 'planner'

const TABS: { id: Tab; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { id: 'home', label: 'Home', Icon: HomeIcon },
  { id: 'cookbook', label: 'Cookbook', Icon: BookIcon },
  { id: 'planner', label: 'Planner', Icon: CalendarIcon },
]

/** The floating three-tab nav (Home register): a pill 20px in from each side, three
 * equal tabs, a peach pill under the active one. The only shadow on Home. */
export function BottomNav({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav
      aria-label="Main"
      className="absolute inset-x-5 bottom-5 z-10 flex h-16 items-center gap-0 rounded-full border border-home-rule bg-home-surface p-1.5 shadow-home-nav"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map(({ id, label, Icon }) => {
        const active = id === tab
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-current={active ? 'page' : undefined}
            className={`flex h-[50px] flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[12px] font-semibold ${
              active ? 'bg-home-peach text-home-terracotta-text' : 'text-home-ink-2'
            }`}
          >
            <Icon className="text-[22px]" />
            {label}
          </button>
        )
      })}
    </nav>
  )
}
