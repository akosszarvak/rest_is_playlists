<script setup lang="ts">
import type { ExportStatus, PlaylistExportInfo, SpotifyStatus } from '#shared/spotify'

const toast = useToast()
const route = useRoute()
const router = useRouter()

const { data: status, error: loadError, refresh } = useFetch<SpotifyStatus>('/api/spotify/status', { server: false, lazy: true })
/** Non-null alias for the template; only used after the loading check. */
const info = computed(() => status.value!)

// --- Result of the login redirect (?spotify=connected / ?spotifyError=…) ----------------------

const loginError = ref('')
onMounted(() => {
  if (route.query.spotify === 'connected') {
    toast.add({ title: 'Connected to Spotify', color: 'success', icon: 'i-lucide-check' })
  }
  if (typeof route.query.spotifyError === 'string') loginError.value = route.query.spotifyError
  if (route.query.spotify || route.query.spotifyError) router.replace({ query: {} })
})

async function disconnect() {
  try {
    await $fetch('/api/spotify/logout', { method: 'POST' })
    await refresh()
  } catch (error) {
    toast.add({ title: 'Could not disconnect', description: errorMessage(error), color: 'error' })
  }
}

// --- Matching -------------------------------------------------------------------------------

const matching = ref(false)
async function matchEpisodes() {
  matching.value = true
  try {
    const result = await $fetch<{ spotifyEpisodes: number, matched: number, unmatched: number }>('/api/spotify/match', { method: 'POST' })
    await refresh()
    toast.add({
      title: 'Episodes matched',
      description: `${result.matched} matched to ${result.spotifyEpisodes} episodes on Spotify, ${result.unmatched} not found.`,
      color: 'success',
      icon: 'i-lucide-check'
    })
  } catch (error) {
    toast.add({ title: 'Matching failed', description: errorMessage(error), color: 'error', icon: 'i-lucide-circle-x' })
  } finally {
    matching.value = false
  }
}

async function onManualMatch(episodeName: string) {
  toast.add({ title: 'Episode matched', description: episodeName, color: 'success', icon: 'i-lucide-link' })
  await refresh()
}

// --- Export ---------------------------------------------------------------------------------

const STATUS_BADGES: Record<ExportStatus, { label: string, color: 'neutral' | 'success' | 'warning' }> = {
  'not-exported': { label: 'Not exported', color: 'neutral' },
  'up-to-date': { label: 'Up to date', color: 'success' },
  'changed': { label: 'Changed since export', color: 'warning' }
}
const statusBadge = (value: ExportStatus) => STATUS_BADGES[value]

const canExport = computed(() => Boolean(status.value?.connected && status.value.matching.lastMatchAt))
const pending = computed(() => (status.value?.playlists ?? []).filter(p => p.status !== 'up-to-date'))

const exporting = ref<string | null>(null)
const progress = ref<{ done: number, total: number } | null>(null)
const exportErrors = ref<{ name: string, message: string }[]>([])

async function exportOne(playlist: PlaylistExportInfo): Promise<boolean> {
  exporting.value = playlist.id
  try {
    await $fetch(`/api/spotify/export/${playlist.id}`, { method: 'POST' })
    return true
  } catch (error) {
    exportErrors.value.push({ name: playlist.name, message: errorMessage(error) })
    return false
  } finally {
    exporting.value = null
  }
}

async function exportSingle(playlist: PlaylistExportInfo) {
  exportErrors.value = []
  if (await exportOne(playlist)) toast.add({ title: `Exported "${playlist.name}"`, color: 'success', icon: 'i-lucide-check' })
  await refresh()
}

