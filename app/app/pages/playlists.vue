<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { useEventListener } from '@vueuse/core'
import type { Playlist } from '#shared/grouping'
import {
  addEpisodes,
  createPlaylist,
  deletePlaylist,
  mergePlaylists,
  removeEpisodes,
  sortByReleaseDate,
  updatePlaylist,
  type PlaylistDetails
} from '#shared/grouping-ops'

const editor = useGroupingEditor()
provide(groupingEditorKey, editor)
const { playlists, playlistById, unassigned, excluded, episodes, issues, dirty } = editor

const toast = useToast()
const route = useRoute()
const router = useRouter()

// --- Selection via ?p=<playlist id> | unassigned | excluded --------------------------

type View = { kind: 'unassigned' } | { kind: 'excluded' } | { kind: 'playlist', playlist: Playlist }

const selectedKey = computed(() => {
  const p = route.query.p
  if (typeof p === 'string' && (p === 'unassigned' || p === 'excluded' || playlistById.value.has(p))) return p
  return unassigned.value.length || !playlists.value.length ? 'unassigned' : playlists.value[0]!.id
})

const view = computed<View>(() => {
  const key = selectedKey.value
  if (key === 'unassigned' || key === 'excluded') return { kind: key }
  return { kind: 'playlist', playlist: playlistById.value.get(key)! }
})

function select(key: string) {
  router.replace({ query: { ...route.query, p: key } })
}

// --- Sidebar tree: broad playlists with their series underneath ----------------------

interface TreeItem { playlist: Playlist, depth: 0 | 1 }

const tree = computed<TreeItem[]>(() => {
  const items: TreeItem[] = []
  const placed = new Set<string>()
  for (const broad of playlists.value.filter(p => p.kind === 'broad')) {
    items.push({ playlist: broad, depth: 0 })
    for (const child of playlists.value.filter(p => p.parent === broad.id)) {
      items.push({ playlist: child, depth: 1 })
      placed.add(child.id)
    }
  }
  for (const series of playlists.value.filter(p => p.kind === 'series' && !placed.has(p.id))) {
    items.push({ playlist: series, depth: 0 })
  }
  return items
})

const playlistsWithIssues = computed(() => new Set(issues.value.flatMap(i => ('playlistId' in i ? [i.playlistId] : []))))
const unknownIssue = computed(() => issues.value.find(i => i.type === 'unknown-episodes'))

// --- Totals for the selected view -------------------------------------------------------

const viewGuids = computed(() => {
  const v = view.value
  if (v.kind === 'unassigned') return unassigned.value
  if (v.kind === 'excluded') return excluded.value.map(e => e.guid)
  return v.playlist.episodes
})
const totalSeconds = computed(() => viewGuids.value.reduce((sum, g) => sum + (episodes.value.get(g)?.durationSec ?? 0), 0))

// --- Details modal (create / edit / split) ---------------------------------------------

const modal = reactive({
  open: false,
  mode: 'create' as 'create' | 'edit',
  episodes: [] as string[],
  /** When splitting, the playlist the episodes are moved out of. */
  splitFrom: null as string | null
})

function openCreate(guids: string[] = [], splitFrom: string | null = null) {
  Object.assign(modal, { open: true, mode: 'create', episodes: guids, splitFrom })
}

function openEdit() {
  Object.assign(modal, { open: true, mode: 'edit', episodes: [], splitFrom: null })
}

const editInitial = computed<PlaylistDetails | undefined>(() => {
  const v = view.value
  if (modal.mode !== 'edit' || v.kind !== 'playlist') return undefined
  const { name, description, kind, parent, era } = v.playlist
  return { name, description, kind, parent, era }
})

function onDetailsSubmit(details: PlaylistDetails) {
  const v = view.value
  if (modal.mode === 'edit' && v.kind === 'playlist') {
    editor.apply(c => updatePlaylist(c, v.playlist.id, details))
    return
  }
  let newId = ''
  const ok = editor.apply((c) => {
    const source = modal.splitFrom ? removeEpisodes(c, modal.splitFrom, modal.episodes) : c
    const result = createPlaylist(source, { ...details, episodes: modal.episodes })
    newId = result.id
    return result.content
  })
  if (ok) select(newId)
}

// --- Playlist actions -----------------------------------------------------------------

function deleteSelected(playlist: Playlist) {
  if (!editor.apply(c => deletePlaylist(c, playlist.id))) return
  select('unassigned')
  toast.add({
    title: `Deleted "${playlist.name}"`,
    description: 'Not saved yet.',
    icon: 'i-lucide-trash-2',
    actions: [{ label: 'Undo', color: 'neutral', variant: 'outline', onClick: () => editor.undo() }]
  })
}

