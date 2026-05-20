<script lang="ts">
  interface HighlightProps {
    text?: string | null
    query?: string
  }

  let { text = '', query = '' }: HighlightProps = $props()

  const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let parts = $derived(
    query.trim()
      ? String(text || '').split(new RegExp(`(${escapeRegex(query.trim())})`, 'gi'))
      : [String(text || '')],
  )
  let normalizedQuery = $derived(query.trim().toLowerCase())
</script>

{#each parts as part, index (index)}
  {#if normalizedQuery && part.toLowerCase() === normalizedQuery}
    <mark class="rounded bg-yellow-200 px-0.5 dark:bg-yellow-800">{part}</mark>
  {:else}
    {part}
  {/if}
{/each}
