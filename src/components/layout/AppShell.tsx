import { BarChart3, CalendarDays, Database, DoorOpen, Github, GraduationCap, HardDrive, Moon, RefreshCw, Sun } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn, formatUpdatedAt } from '@/lib/utils'
import type { DataSource } from '@/types/schedule'

export type AppTab = 'schedule' | 'rooms' | 'teachers' | 'analytics'

interface AppShellProps {
  activeTab: AppTab
  onTabChange: (tab: AppTab) => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onRefresh: () => void
  refreshing: boolean
  source: DataSource | null
  loadedAt: number
  children: ReactNode
}

const tabs = [
  { id: 'schedule' as const, label: 'Расписание', icon: CalendarDays },
  { id: 'rooms' as const, label: 'Кабинеты', icon: DoorOpen },
  { id: 'teachers' as const, label: 'Преподаватели', icon: GraduationCap },
  { id: 'analytics' as const, label: 'План-факт', icon: BarChart3 },
]

const sourceLabels: Record<DataSource, { label: string; tone: string; Icon: typeof Database }> = {
  backend: { label: 'Backend', tone: 'text-emerald-500', Icon: Database },
  github: { label: 'GitHub raw', tone: 'text-sky-500', Icon: Github },
  local: { label: 'Локально', tone: 'text-muted-foreground', Icon: HardDrive },
}

export function AppShell({ activeTab, onTabChange, theme, onToggleTheme, onRefresh, refreshing, source, loadedAt, children }: AppShellProps) {
  const sourceInfo = source ? sourceLabels[source] : null
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
              {sourceInfo && (
                <span className="hidden items-center gap-1.5 rounded-full border border-border bg-background/60 px-3 py-1 text-xs font-semibold sm:inline-flex">
                  <sourceInfo.Icon className={cn('h-3.5 w-3.5', sourceInfo.tone)} />
                  <span className="text-muted-foreground">{sourceInfo.label}</span>
                  {loadedAt > 0 && <span className="text-muted-foreground">· {formatUpdatedAt(new Date(loadedAt).toISOString())}</span>}
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
