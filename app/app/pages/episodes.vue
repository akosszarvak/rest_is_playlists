<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { Episode, EpisodesFile, RefreshResult } from '#shared/episodes'
import { EXCLUDE_REASON_LABELS, type ExcludeReason, type GroupingState } from '#shared/grouping'

const UButton = resolveComponent('UButton')
const UBadge = resolveComponent('UBadge')
const ULink = resolveComponent('ULink')

const toast = useToast()

// Client-only: the list is ~1 MB, no need to inline it into the server-rendered HTML.
const { data, status, error: loadError, refresh: reload } = await useFetch<EpisodesFile | null>('/api/episodes', {
  server: false,
  lazy: true
})

// Playlist membership and excluded flags come from the saved grouping.
const { data: grouping, refresh: reloadGrouping } = useFetch<GroupingState>('/api/grouping', { server: false, lazy: true })

interface Placement {
  playlists: { id: string, name: string }[]
  excluded: ExcludeReason | null
}

const placements = computed(() => {
  const map = new Map<string, Placement>()
  const get = (guid: string) => {
    let entry = map.get(guid)
    if (!entry) map.set(guid, entry = { playlists: [], excluded: null })
    return entry
  }
  for (const playlist of grouping.value?.grouping.playlists ?? []) {
    for (const guid of playlist.episodes) get(guid).playlists.push({ id: playlist.id, name: playlist.name })
  }
  for (const entry of grouping.value?.grouping.excluded ?? []) get(entry.guid).excluded = entry.reason
  return map
})

// --- Refresh from RSS ---------------------------------------------------------------

const refreshing = ref(false)
const lastRefresh = ref<RefreshResult | null>(null)

async function refreshFromRss() {
  refreshing.value = true
  try {
    const result = await $fetch<RefreshResult>('/api/episodes/refresh', { method: 'POST' })
    lastRefresh.value = result
    await Promise.all([reload(), reloadGrouping()])
    toast.add({
      title: 'Episodes refreshed',
      description: `${result.count} episodes, ${result.added.length} new, ${result.removed.length} removed.`,
      color: 'success',
      icon: 'i-lucide-check'
    })
  } catch (error) {
    toast.add({ title: 'Refresh failed', description: errorMessage(error), color: 'error', icon: 'i-lucide-circle-x' })
  } finally {
    refreshing.value = false
  }
}

// --- Filtering, sorting, paging ------------------------------------------------------

const search = ref('')
const type = ref<'all' | Episode['episodeType']>('all')
const sort = ref<'newest' | 'oldest' | 'longest'>('newest')
const placement = ref<'all' | 'placed' | 'unassigned' | 'excluded'>('all')
const page = ref(1)
const PAGE_SIZE = 50

const typeItems = [
  { label: 'All types', value: 'all' },
  { label: 'Full', value: 'full' },
  { label: 'Bonus', value: 'bonus' },
  { label: 'Trailer', value: 'trailer' }
]
const placementItems = [
  { label: 'Any placement', value: 'all' },
  { label: 'In a playlist', value: 'placed' },
  { label: 'Unassigned', value: 'unassigned' },
  { label: 'Excluded', value: 'excluded' }
]
const sortItems = [
  { label: 'Newest first', value: 'newest' },
  { label: 'Oldest first', value: 'oldest' },
  { label: 'Longest first', value: 'longest' }
]

const filtered = computed(() => {
  const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean)
  const list = (data.value?.episodes ?? []).filter((episode) => {
    if (type.value !== 'all' && episode.episodeType !== type.value) return false
    if (placement.value !== 'all') {
      const where = placements.value.get(episode.guid)
      const state = where?.excluded ? 'excluded' : where?.playlists.length ? 'placed' : 'unassigned'
      if (state !== placement.value) return false
    }
    if (!terms.length) return true
    const haystack = `${episode.title}\n${episode.description}`.toLowerCase()
    return terms.every(term => haystack.includes(term))
  })
  const byDate = (a: Episode, b: Episode) => a.releaseDate.localeCompare(b.releaseDate)
  if (sort.value === 'newest') return list.sort((a, b) => byDate(b, a))
  if (sort.value === 'oldest') return list.sort(byDate)
  return list.sort((a, b) => (b.durationSec ?? 0) - (a.durationSec ?? 0))
})

const pageRows = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))

// Back to page 1 and collapse rows whenever the result set changes.
const expanded = ref<Record<string, boolean>>({})
watch([search, type, sort, placement], () => { page.value = 1 })
watch(pageRows, () => { expanded.value = {} })

// --- Table ---------------------------------------------------------------------------

