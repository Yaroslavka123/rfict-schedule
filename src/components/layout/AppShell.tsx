import { BarChart3, CalendarDays, DoorOpen, GraduationCap, Moon, Sun } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type AppTab = 'schedule' | 'rooms' | 'teachers' | 'analytics'

interface AppShellProps {
  activeTab: AppTab
  onTabChange: (tab: AppTab) => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  children: ReactNode
}

const tabs = [
  { id: 'schedule' as const, label: 'Расписание', icon: CalendarDays },
  { id: 'rooms' as const, label: 'Кабинеты', icon: DoorOpen },
  { id: 'teachers' as const, label: 'Преподаватели', icon: GraduationCap },
  { id: 'analytics' as const, label: 'Аналитика', icon: BarChart3 },
]

export function AppShell({ activeTab, onTabChange, theme, onToggleTheme, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="fixed inset-0 -z-10 bg-page-gradient" />
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-4 py-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-glow">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">РФиКТ БГУ</p>
              <h1 className="text-lg font-bold tracking-tight md:text-2xl">Умное расписание</h1>
            </div>
          </div>
          <Button variant="secondary" onClick={onToggleTheme} aria-label="Переключить тему">
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            <span className="hidden sm:inline">{theme === 'dark' ? 'Светлая' : 'Тёмная'}</span>
          </Button>
        </div>
      </header>

      <div className="mx-auto grid max-w-screen-2xl gap-5 px-4 py-5 md:grid-cols-sidebar md:px-6">
        <aside className="md:sticky md:top-24 md:h-fit">
          <nav className="grid grid-cols-2 gap-2 rounded-2xl border border-border bg-card p-2 shadow-card md:grid-cols-1">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition',
                    activeTab === tab.id ? 'bg-primary text-primary-foreground shadow-glow' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                  onClick={() => onTabChange(tab.id)}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              )
            })}
          </nav>
        </aside>
        <main className="min-w-0 space-y-5">{children}</main>
      </div>
    </div>
  )
}
