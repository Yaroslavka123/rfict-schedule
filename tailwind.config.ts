import type { Config } from 'tailwindcss'

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,svelte}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        muted: 'hsl(var(--muted))',
        'muted-foreground': 'hsl(var(--muted-foreground))',
        card: 'hsl(var(--card))',
        'card-foreground': 'hsl(var(--card-foreground))',
        popover: 'hsl(var(--popover))',
        primary: 'hsl(var(--primary))',
        'primary-foreground': 'hsl(var(--primary-foreground))',
        accent: 'hsl(var(--accent))',
        'accent-foreground': 'hsl(var(--accent-foreground))',
        destructive: 'hsl(var(--destructive))',
      },
      boxShadow: {
        glow: '0 12px 36px rgba(15, 118, 110, 0.14)',
        card: '0 10px 28px rgba(15, 23, 42, 0.06)',
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.25rem',
      },
      gridTemplateColumns: {
        sidebar: '16rem minmax(0, 1fr)',
        teachers: '24rem minmax(0, 1fr)',
        analytics: 'minmax(0, 1.4fr) minmax(22rem, 0.6fr)',
      },
      height: {
        chart: '22rem',
      },
      maxHeight: {
        'teacher-list': '48rem',
      },
      minWidth: {
        room: '8rem',
        sticky: '4.5rem',
        pair: '4rem',
      },
      inset: {
        'sticky-second': '4.5rem',
      },
    },
  },
  plugins: [],
} satisfies Config
