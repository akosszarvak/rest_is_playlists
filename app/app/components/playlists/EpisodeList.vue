<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { moveArrayElement, useSortable } from '@vueuse/integrations/useSortable'
import { EXCLUDE_REASONS, EXCLUDE_REASON_LABELS, type ExcludeReason } from '#shared/grouping'
import {
  addEpisodes,
  excludeEpisodes,
  includeEpisodes,
  moveEpisodes,
  removeEpisodes,
  reorderEpisodes
} from '#shared/grouping-ops'

const props = defineProps<{
  /** Episodes to show, in order. */
  guids: string[]
  mode: 'playlist' | 'unassigned' | 'excluded'
  /** The playlist being shown (mode "playlist" only). */
  playlistId?: string
}>()

const emit = defineEmits<{ newPlaylistFromSelection: [guids: string[]] }>()

const editor = useInjectedGroupingEditor()
const { episodes, playlists, playlistById, memberOf, excluded } = editor

// --- Search and rendering limit -----------------------------------------------------

const search = ref('')
const RENDER_STEP = 300
const renderLimit = ref(RENDER_STEP)

const filtered = computed(() => {
  const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return props.guids
  return props.guids.filter((guid) => {
    const episode = episodes.value.get(guid)
    const haystack = `${episode?.title ?? guid}\n${episode?.description ?? ''}`.toLowerCase()
    return terms.every(term => haystack.includes(term))
  })
})
const visible = computed(() => filtered.value.slice(0, renderLimit.value))

// --- Selection (click toggles, shift-click selects a range) --------------------------

const selected = ref(new Set<string>())
let lastClicked: number | null = null

watch(() => [props.mode, props.playlistId], () => {
  selected.value = new Set()
  search.value = ''
  renderLimit.value = RENDER_STEP
  lastClicked = null
})
// Drop selections of episodes that left this list (e.g. after a move).
watch(() => props.guids, (guids) => {
  const present = new Set(guids)
  const kept = [...selected.value].filter(g => present.has(g))
  if (kept.length !== selected.value.size) selected.value = new Set(kept)
})

function onRowClick(index: number, event: MouseEvent) {
  const next = new Set(selected.value)
  const guid = visible.value[index]!
  if (event.shiftKey && lastClicked !== null) {
    const [from, to] = [Math.min(lastClicked, index), Math.max(lastClicked, index)]
    const select = !next.has(guid)
    for (const g of visible.value.slice(from, to + 1)) {
      if (select) next.add(g)
      else next.delete(g)
    }
  } else if (next.has(guid)) {
    next.delete(guid)
  } else {
    next.add(guid)
  }
  lastClicked = index
  selected.value = next
}

const allVisibleSelected = computed(() => filtered.value.length > 0 && filtered.value.every(g => selected.value.has(g)))
function toggleAll() {
  selected.value = allVisibleSelected.value ? new Set() : new Set(filtered.value)
}

// --- Bulk actions --------------------------------------------------------------------

const selection = computed(() => props.guids.filter(g => selected.value.has(g)))

function run(operation: Parameters<typeof editor.apply>[0]) {
  if (editor.apply(operation)) selected.value = new Set()
}

const otherPlaylists = computed(() => playlists.value.filter(p => p.id !== props.playlistId))

function playlistMenu(action: (targetId: string) => void): DropdownMenuItem[][] {
  const toItem = (p: { id: string, name: string, kind: string }) => ({
    label: p.name,
    icon: p.kind === 'series' ? 'i-lucide-list-ordered' : 'i-lucide-list-music',
    onSelect: () => action(p.id)
  })
  const broad = otherPlaylists.value.filter(p => p.kind === 'broad').map(toItem)
  const series = otherPlaylists.value.filter(p => p.kind === 'series').map(toItem)
  return [broad, series].filter(group => group.length)
}

const moveMenu = computed(() => playlistMenu(target => run(c => moveEpisodes(c, props.playlistId!, target, selection.value))))
const addMenu = computed(() => playlistMenu(target => run(c => addEpisodes(c, target, selection.value))))
const excludeMenu = computed<DropdownMenuItem[]>(() => EXCLUDE_REASONS.map(reason => ({
  label: EXCLUDE_REASON_LABELS[reason],
  onSelect: () => run(c => excludeEpisodes(c, selection.value, reason))
})))

function newPlaylistFromSelection() {
  emit('newPlaylistFromSelection', selection.value)
  selected.value = new Set()
}

// --- Drag and drop (playlist mode, no search active) ----------------------------------

const listEl = useTemplateRef<HTMLElement>('listEl')
const order = ref<string[]>([])
watch(() => props.guids, (guids) => { order.value = [...guids] }, { immediate: true })

const canDrag = computed(() => props.mode === 'playlist' && !search.value.trim())

const { option } = useSortable(listEl, order, {
  handle: '.drag-handle',
  animation: 150,
  onUpdate: (event) => {
    if (event.oldIndex === undefined || event.newIndex === undefined) return
    moveArrayElement(order, event.oldIndex, event.newIndex, event)
    // moveArrayElement updates the array in a microtask.
    nextTick(() => editor.apply(c => reorderEpisodes(c, props.playlistId!, order.value)))
  }
})
watch(canDrag, value => option('disabled', !value), { immediate: true })

// --- Row helpers ---------------------------------------------------------------------

const excludedReason = computed(() => new Map<string, ExcludeReason>(excluded.value.map(e => [e.guid, e.reason])))

function otherPlaylistNames(guid: string): string[] {
  return (memberOf.value.get(guid) ?? [])
    .filter(id => id !== props.playlistId)
    .map(id => playlistById.value.get(id)?.name ?? id)
}
</script>