function playlistActions(playlist: Playlist): DropdownMenuItem[][] {
  const mergeTargets = playlists.value
    .filter(p => p.id !== playlist.id)
    .map(p => ({
      label: p.name,
      onSelect: () => {
        if (editor.apply(c => mergePlaylists(c, playlist.id, p.id))) {
          select(p.id)
          toast.add({ title: `Merged "${playlist.name}" into "${p.name}"`, description: 'Not saved yet.', icon: 'i-lucide-merge' })
        }
      }
    }))
  return [
    [
      { label: 'Edit details', icon: 'i-lucide-pencil', onSelect: openEdit },
      {
        label: 'Sort by release date',
        icon: 'i-lucide-arrow-down-0-1',
        onSelect: () => editor.apply(c => sortByReleaseDate(c, playlist.id, g => episodes.value.get(g)?.releaseDate))
      },
      { label: 'Merge into', icon: 'i-lucide-merge', disabled: !mergeTargets.length, children: [mergeTargets] }
    ],
    [{ label: 'Delete playlist', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => deleteSelected(playlist) }]
  ]
}

const selectedIssues = computed(() => {
  const v = view.value
  if (v.kind !== 'playlist') return []
  return issues.value.filter(i => 'playlistId' in i && i.playlistId === v.playlist.id)
})

// --- Unsaved changes guard ------------------------------------------------------------

onBeforeRouteLeave(() => {
  if (dirty.value && !window.confirm('You have unsaved playlist changes. Leave without saving?')) return false
})
useEventListener('beforeunload', (event: BeforeUnloadEvent) => {
  if (dirty.value) event.preventDefault()
})
</script>

