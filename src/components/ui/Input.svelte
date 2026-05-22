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
    'h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20',
    className,
  )}
/>
