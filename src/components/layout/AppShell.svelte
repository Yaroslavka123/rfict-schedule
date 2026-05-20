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
    children?: Snippet
  }

  const tabs = [
    { id: 'rooms' as const, label: 'Кабинеты', icon: DoorOpen },
    { id: 'teachers' as const, label: 'Преподаватели', icon: GraduationCap },
    { id: 'analytics' as const, label: 'План-факт', icon: BarChart3 },
    { id: 'schedule' as const, label: 'Расписание', icon: CalendarDays },
  ]

  let {
    activeTab,
    onTabChange,
    theme,
    onToggleTheme,
    onRefresh,
    refreshing,
    loadedAt,
    children,
  }: AppShellProps = $props()
</script>

<div class="min-h-screen bg-background text-foreground" style="--header-h: 3rem;">
  <header class="sticky top-0 z-40 h-12 border-b border-border bg-card/95 backdrop-blur-xl">
    <div class="flex h-full w-full items-center gap-3 px-3 md:px-5">
      <div class="flex items-center gap-2">
        <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <CalendarDays class="h-4 w-4" />
        </div>
        <div class="hidden sm:block">
          <p class="text-[9px] font-semibold uppercase tracking-widest leading-none text-muted-foreground">
            РФиКТ БГУ
          </p>
          <h1 class="text-xs font-bold leading-tight tracking-tight md:text-sm">Расписание</h1>
        </div>
      </div>

      <nav class="flex flex-1 gap-0.5 overflow-x-auto">
        {#each tabs as tab (tab.id)}
          {@const Icon = tab.icon}
          <button
            type="button"
            class={cn(
              'group relative inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold transition-all duration-300 ease-out',
              activeTab === tab.id
                ? 'scale-[1.02] bg-primary/10 text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
            onclick={() => onTabChange(tab.id)}
          >
            <Icon
              class={cn(
                'h-3.5 w-3.5 transition-transform duration-300 ease-out',
                activeTab === tab.id ? 'scale-110 text-primary' : '',
              )}
            />
            {tab.label}
            <span
              aria-hidden="true"
              class={cn(
                'absolute inset-x-1 -bottom-0.5 h-0.5 rounded-full bg-primary transition-all duration-300 ease-out',
                activeTab === tab.id ? 'scale-x-100 opacity-100' : 'scale-x-0 opacity-0',
              )}
            ></span>
          </button>
        {/each}
      </nav>

      <div class="flex items-center gap-1">
        {#if loadedAt > 0}
          <span class="hidden text-[10px] text-muted-foreground lg:inline">
            {formatUpdatedAt(new Date(loadedAt).toISOString())}
          </span>
        {/if}
        <Button
          variant="secondary"
          class="h-7 px-2 text-xs"
          onclick={onRefresh}
          disabled={refreshing}
          aria-label="Обновить"
          title="Перезагрузить данные"
        >
          <RefreshCw class={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
        </Button>
        <Button
          variant="secondary"
          class="h-7 px-2 text-xs"
          onclick={onToggleTheme}
          aria-label="Переключить тему"
          title="Сменить тему"
        >
          {#if theme === 'dark'}
            <Sun class="h-3.5 w-3.5" />
          {:else}
            <Moon class="h-3.5 w-3.5" />
          {/if}
        </Button>
      </div>
    </div>
  </header>

  <main class="w-full px-3 py-3 md:px-5">
    {@render children?.()}
  </main>
</div>
