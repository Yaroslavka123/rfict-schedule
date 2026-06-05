<script module lang="ts">
  export interface FilterSelectOption {
    value: string
    label: string
  }
</script>

<script lang="ts">
  import { Check, ChevronDown } from '@lucide/svelte'
  import { onMount } from 'svelte'

  import { cn } from '@/lib/utils'

  interface FilterSelectProps {
    value: string
    options: FilterSelectOption[]
    ariaLabel: string
    class?: string
    onChange: (value: string) => void
  }

  let { value, options, ariaLabel, class: className = '', onChange }: FilterSelectProps = $props()
  let open = $state(false)
  let root: HTMLDivElement
  let selected = $derived(options.find((option) => option.value === value) || options[0])

  onMount(() => {
    const closeFromOutside = (event: PointerEvent) => {
      if (!root?.contains(event.target as Node)) open = false
    }
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') open = false
    }
    document.addEventListener('pointerdown', closeFromOutside, { passive: true })
    document.addEventListener('keydown', closeFromEscape)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside)
      document.removeEventListener('keydown', closeFromEscape)
    }
  })

  function choose(next: string) {
    if (next !== value) onChange(next)
    open = false
  }
</script>

<div class={cn('filter-select-custom', open && 'filter-select-open', className)} bind:this={root}>
  <button
    type="button"
    class="filter-select-trigger"
    aria-label={ariaLabel}
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <span class="filter-select-value">{selected?.label || ariaLabel}</span>
    <ChevronDown class="filter-select-chevron h-4 w-4" />
  </button>

  {#if open}
    <div class="filter-select-menu" role="listbox" aria-label={ariaLabel}>
      {#each options as option (option.value)}
        {@const active = option.value === value}
        <button
          type="button"
          class={cn('filter-select-option', active && 'filter-select-option-active')}
          role="option"
          aria-selected={active}
          onclick={() => choose(option.value)}
        >
          <span class="filter-select-option-label">{option.label}</span>
          {#if active}
            <Check class="h-3.5 w-3.5" />
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
