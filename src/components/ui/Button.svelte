<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  import { cn } from '@/lib/utils'

  type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

  interface ButtonProps extends HTMLButtonAttributes {
    variant?: ButtonVariant
    children?: Snippet
  }

  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-primary text-primary-foreground shadow-glow hover:opacity-90',
    secondary: 'border border-border bg-card text-card-foreground hover:bg-muted',
    ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
    danger: 'bg-destructive text-white hover:opacity-90',
  }

  let { variant = 'primary', class: className = '', type = 'button', children, ...rest }: ButtonProps = $props()
</script>

<button
  {...rest}
  {type}
  class={cn(
    'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
    variants[variant],
    className,
  )}
>
  {@render children?.()}
</button>
