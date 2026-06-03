<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'

  import { cn } from '@/lib/utils'

  interface InputProps extends HTMLInputAttributes {
    value?: string | number | null
  }

  let {
    class: className = '',
    type = 'text',
    value = $bindable(''),
    ...rest
  }: InputProps = $props()
</script>

<input
  {...rest}
  {type}
  bind:value
  class={cn(
    'h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none',
    'transition duration-200 ease-out placeholder:text-muted-foreground',
    'hover:border-muted-foreground/55 focus:border-primary focus:ring-2 focus:ring-primary/20 focus:shadow-[0_0_0_4px_hsl(var(--primary)/0.08)]',
    className,
  )}
/>
