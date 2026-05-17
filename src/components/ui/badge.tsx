import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

type BadgeTone = 'default' | 'green' | 'blue' | 'orange' | 'purple' | 'red' | 'muted'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
}

const tones: Record<BadgeTone, string> = {
  default: 'bg-primary text-primary-foreground',
  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200',
  blue: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-200',
  orange: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-200',
  purple: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-200',
  red: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200',
  muted: 'bg-muted text-muted-foreground',
}

export function Badge({ className, tone = 'default', ...props }: BadgeProps) {
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold', tones[tone], className)} {...props} />
}
