<script setup lang="ts">
import { nextSteps, type DashboardSummary } from '#shared/dashboard'

const { data: summary, error, refresh } = useFetch<DashboardSummary>('/api/dashboard', { server: false, lazy: true })
const steps = computed(() => (summary.value ? nextSteps(summary.value) : []))

const METHOD_LABELS: Record<string, string> = {
  premade: 'pre-made',
  manual: 'manual',
  anthropic: 'Claude',
  gemini: 'Gemini'
}

interface Stat { label: string, value: string, detail: string, icon: string, to: string }

const stats = computed<Stat[]>(() => {
  const s = summary.value
  if (!s) return []
  return [
    {
      label: 'Episodes',
      value: String(s.episodes.count),
      detail: s.episodes.fetchedAt ? `Fetched ${formatDateTime(s.episodes.fetchedAt)}` : 'Not fetched yet',
      icon: 'i-lucide-podcast',
      to: '/episodes'
    },
    {
      label: 'Playlists',
      value: String(s.grouping.playlists),
      detail: s.grouping.exists
        ? `${s.grouping.unassigned} unassigned · ${s.grouping.excluded} excluded${s.grouping.method ? ` · ${METHOD_LABELS[s.grouping.method] ?? s.grouping.method} grouping` : ''}`
        : 'No grouping yet',
      icon: 'i-lucide-list-music',
      to: '/playlists'
    },
    {
      label: 'Spotify',
      value: s.spotify.connected ? 'Connected' : s.spotify.clientIdSet ? 'Not connected' : 'Not set up',
      detail: s.spotify.connected
        ? `${s.spotify.user ?? ''}${s.spotify.lastMatchAt ? ` · ${s.spotify.matched}/${s.spotify.total} episodes matched` : ' · not matched yet'}`
        : s.spotify.clientIdSet ? 'Connect on the Export page' : 'Add a Client ID in Settings',
      icon: 'i-lucide-audio-lines',
      to: s.spotify.clientIdSet ? '/export' : '/settings'
    },
    {
      label: 'Last export',
      value: s.spotify.lastExportAt ? formatDate(s.spotify.lastExportAt.slice(0, 10)) : 'Never',
      detail: s.spotify.pendingExports ? `${s.spotify.pendingExports} playlist(s) new or changed` : s.spotify.lastExportAt ? 'Everything exported' : 'Nothing exported yet',
      icon: 'i-lucide-upload',
      to: '/export'
    }
  ]
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Dashboard">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <ClientOnly>
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Could not load the dashboard"
          :description="errorMessage(error)"
          :actions="[{ label: 'Retry', color: 'neutral', variant: 'outline', onClick: () => refresh() }]"
        />
        <div v-else-if="!summary" class="flex justify-center py-12">
          <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-muted" />
        </div>

        <div v-else class="mx-auto w-full max-w-5xl space-y-8">
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <NuxtLink
              v-for="stat in stats"
              :key="stat.label"
              :to="stat.to"
              class="rounded-lg border border-default p-4 transition-colors hover:bg-elevated/50"
            >
              <div class="flex items-center gap-2 text-sm text-muted">
                <UIcon :name="stat.icon" class="size-4" />
                {{ stat.label }}
              </div>
              <p class="mt-2 text-2xl font-semibold text-highlighted">
                {{ stat.value }}
              </p>
              <p class="mt-1 text-xs text-muted">
                {{ stat.detail }}
              </p>
            </NuxtLink>
          </div>

          <section class="space-y-3">
            <h2 class="text-lg font-semibold">
              What to do next
            </h2>
            <div v-if="!steps.length" class="flex items-center gap-3 rounded-lg border border-default p-4">
              <UIcon name="i-lucide-circle-check" class="size-6 shrink-0 text-success" />
              <div>
                <p class="font-medium">
                  Everything is up to date
                </p>
                <p class="text-sm text-muted">
                  Your playlists are grouped and exported. Refresh the episode list every few months to pick up new episodes.
                </p>
              </div>
            </div>
            <ul v-else class="divide-y divide-default rounded-lg border border-default">
              <li v-for="(step, i) in steps" :key="step.id" class="flex flex-wrap items-center gap-3 p-4">
                <span
                  class="flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                  :class="step.kind === 'todo' ? 'bg-primary/15 text-primary' : 'bg-elevated text-muted'"
                >
                  <UIcon v-if="step.kind === 'info'" name="i-lucide-info" class="size-4" />
                  <template v-else>{{ i + 1 }}</template>
                </span>
                <div class="min-w-0 flex-1">
                  <p class="font-medium">
                    {{ step.title }}
                  </p>
                  <p class="text-sm text-muted">
                    {{ step.description }}
                  </p>
                </div>
                <UButton :label="step.action" :to="step.to" :color="step.kind === 'todo' ? 'primary' : 'neutral'" :variant="step.kind === 'todo' ? 'solid' : 'outline'" size="sm" />
              </li>
            </ul>
          </section>

          <p v-if="summary.episodes.newest" class="text-sm text-muted">
            Newest episode: <span class="text-default">{{ summary.episodes.newest.title }}</span> ({{ formatDate(summary.episodes.newest.releaseDate) }})
          </p>
        </div>
      </ClientOnly>
    </template>
  </UDashboardPanel>
</template>
