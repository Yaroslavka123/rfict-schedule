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
        <div className="mx-auto flex max-w-screen-2xl items-center gap-3 px-3 py-1.5 md:px-5">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <CalendarDays className="h-4 w-4" />
            </div>
            <div className="hidden sm:block">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground leading-none">РФиКТ БГУ</p>
              <h1 className="text-xs font-bold leading-tight tracking-tight md:text-sm">Расписание</h1>
            </div>
          </div>
          <nav className="flex flex-1 gap-0.5 overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={cn(
                    'inline-flex items-center gap-1 whitespace-nowrap rounded-md border-b-2 px-2 py-1 text-xs font-semibold transition',
                    activeTab === tab.id
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => onTabChange(tab.id)}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              )
            })}
          </nav>
          <div className="flex items-center gap-1">
            {loadedAt > 0 && (
              <span className="hidden text-[10px] text-muted-foreground lg:inline">
                {formatUpdatedAt(new Date(loadedAt).toISOString())}
              </span>
            )}
            <Button
              variant="secondary"
              className="h-7 px-2 text-xs"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Обновить"
              title="Перезагрузить данные"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            </Button>
            <Button
              variant="secondary"
              className="h-7 px-2 text-xs"
              onClick={onToggleTheme}
              aria-label="Переключить тему"
              title="Сменить тему"
            >
              {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-screen-2xl px-3 py-3 md:px-5">{children}</main>
    </div>
  )
}
