<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  import { cn } from '@/lib/utils'

  interface CardProps extends HTMLAttributes<HTMLDivElement> {
    header?: Snippet
    children?: Snippet
    contentClass?: string
  }

  let { class: className = '', contentClass = 'p-5', header, children, ...rest }: CardProps = $props()
</script>

<div
  {...rest}
  class={cn(
    'rounded-lg border border-border bg-card text-card-foreground shadow-card animate-fade-in',
    'transition duration-300 ease-spring',
    'hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-glow',
    className,
  )}
>
  {#if header}
    <div class="border-b border-border p-5">
      {@render header()}
    </div>
  {/if}
  <div class={contentClass}>
    {@render children?.()}
  </div>
</div>