<template>
  <UDashboardPanel id="playlists-list" :default-size="22" :min-size="16" :max-size="35" resizable>
    <template #header>
      <UDashboardNavbar title="Playlists">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton icon="i-lucide-plus" size="sm" aria-label="New playlist" :disabled="editor.loading.value" @click="openCreate()" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <ClientOnly>
        <div v-if="!editor.loading.value" class="flex flex-col gap-1">
          <button
            v-for="item in [
              { key: 'unassigned', label: 'Unassigned', icon: 'i-lucide-inbox', count: unassigned.length },
              { key: 'excluded', label: 'Excluded', icon: 'i-lucide-eye-off', count: excluded.length }
            ]"
            :key="item.key"
            type="button"
            class="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-elevated"
            :class="selectedKey === item.key ? 'bg-elevated font-medium text-highlighted' : 'text-default'"
            @click="select(item.key)"
          >
            <UIcon :name="item.icon" class="size-4 shrink-0" />
            <span class="flex-1 truncate">{{ item.label }}</span>
            <UBadge
              :label="String(item.count)"
              size="sm"
              :color="item.key === 'unassigned' && item.count ? 'warning' : 'neutral'"
              variant="subtle"
            />
          </button>

          <USeparator class="my-2" />

          <p v-if="!tree.length" class="px-2 text-sm text-muted">
            No playlists yet. Use + to create one.
          </p>
          <button
            v-for="{ playlist, depth } in tree"
            :key="playlist.id"
            type="button"
            class="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-elevated"
            :class="[
              selectedKey === playlist.id ? 'bg-elevated font-medium text-highlighted' : 'text-default',
              depth ? 'ml-4' : ''
            ]"
            @click="select(playlist.id)"
          >
            <UIcon :name="playlist.kind === 'series' ? 'i-lucide-list-ordered' : 'i-lucide-list-music'" class="size-4 shrink-0" />
            <span class="flex-1 truncate">{{ playlist.name }}</span>
            <UIcon v-if="playlistsWithIssues.has(playlist.id)" name="i-lucide-triangle-alert" class="size-4 shrink-0 text-warning" />
            <span class="text-xs text-muted tabular-nums">{{ playlist.episodes.length }}</span>
          </button>
        </div>
      </ClientOnly>
    </template>
  </UDashboardPanel>

  <UDashboardPanel id="playlists-detail">
    <template #header>
      <UDashboardNavbar :title="view.kind === 'playlist' ? view.playlist.name : view.kind === 'unassigned' ? 'Unassigned episodes' : 'Excluded episodes'">
        <template #trailing>
          <ClientOnly>
            <UBadge v-if="view.kind === 'playlist'" :label="view.playlist.kind" variant="subtle" color="neutral" class="capitalize" />
          </ClientOnly>
        </template>
        <template #right>
          <ClientOnly>
            <span v-if="dirty" class="hidden text-sm text-warning sm:inline">Unsaved changes</span>
            <UButton
              icon="i-lucide-undo-2"
              color="neutral"
              variant="ghost"
              aria-label="Undo"
              :disabled="!editor.canUndo.value"
              @click="editor.undo()"
            />
            <UButton v-if="dirty" label="Discard" color="neutral" variant="ghost" @click="editor.discard()" />
            <UButton label="Save" icon="i-lucide-save" :disabled="!dirty" :loading="editor.saving.value" @click="editor.save()" />
          </ClientOnly>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <ClientOnly>
        <UAlert
          v-if="editor.loadError.value"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Could not load playlists"
          :description="errorMessage(editor.loadError.value)"
          :actions="[{ label: 'Retry', color: 'neutral', variant: 'outline', onClick: () => editor.reloadGrouping() }]"
        />

        <div v-else-if="editor.loading.value" class="flex justify-center py-12">
          <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-muted" />
        </div>

        <div v-else class="flex flex-col gap-4">
          <UAlert
            v-if="editor.state.value && !editor.state.value.exists"
            color="info"
            variant="subtle"
            icon="i-lucide-info"
            title="No grouping saved yet"
            description="data/grouping.json doesn't exist yet. Create playlists here and press Save, or generate a proposal on the Grouping page."
          />
          <UAlert
            v-if="unknownIssue"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="`${unknownIssue.guids.length} episode(s) in the grouping are not in the episode list`"
            description="They may have been removed from the feed. Remove them from their playlists, or refresh the episode list."
          />

          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0 space-y-1">
              <p v-if="view.kind === 'playlist' && view.playlist.description" class="text-sm">
                {{ view.playlist.description }}
              </p>
              <p v-else-if="view.kind === 'unassigned'" class="text-sm">
                Episodes not in any playlist and not excluded. New episodes from an RSS refresh land here.
              </p>
              <p v-else-if="view.kind === 'excluded'" class="text-sm">
                Excluded episodes are left out of every playlist and the Spotify export.
              </p>
              <p class="text-sm text-muted">
                {{ viewGuids.length }} episodes · {{ formatDuration(totalSeconds) }}
                <template v-if="view.kind === 'playlist' && view.playlist.era"> · {{ formatEra(view.playlist.era) }}</template>
                <template v-if="view.kind === 'playlist' && view.playlist.parent">
                  · Part of
                  <ULink class="text-primary" @click="select(view.playlist.parent)">{{ playlistById.get(view.playlist.parent)?.name }}</ULink>
                </template>
              </p>
            </div>
            <UDropdownMenu v-if="view.kind === 'playlist'" :items="playlistActions(view.playlist)" :content="{ align: 'end' }">
              <UButton label="Playlist" trailing-icon="i-lucide-chevron-down" color="neutral" variant="outline" />
            </UDropdownMenu>
          </div>

          <template v-for="issue in selectedIssues" :key="issue.type">
            <UAlert
              v-if="issue.type === 'series-not-in-parent'"
              color="warning"
              variant="subtle"
              icon="i-lucide-triangle-alert"
              :title="`${issue.guids.length} episode(s) of this series are missing from ${playlistById.get(issue.parentId)?.name}`"
              description="A series should also appear in full inside its broad parent playlist."
              :actions="[{
                label: 'Add them to the parent',
                color: 'warning',
                variant: 'outline',
                onClick: () => { editor.apply(c => addEpisodes(c, issue.parentId, issue.guids)) }
              }]"
            />
          </template>

          <PlaylistsEpisodeList
            :guids="viewGuids"
            :mode="view.kind"
            :playlist-id="view.kind === 'playlist' ? view.playlist.id : undefined"
            @new-playlist-from-selection="guids => openCreate(guids, view.kind === 'playlist' ? view.playlist.id : null)"
          />
        </div>
      </ClientOnly>
    </template>
  </UDashboardPanel>

  <PlaylistsDetailsModal
    v-model:open="modal.open"
    :title="modal.mode === 'edit' ? 'Edit playlist' : modal.splitFrom ? `Split ${modal.episodes.length} episodes into a new playlist` : 'New playlist'"
    :submit-label="modal.mode === 'edit' ? 'Apply' : 'Create'"
    :initial="editInitial"
    :editing-id="modal.mode === 'edit' && view.kind === 'playlist' ? view.playlist.id : undefined"
    :playlists="playlists"
    @submit="onDetailsSubmit"
  />
</template>