<template>
  <div class="flex min-h-0 flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <UCheckbox
        :model-value="allVisibleSelected"
        :disabled="!filtered.length"
        aria-label="Select all"
        @update:model-value="toggleAll"
      />
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="Filter…"
        size="sm"
        class="w-56"
      />

      <template v-if="selection.length">
        <span class="text-sm font-medium">{{ selection.length }} selected</span>

        <template v-if="mode === 'playlist'">
          <UDropdownMenu :items="moveMenu" :content="{ align: 'start' }">
            <UButton label="Move to" icon="i-lucide-arrow-right-left" size="sm" color="neutral" variant="outline" :disabled="!otherPlaylists.length" />
          </UDropdownMenu>
          <UDropdownMenu :items="addMenu" :content="{ align: 'start' }">
            <UButton label="Also add to" icon="i-lucide-copy-plus" size="sm" color="neutral" variant="outline" :disabled="!otherPlaylists.length" />
          </UDropdownMenu>
          <UButton label="Split into new playlist" icon="i-lucide-split" size="sm" color="neutral" variant="outline" @click="newPlaylistFromSelection" />
          <UButton label="Remove" icon="i-lucide-minus" size="sm" color="neutral" variant="outline" @click="run(c => removeEpisodes(c, playlistId!, selection))" />
        </template>

        <template v-else-if="mode === 'unassigned'">
          <UDropdownMenu :items="addMenu" :content="{ align: 'start' }">
            <UButton label="Add to" icon="i-lucide-list-plus" size="sm" :disabled="!otherPlaylists.length" />
          </UDropdownMenu>
          <UButton label="New playlist" icon="i-lucide-plus" size="sm" color="neutral" variant="outline" @click="newPlaylistFromSelection" />
        </template>

        <UDropdownMenu v-if="mode !== 'excluded'" :items="excludeMenu" :content="{ align: 'start' }">
          <UButton label="Exclude" icon="i-lucide-eye-off" size="sm" color="neutral" variant="outline" />
        </UDropdownMenu>
        <template v-else>
          <UButton label="Include again" icon="i-lucide-eye" size="sm" @click="run(c => includeEpisodes(c, selection))" />
          <UDropdownMenu :items="excludeMenu" :content="{ align: 'start' }">
            <UButton label="Change reason" size="sm" color="neutral" variant="outline" />
          </UDropdownMenu>
        </template>
      </template>
      <span v-else class="text-sm text-muted">
        Click to select, Shift+click for a range.<template v-if="mode === 'playlist'"> Drag <UIcon name="i-lucide-grip-vertical" class="align-middle" /> to reorder.</template>
      </span>
    </div>

    <p v-if="!guids.length" class="py-8 text-center text-sm text-muted">
      <template v-if="mode === 'playlist'">
        This playlist is empty. Add episodes from Unassigned or another playlist.
      </template>
      <template v-else-if="mode === 'unassigned'">
        Every episode is placed in a playlist or excluded.
      </template>
      <template v-else>
        No excluded episodes.
      </template>
    </p>
    <p v-else-if="!filtered.length" class="py-8 text-center text-sm text-muted">
      No episodes match "{{ search }}".
    </p>

    <ul ref="listEl" class="divide-y divide-default rounded-md border border-default">
      <li
        v-for="(guid, index) in visible"
        :key="guid"
        class="flex cursor-pointer items-center gap-3 px-3 py-2 select-none hover:bg-elevated/50"
        :class="{ 'bg-primary/10': selected.has(guid) }"
        @click="onRowClick(index, $event)"
      >
        <UIcon
          v-if="canDrag"
          name="i-lucide-grip-vertical"
          class="drag-handle size-4 shrink-0 cursor-grab text-dimmed"
          @click.stop
        />
        <UCheckbox :model-value="selected.has(guid)" class="pointer-events-none" tabindex="-1" />
        <span v-if="mode === 'playlist'" class="w-8 shrink-0 text-right text-sm text-dimmed tabular-nums">{{ index + 1 }}</span>

        <div class="min-w-0 flex-1">
          <p class="truncate text-sm" :class="episodes.has(guid) ? 'text-highlighted' : 'text-warning'">
            {{ editor.episodeLabel(guid) }}
          </p>
          <div v-if="otherPlaylistNames(guid).length || excludedReason.has(guid)" class="mt-0.5 flex flex-wrap gap-1">
            <UBadge
              v-for="name in otherPlaylistNames(guid).slice(0, 3)"
              :key="name"
              :label="name"
              size="sm"
              color="neutral"
              variant="subtle"
            />
            <UBadge v-if="otherPlaylistNames(guid).length > 3" :label="`+${otherPlaylistNames(guid).length - 3}`" size="sm" color="neutral" variant="subtle" />
            <UBadge v-if="excludedReason.has(guid)" :label="EXCLUDE_REASON_LABELS[excludedReason.get(guid)!]" size="sm" color="warning" variant="subtle" />
          </div>
        </div>

        <span class="hidden shrink-0 text-sm text-muted sm:inline">{{ episodes.get(guid) ? formatDate(episodes.get(guid)!.releaseDate) : '' }}</span>
        <span class="w-16 shrink-0 text-right text-sm text-muted tabular-nums">{{ formatDuration(episodes.get(guid)?.durationSec ?? null) }}</span>
      </li>
    </ul>

    <div v-if="filtered.length > visible.length" class="flex justify-center">
      <UButton
        :label="`Show ${Math.min(RENDER_STEP, filtered.length - visible.length)} more (${filtered.length - visible.length} hidden)`"
        color="neutral"
        variant="outline"
        size="sm"
        @click="renderLimit += RENDER_STEP"
      />
    </div>
  </div>
</template>
