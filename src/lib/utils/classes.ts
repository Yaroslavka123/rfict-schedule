export function cn(...inputs: unknown[]) {
  const classes: string[] = []

  const append = (value: unknown) => {
    if (!value) return
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
      classes.push(String(value))
      return
    }
    if (Array.isArray(value)) {
      value.forEach(append)
      return
    }
    if (typeof value === 'object') {
      Object.entries(value).forEach(([key, enabled]) => {
        if (enabled) classes.push(key)
      })
    }
  }

  inputs.forEach(append)
  return classes.join(' ')
}
