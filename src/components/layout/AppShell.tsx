import { BarChart3, CalendarDays, DoorOpen, GraduationCap, Moon, RefreshCw, Sun } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn, formatUpdatedAt } from '@/lib/utils'

export type AppTab = 'schedule' | 'rooms' | 'teachers' | 'analytics'

interface AppShellProps {
  activeTab: AppTab
  onTabChange: (tab: AppTab) => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onRefresh: () => void
  refreshing: boolean
  loadedAt: number
  children: ReactNode
}

const tabs = [
  { id: 'schedule' as const, label: 'Расписание', icon: CalendarDays },
  { id: 'rooms' as const, label: 'Кабинеты', icon: DoorOpen },
  { id: 'teachers' as const, label: 'Преподаватели', icon: GraduationCap },
  { id: 'analytics' as const, label: 'План-факт', icon: BarChart3 },
]

export function AppShell({ activeTab, onTabChange, theme, onToggleTheme, onRefresh, refreshing, loadedAt, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-screen-2xl flex-col gap-3 px-4 py-3 md:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <CalendarDays className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">РФиКТ БГУ</p>
                <h1 className="text-base font-bold tracking-tight md:text-lg">Расписание занятий</h1>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {loadedAt > 0 && (
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  Обновлено {formatUpdatedAt(new Date(loadedAt).toISOString())}
                </span>
              )}
              <Button variant="secondary" onClick={onRefresh} disabled={refreshing} aria-label="Обновить" title="Перезагрузить данные">
                <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
                <span className="hidden sm:inline">Обновить</span>
              </Button>
              <Button variant="secondary" onClick={onToggleTheme} aria-label="Переключить тему" title="Сменить тему">
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-b border-border -mb-px">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={cn(
                    'inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition',
                    activeTab === tab.id
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => onTabChange(tab.id)}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              )
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-screen-2xl space-y-4 px-3 py-4 md:px-6">{children}</main>
    </div>
  )
}