const columns: TableColumn<Episode>[] = [
  {
    id: 'expand',
    cell: ({ row }) => h(UButton, {
      'color': 'neutral',
      'variant': 'ghost',
      'size': 'xs',
      'icon': 'i-lucide-chevron-right',
      'aria-label': row.getIsExpanded() ? 'Hide description' : 'Show description',
      'class': ['transition-transform', row.getIsExpanded() && 'rotate-90'],
      'onClick': () => row.toggleExpanded()
    })
  },
  {
    accessorKey: 'title',
    header: 'Title',
    cell: ({ row }) => h('div', { class: 'flex items-center gap-2 whitespace-normal' }, [
      h('span', { class: 'font-medium text-highlighted' }, row.original.title),
      row.original.episodeType !== 'full'
        ? h(UBadge, { color: 'neutral', variant: 'subtle', size: 'sm', class: 'capitalize' }, () => row.original.episodeType)
        : null
    ])
  },
  {
    id: 'playlists',
    header: 'Playlists',
    cell: ({ row }) => {
      if (!grouping.value) return null
      const where = placements.value.get(row.original.guid)
      if (where?.excluded) {
        return h(UBadge, { color: 'neutral', variant: 'outline', size: 'sm', icon: 'i-lucide-eye-off' }, () => `Excluded: ${EXCLUDE_REASON_LABELS[where.excluded!]}`)
      }
      if (!where?.playlists.length) {
        return h(ULink, { to: '/playlists?p=unassigned' }, () => h(UBadge, { color: 'warning', variant: 'subtle', size: 'sm' }, () => 'Unassigned'))
      }
      return h('div', { class: 'flex flex-wrap gap-1' }, where.playlists.map(p =>
        h(ULink, { to: `/playlists?p=${p.id}`, key: p.id }, () => h(UBadge, { color: 'primary', variant: 'subtle', size: 'sm' }, () => p.name))
      ))
    }
  },
  {
    accessorKey: 'releaseDate',
    header: 'Released',
    cell: ({ row }) => h('span', { class: 'whitespace-nowrap' }, formatDate(row.original.releaseDate))
  },
  {
    accessorKey: 'durationSec',
    header: () => h('span', { class: 'block text-right' }, 'Length'),
    cell: ({ row }) => h('span', { class: 'block text-right tabular-nums whitespace-nowrap' }, formatDuration(row.original.durationSec))
  }
]

const newGuids = computed(() => new Set(lastRefresh.value?.added.map(e => e.guid)))
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Episodes">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #trailing>
          <UBadge v-if="data" :label="String(data.count)" variant="subtle" />
        </template>
        <template #right>
          <span v-if="data" class="hidden text-sm text-muted sm:inline">
            Fetched {{ formatDateTime(data.fetchedAt) }}
          </span>
          <UButton
            label="Refresh from RSS"
            icon="i-lucide-refresh-cw"
            :loading="refreshing"
            @click="refreshFromRss"
          />
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar v-if="data">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="Search titles and descriptions…"
          class="w-full max-w-sm"
        />
        <USelect v-model="type" :items="typeItems" class="w-36" />
        <USelect v-model="placement" :items="placementItems" class="w-40" />
        <USelect v-model="sort" :items="sortItems" class="w-40" />
      </UDashboardToolbar>
    </template>

    <template #body>
      <!-- The list is fetched client-side only, so render it only there (avoids hydration mismatches). -->
      <ClientOnly>
        <UAlert
          v-if="loadError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Could not load episodes"
          :description="errorMessage(loadError)"
          :actions="[{ label: 'Retry', color: 'neutral', variant: 'outline', onClick: () => reload() }]"
        />
  
        <UEmpty
          v-else-if="status === 'success' && !data"
          icon="i-lucide-podcast"
          title="No episodes yet"
          description="Fetch the episode list from the podcast's RSS feed to get started."
          :actions="[{ label: 'Refresh from RSS', icon: 'i-lucide-refresh-cw', loading: refreshing, onClick: refreshFromRss }]"
        />
  
        <template v-else>
          <UAlert
            v-if="lastRefresh && (lastRefresh.added.length || lastRefresh.removed.length)"
            color="info"
            variant="subtle"
            icon="i-lucide-info"
            :title="`${lastRefresh.added.length} new, ${lastRefresh.removed.length} removed since the last fetch`"
            close
            @update:open="lastRefresh = null"
          >
            <template #description>
              <ul class="mt-1 space-y-0.5">
                <li v-for="episode in lastRefresh.added" :key="episode.guid">
                  <span class="text-success">+</span> {{ episode.title }} ({{ formatDate(episode.releaseDate) }})
                </li>
                <li v-for="episode in lastRefresh.removed" :key="episode.guid">
                  <span class="text-error">−</span> {{ episode.title }} ({{ formatDate(episode.releaseDate) }})
                </li>
              </ul>
              <p v-if="lastRefresh.added.length" class="mt-2">
                New episodes still need to be placed in playlists.
              </p>
            </template>
          </UAlert>
  
          <UTable
            v-model:expanded="expanded"
            :data="pageRows"
            :columns="columns"
            :loading="status === 'pending'"
            :get-row-id="(row: Episode) => row.guid"
            :meta="{ class: { tr: (row) => newGuids.has(row.original.guid) ? 'bg-success/5' : '' } }"
            :empty="search || type !== 'all' || placement !== 'all' ? 'No episodes match your filters.' : 'No episodes.'"
            class="flex-1"
          >
            <template #expanded="{ row }">
              <p class="max-w-3xl whitespace-pre-line text-sm text-muted">
                {{ row.original.description || 'No description.' }}
              </p>
            </template>
          </UTable>
  
          <div v-if="filtered.length > PAGE_SIZE" class="flex items-center justify-between gap-3 border-t border-default pt-4">
            <span class="text-sm text-muted">
              {{ (page - 1) * PAGE_SIZE + 1 }}–{{ Math.min(page * PAGE_SIZE, filtered.length) }} of {{ filtered.length }}
            </span>
            <UPagination v-model:page="page" :total="filtered.length" :items-per-page="PAGE_SIZE" />
          </div>
          <p v-else-if="data" class="text-sm text-muted">
            {{ filtered.length }} of {{ data.count }} episodes
          </p>
        </template>
      </ClientOnly>
    </template>
  </UDashboardPanel>
</template>