async function exportAll() {
  const list = [...pending.value]
  exportErrors.value = []
  progress.value = { done: 0, total: list.length }
  let ok = 0
  for (const playlist of list) {
    if (await exportOne(playlist)) ok++
    progress.value = { done: progress.value.done + 1, total: list.length }
  }
  progress.value = null
  await refresh()
  toast.add({
    title: `Exported ${ok} of ${list.length} playlists`,
    color: ok === list.length ? 'success' : 'warning',
    icon: ok === list.length ? 'i-lucide-check' : 'i-lucide-triangle-alert'
  })
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Export">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <ClientOnly>
        <UAlert
          v-if="loadError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Could not load the Spotify status"
          :description="errorMessage(loadError)"
          :actions="[{ label: 'Retry', color: 'neutral', variant: 'outline', onClick: () => refresh() }]"
        />
        <div v-else-if="!status" class="flex justify-center py-12">
          <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-muted" />
        </div>

        <div v-else class="mx-auto w-full max-w-4xl space-y-6">
          <UAlert
            v-if="loginError"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-x"
            title="Spotify login failed"
            :description="loginError"
            close
            @update:open="loginError = ''"
          />

          <!-- 1. Account -->
          <UCard>
            <template #header>
              <div class="flex items-center justify-between gap-2">
                <h2 class="font-semibold">
                  1. Spotify account
                </h2>
                <UBadge v-if="info.connected" color="success" variant="subtle" label="Connected" />
              </div>
            </template>

            <div v-if="!info.clientIdSet" class="space-y-2 text-sm">
              <p>
                Create a free app in the
                <ULink to="https://developer.spotify.com/dashboard" target="_blank" class="text-primary">Spotify developer dashboard</ULink>,
                add <code>{{ info.redirectUri }}</code> as its redirect URI, and paste its Client ID in Settings.
              </p>
              <UButton label="Open Settings" to="/settings" color="neutral" variant="outline" size="sm" />
            </div>
            <div v-else-if="!info.connected" class="flex flex-wrap items-center gap-3">
              <UButton label="Connect Spotify" icon="i-lucide-log-in" to="/api/spotify/login" external />
              <span class="text-sm text-muted">The redirect URI <code>{{ info.redirectUri }}</code> must be registered in your Spotify app.</span>
            </div>
            <div v-else class="flex flex-wrap items-center gap-3 text-sm">
              <span>Connected as <strong>{{ info.user?.displayName ?? info.user?.id }}</strong>.</span>
              <UButton label="Disconnect" color="neutral" variant="ghost" size="sm" @click="disconnect" />
            </div>
          </UCard>

          <!-- 2. Matching -->
          <UCard v-if="info.connected">
            <template #header>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 class="font-semibold">
                    2. Match episodes
                  </h2>
                  <p class="text-sm text-muted">
                    RSS episodes are matched to Spotify episodes by title and release date.
                  </p>
                </div>
                <UButton
                  :label="info.matching.lastMatchAt ? 'Match again' : 'Match episodes'"
                  icon="i-lucide-link-2"
                  :loading="matching"
                  @click="matchEpisodes"
                />
              </div>
            </template>

            <p v-if="!info.matching.lastMatchAt" class="text-sm text-muted">
              Not matched yet. Matching reads the show's episode list from Spotify (about 15 requests).
            </p>
            <div v-else class="space-y-3">
              <p class="text-sm">
                {{ info.matching.matched }} of {{ info.matching.total }} episodes matched
                <template v-if="info.matching.manual">
                  ({{ info.matching.manual }} by hand)
                </template>
                · last run {{ formatDateTime(info.matching.lastMatchAt) }}
              </p>
              <template v-if="info.unmatched.length">
                <p class="text-sm text-muted">
                  These episodes were not found on Spotify. Find each one in Spotify, use Share, then Copy link to episode,
                  and paste the link here. Unmatched episodes are left out of the export.
                </p>
                <ul class="divide-y divide-default rounded-md border border-default">
                  <ExportUnmatchedEpisode
                    v-for="episode in info.unmatched"
                    :key="episode.guid"
                    v-bind="episode"
                    @matched="onManualMatch"
                  />
                </ul>
              </template>
            </div>
          </UCard>

          <!-- 3. Export -->
          <UCard>
            <template #header>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 class="font-semibold">
                    3. Export playlists
                  </h2>
                  <p class="text-sm text-muted">
                    The first export creates each playlist; later exports update it in place. No duplicates.
                  </p>
                </div>
                <UButton
                  :label="pending.length ? `Export all (${pending.length})` : 'All up to date'"
                  icon="i-lucide-upload"
                  :disabled="!canExport || !pending.length || Boolean(exporting)"
                  :loading="Boolean(progress)"
                  @click="exportAll"
                />
              </div>
            </template>

            <div class="space-y-3">
              <p v-if="!info.playlists.length" class="text-sm text-muted">
                No playlists yet. Create them on the <ULink to="/playlists" class="text-primary">Playlists</ULink> page or generate a grouping on the <ULink to="/grouping" class="text-primary">Grouping</ULink> page.
              </p>
              <p v-else-if="!canExport" class="text-sm text-muted">
                {{ info.connected ? 'Match the episodes first.' : 'Connect Spotify first.' }}
              </p>

              <div v-if="progress" class="space-y-1">
                <UProgress :model-value="Math.round((progress.done / progress.total) * 100)" />
                <p class="text-xs text-muted">
                  {{ progress.done }} of {{ progress.total }} exported…
                </p>
              </div>

              <UAlert v-if="exportErrors.length" color="error" variant="subtle" icon="i-lucide-circle-x" :title="`${exportErrors.length} export(s) failed`">
                <template #description>
                  <ul class="space-y-0.5">
                    <li v-for="e in exportErrors" :key="e.name">
                      <strong>{{ e.name }}</strong>: {{ e.message }}
                    </li>
                  </ul>
                </template>
              </UAlert>

              <ul v-if="info.playlists.length" class="divide-y divide-default rounded-md border border-default">
                <li v-for="playlist in info.playlists" :key="playlist.id" class="flex flex-wrap items-center gap-3 px-3 py-2">
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium">
                      {{ playlist.spotifyName }}
                    </p>
                    <p class="text-xs text-muted">
                      {{ playlist.exportable }} episodes
                      <span v-if="playlist.missing" class="text-warning">· {{ playlist.missing }} not matched, left out</span>
                      <template v-if="playlist.exportedAt">
                        · exported {{ formatDateTime(playlist.exportedAt) }}
                      </template>
                    </p>
                  </div>
                  <UBadge v-bind="statusBadge(playlist.status)" variant="subtle" size="sm" />
                  <UButton
                    v-if="playlist.url"
                    :to="playlist.url"
                    target="_blank"
                    icon="i-lucide-external-link"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    aria-label="Open in Spotify"
                  />
                  <UButton
                    :label="playlist.status === 'not-exported' ? 'Export' : 'Update'"
                    size="sm"
                    color="neutral"
                    variant="outline"
                    :disabled="!canExport || (Boolean(exporting) && exporting !== playlist.id) || Boolean(progress)"
                    :loading="exporting === playlist.id && !progress"
                    @click="exportSingle(playlist)"
                  />
                </li>
              </ul>
            </div>
          </UCard>
        </div>
      </ClientOnly>
    </template>
  </UDashboardPanel>
</template>
