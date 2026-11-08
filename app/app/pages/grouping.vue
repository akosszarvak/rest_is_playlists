<script setup lang="ts">
import type { Episode, EpisodesFile } from '#shared/episodes'
import type { GroupingState } from '#shared/grouping'
import type { ProposalMode, ProposalState, StoredProposal } from '#shared/proposal'

const fetchOptions = { server: false, lazy: true } as const
const { data: proposalState, error: proposalError, refresh: reloadProposal } = useFetch<ProposalState>('/api/grouping/proposal', fetchOptions)
const { data: grouping, error: groupingError, refresh: reloadGrouping } = useFetch<GroupingState>('/api/grouping', fetchOptions)
const { data: episodesDoc, error: episodesError } = useFetch<EpisodesFile | null>('/api/episodes', fetchOptions)

const loadError = computed(() => proposalError.value ?? groupingError.value ?? episodesError.value ?? null)
const loading = computed(() => !proposalState.value || !grouping.value || episodesDoc.value === undefined)
const episodes = computed(() => new Map<string, Episode>((episodesDoc.value?.episodes ?? []).map(e => [e.guid, e])))

const openProposal = computed(() => {
  const state = proposalState.value
  return state?.proposal ? (state as ProposalState & { proposal: StoredProposal }) : null
})

const unassignedCount = computed(() => grouping.value?.grouping.unassigned.length ?? 0)
const hasPlaylists = computed(() => (grouping.value?.grouping.playlists.length ?? 0) > 0)

const mode = ref<ProposalMode>('full')
// Default to incremental once there are playlists and new episodes to place.
watch(grouping, (value) => {
  if (value && value.grouping.playlists.length && value.grouping.unassigned.length) mode.value = 'incremental'
}, { once: true })

const modeItems = computed(() => [
  {
    label: 'Full regroup',
    value: 'full',
    description: `Group all ${episodesDoc.value?.count ?? ''} episodes from scratch. Existing playlist ids are reused where the topic matches.`
  },
  {
    label: 'New episodes only',
    value: 'incremental',
    description: !hasPlaylists.value
      ? 'Needs existing playlists. Start with a full regroup.'
      : unassignedCount.value
        ? `Place the ${unassignedCount.value} unassigned episodes into your existing playlists.`
        : 'Nothing to do: every episode is placed or excluded.',
    disabled: !unassignedCount.value || !hasPlaylists.value
  }
])

function onProposed(state: ProposalState) {
  proposalState.value = state
}

async function onAccepted() {
  await Promise.all([reloadProposal(), reloadGrouping()])
  await navigateTo('/playlists')
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Grouping">
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
          title="Could not load the grouping"
          :description="errorMessage(loadError)"
          :actions="[{ label: 'Retry', color: 'neutral', variant: 'outline', onClick: () => { reloadProposal(); reloadGrouping() } }]"
        />

        <div v-else-if="loading" class="flex justify-center py-12">
          <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-muted" />
        </div>

        <div v-else class="mx-auto w-full max-w-4xl space-y-6">
          <GroupingProposalReview
            v-if="openProposal && grouping"
            :proposal-state="openProposal"
            :grouping="grouping"
            :episodes="episodes"
            @accepted="onAccepted"
            @discarded="reloadProposal"
          />

          <template v-else>
            <p class="text-sm text-muted">
              Generate a new grouping and review it before anything changes. The result is always a proposal,
              shown as a diff against your current playlists. You accept all of it, some playlists, or none.
            </p>

            <UCard>
              <template #header>
                <h2 class="font-semibold">
                  What to group
                </h2>
              </template>
              <URadioGroup v-model="mode" :items="modeItems" />
            </UCard>

            <UCard>
              <template #header>
                <h2 class="font-semibold">
                  AI provider
                </h2>
              </template>
              <GroupingAiMethod :mode="mode" @proposed="reloadProposal" />
            </UCard>

            <UCard>
              <template #header>
                <h2 class="font-semibold">
                  Manual: copy &amp; paste into any chatbot (free)
                </h2>
              </template>
              <GroupingManualMethod :mode="mode" @proposed="onProposed" />
            </UCard>
          </template>
        </div>
      </ClientOnly>
    </template>
  </UDashboardPanel>
</template>
