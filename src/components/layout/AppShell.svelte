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
      title: 'Занятость кабинетов',
      description: 'Свободные и занятые аудитории по дням, парам и типам занятий.',
      icon: DoorOpen,
    },
    {
      id: 'teachers' as const,
      label: 'Преподаватели',
      title: 'Занятость преподавателей',
      description: 'Нагрузка преподавателей по неделе с быстрым поиском и подсветкой совпадений.',
      icon: GraduationCap,
    },
    {
      id: 'analytics' as const,
      label: 'План-факт',
      title: 'План-факт по занятиям',
      description: 'Сравнение запланированных, поставленных в расписание и уже проведенных пар.',
      icon: BarChart3,
    },
    {
      id: 'schedule' as const,
      label: 'Расписание',
      title: 'Расписание недели',
      description: 'Список занятий по дням с группами, аудиториями, периодами и ссылками на источник.',
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

  let activeTabConfig = $derived(tabs.find((tab) => tab.id === activeTab) ?? tabs[0])
</script>

<div class="app-shell" style="--header-h: 8.5rem;">
  <header class="app-header">
    <div class="header-inner">
      <div class="header-top">
        <div class="brand-mark">
          <CalendarDays class="h-5 w-5" />
        </div>
        <div class="header-meta">
          <p class="section-eyebrow">РФиКТ БГУ</p>
          <div>
            <h1 class="header-title">{activeTabConfig.title}</h1>
            <p class="header-description">{activeTabConfig.description}</p>
          </div>
        </div>

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

      <div class="flex flex-col gap-3 2xl:flex-row 2xl:items-start">
        <nav class="app-tabs" aria-label="Разделы расписания">
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

        <div class="header-controls flex-1">
          {@render controls?.()}
        </div>
      </div>
    </div>
  </header>

  <main class="w-full px-3 py-4 md:px-5">
    {@render children?.()}
  </main>
</div>
