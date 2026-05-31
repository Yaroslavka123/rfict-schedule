<script module lang="ts">
  export type AppTab = 'schedule' | 'rooms' | 'teachers' | 'analytics'
</script>

<script lang="ts">
  import {
    BarChart3,
    CalendarDays,
    DoorOpen,
    GraduationCap,
    Moon,
    RefreshCw,
    Sun,
  } from '@lucide/svelte'
  import type { Snippet } from 'svelte'

  import Button from '@/components/ui/Button.svelte'
  import { cn, formatUpdatedAt } from '@/lib/utils'

  interface AppShellProps {
    activeTab: AppTab
    onTabChange: (tab: AppTab) => void
    theme: 'dark' | 'light'
    onToggleTheme: () => void
    onRefresh: () => void
    refreshing: boolean
    loadedAt: number
    controls?: Snippet
    children?: Snippet
  }

  const tabs = [
    {
      id: 'rooms' as const,
      label: 'Кабинеты',
      icon: DoorOpen,
    },
    {
      id: 'teachers' as const,
      label: 'Преподаватели',
      icon: GraduationCap,
    },
    {
      id: 'analytics' as const,
      label: 'План-факт',
      icon: BarChart3,
    },
    {
      id: 'schedule' as const,
      label: 'Расписание',
      icon: CalendarDays,
    },
  ]

  let {
    activeTab,
    onTabChange,
    theme,
    onToggleTheme,
    onRefresh,
    refreshing,
    loadedAt,
    controls,
    children,
  }: AppShellProps = $props()

</script>

<div class="app-shell" style="--header-h: 6.5rem;">
  <header class="app-header">
    <div class="header-inner">
      <div class="header-top compact-header">
        <div class="brand-mark brand-mark-compact">
          <CalendarDays class="h-5 w-5" />
        </div>
        <div class="header-meta">
          <h1 class="header-title">РФиКТ</h1>
        </div>

        <nav class="app-tabs compact-tabs" aria-label="Разделы расписания">
          {#each tabs as tab (tab.id)}
            {@const Icon = tab.icon}
            <button
              type="button"
              class={cn('app-tab', activeTab === tab.id ? 'app-tab-active' : 'app-tab-idle')}
              onclick={() => onTabChange(tab.id)}
              aria-current={activeTab === tab.id ? 'page' : undefined}
            >
              <Icon class={cn('h-4 w-4', activeTab === tab.id && 'text-primary')} />
              {tab.label}
            </button>
          {/each}
        </nav>

        <div class="header-actions">
          {#if loadedAt > 0}
            <span class="hidden rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground lg:inline-flex">
              {formatUpdatedAt(new Date(loadedAt).toISOString())}
            </span>
          {/if}
          <Button
            variant="secondary"
            class="h-9 px-3"
            onclick={onRefresh}
            disabled={refreshing}
            aria-label="Обновить"
            title="Обновить данные"
          >
            <RefreshCw class={cn('h-4 w-4', refreshing && 'animate-spin')} />
            <span class="hidden sm:inline">Обновить</span>
          </Button>
          <Button
            variant="secondary"
            class="h-9 px-3"
            onclick={onToggleTheme}
            aria-label="Переключить тему"
            title="Сменить тему"
          >
            {#if theme === 'dark'}
              <Sun class="h-4 w-4" />
            {:else}
              <Moon class="h-4 w-4" />
            {/if}
            <span class="hidden sm:inline">Тема</span>
          </Button>
        </div>
      </div>

      <div class="header-controls flex-1">
        {@render controls?.()}
      </div>
    </div>
  </header>

  <main class="w-full px-3 py-4 md:px-5">
    {@render children?.()}
  </main>
</div>
