<script lang="ts">
  import { Plus, Trash2 } from '@lucide/svelte'

  import Button from '@/components/ui/Button.svelte'
  import { cn } from '@/lib/utils'
  import { columnGroupsStore, type ColumnGroup, type ColumnGroupScope } from '@/stores/columnGroups'

  interface ColumnGroupsBarProps {
    scope: ColumnGroupScope
    groups: ColumnGroup[]
    draggedColumn: string | null
    onDropColumn: (groupId: string) => void
  }

  let { scope, groups, draggedColumn, onDropColumn }: ColumnGroupsBarProps = $props()
  let dropGroupId = $state<string | null>(null)

  function addGroup() {
    columnGroupsStore.addGroup(scope)
  }

  function removeGroup(id: string) {
    columnGroupsStore.removeGroup(scope, id)
  }

  function handleDragOver(event: DragEvent, groupId: string) {
    if (!draggedColumn) return
    event.preventDefault()
    dropGroupId = groupId
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  }

  function handleDrop(event: DragEvent, groupId: string) {
    if (!draggedColumn) return
    event.preventDefault()
    onDropColumn(groupId)
    dropGroupId = null
  }
</script>

<div class="matrix-groups-bar">
  <Button variant="secondary" class="h-8 px-2.5 text-xs" onclick={addGroup} title="Создать группу колонок">
    <Plus class="h-3.5 w-3.5" />
    Группа
  </Button>

  {#each groups as group (group.id)}
    <div
      class={cn('matrix-group-chip', dropGroupId === group.id && 'matrix-group-chip-drop')}
      role="group"
      ondragover={(event) => handleDragOver(event, group.id)}
      ondragleave={() => (dropGroupId = null)}
      ondrop={(event) => handleDrop(event, group.id)}
      title={draggedColumn ? `Перетащить «${draggedColumn}» в ${group.name}` : group.name}
    >
      <span class="matrix-group-chip-name">{group.name}</span>
      <button
        class="matrix-group-delete"
        type="button"
        onclick={() => removeGroup(group.id)}
        title="Удалить группу"
        aria-label={`Удалить ${group.name}`}
      >
        <Trash2 class="h-3.5 w-3.5" />
      </button>
    </div>
  {/each}
</div>
