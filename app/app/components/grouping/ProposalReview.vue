<script setup lang="ts">
import type { Episode } from '#shared/episodes'
import { EXCLUDE_REASON_LABELS, type GroupingState } from '#shared/grouping'
import { diffGroupings, type PlaylistDiff, type ProposalState, type StoredProposal } from '#shared/proposal'

const props = defineProps<{
  proposalState: ProposalState & { proposal: StoredProposal }
  grouping: GroupingState
  episodes: Map<string, Episode>
}>()

const emit = defineEmits<{ accepted: [], discarded: [] }>()
const toast = useToast()

const proposal = computed(() => props.proposalState.proposal)
const current = computed(() => ({ playlists: props.grouping.grouping.playlists, excluded: props.grouping.grouping.excluded }))
const diff = computed(() => diffGroupings(current.value, proposal.value.content))

const changed = computed(() => diff.value.playlists.filter(p => p.status !== 'unchanged'))
const unchanged = computed(() => diff.value.playlists.filter(p => p.status === 'unchanged'))
const exclusionChanges = computed(() => diff.value.exclusions.added.length + diff.value.exclusions.removed.length + diff.value.exclusions.changed.length)

// Everything is selected by default; the user can untick playlists to skip them.
const selected = ref(new Set<string>())
const acceptExclusions = ref(true)
watch(changed, (list) => { selected.value = new Set(list.map(p => p.id)) }, { immediate: true })

function toggle(id: string, value: boolean | 'indeterminate') {
  const next = new Set(selected.value)
  if (value === true) next.add(id)
  else next.delete(id)
  selected.value = next
}

const expanded = ref(new Set<string>())
function toggleExpanded(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

const showUnchanged = ref(false)

const counts = computed(() => ({
  new: changed.value.filter(p => p.status === 'new').length,
  changed: changed.value.filter(p => p.status === 'changed').length,
  removed: changed.value.filter(p => p.status === 'removed').length
}))

const selectionCount = computed(() => selected.value.size + (acceptExclusions.value && exclusionChanges.value ? 1 : 0))
const totalCount = computed(() => changed.value.length + (exclusionChanges.value ? 1 : 0))

const STATUS: Record<PlaylistDiff['status'], { label: string, color: 'success' | 'warning' | 'error' | 'neutral' }> = {
  new: { label: 'New', color: 'success' },
  changed: { label: 'Changed', color: 'warning' },
  removed: { label: 'Removed', color: 'error' },
  unchanged: { label: 'Unchanged', color: 'neutral' }
}

const title = (guid: string) => props.episodes.get(guid)?.title ?? `Unknown episode (${guid})`

function summary(p: PlaylistDiff): string {
  const parts: string[] = []
  if (p.status === 'new') parts.push(`${p.added.length} episodes`)
  if (p.status === 'removed') parts.push(`${p.removed.length} episodes leave this playlist`)
  if (p.status === 'changed') {
    if (p.added.length) parts.push(`+${p.added.length}`)
    if (p.removed.length) parts.push(`−${p.removed.length}`)
    if (p.reordered) parts.push('new order')
    if (p.detailChanges.length) parts.push(`${p.detailChanges.join(', ')} changed`)
  }
  return parts.join(' · ')
}

const accepting = ref(false)

async function accept(all: boolean) {
  accepting.value = true
  try {
    const playlists = all ? changed.value.map(p => p.id) : [...selected.value]
    const result = await $fetch<{ notes: string[] }>('/api/grouping/proposal/accept', {
      method: 'POST',
      body: { revision: props.grouping.revision, playlists, exclusions: all || acceptExclusions.value }
    })
    toast.add({
      title: 'Proposal accepted',
      description: [
        props.grouping.exists ? 'Saved to data/grouping.json. The previous version is in .data/backups/.' : 'Saved to data/grouping.json.',
        ...result.notes
      ].join(' '),
      color: 'success',
      icon: 'i-lucide-check'
    })
    emit('accepted')
  } catch (error) {
    toast.add({ title: 'Could not accept the proposal', description: errorMessage(error), color: 'error', icon: 'i-lucide-circle-x' })
  } finally {
    accepting.value = false
  }
}

const discarding = ref(false)
async function discard() {
  discarding.value = true
  try {
    await $fetch('/api/grouping/proposal', { method: 'DELETE' })
    emit('discarded')
  } catch (error) {
    toast.add({ title: 'Could not discard', description: errorMessage(error), color: 'error' })
  } finally {
    discarding.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">
          Review the proposal
        </h2>
        <p class="text-sm text-muted">
          {{ proposal.mode === 'full' ? 'Full regroup' : 'New episodes only' }} · {{ proposal.method }} method ·
          created {{ formatDateTime(proposal.createdAt) }}
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton label="Discard" color="neutral" variant="ghost" icon="i-lucide-x" :loading="discarding" @click="discard" />
        <UButton
          :label="`Accept selected (${selectionCount} of ${totalCount})`"
          color="neutral"
          variant="outline"
          :disabled="!selectionCount || !diff.hasChanges"
          :loading="accepting"
          @click="accept(false)"
        />
        <UButton label="Accept all" icon="i-lucide-check" :disabled="!diff.hasChanges" :loading="accepting" @click="accept(true)" />
      </div>
    </div>

    <UAlert
      v-if="proposalState.stale"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="The playlists changed since this proposal was made"
      :description="proposal.mode === 'incremental'
        ? 'This proposal was built on an older version of your playlists. Accepting a playlist replaces it with the proposal\'s version, which may undo edits made since. Check the changes below, or discard and create a new proposal.'
        : 'The changes below compare against your current playlists, so they are accurate. Just make sure you still want them.'"
    />

    <UAlert
      v-if="proposal.warnings.length"
      color="warning"
      variant="subtle"
      icon="i-lucide-info"
      :title="`${proposal.warnings.length} note(s) about the answer`"
    >
      <template #description>
        <ul class="list-disc space-y-0.5 pl-4">
          <li v-for="warning in proposal.warnings" :key="warning">
            {{ warning }}
          </li>
        </ul>
      </template>
    </UAlert>

    <UAlert v-if="!diff.hasChanges" color="info" variant="subtle" icon="i-lucide-info" title="No changes" description="The proposal is identical to your current playlists. Discard it." />

    <div v-else class="flex flex-wrap gap-2 text-sm">
      <UBadge v-if="counts.new" :label="`${counts.new} new playlists`" color="success" variant="subtle" />
      <UBadge v-if="counts.changed" :label="`${counts.changed} changed`" color="warning" variant="subtle" />
      <UBadge v-if="counts.removed" :label="`${counts.removed} removed`" color="error" variant="subtle" />
      <UBadge v-if="diff.episodes.placed.length" :label="`${diff.episodes.placed.length} episodes newly placed`" color="neutral" variant="subtle" />
      <UBadge v-if="diff.episodes.moved.length" :label="`${diff.episodes.moved.length} episodes moved`" color="neutral" variant="subtle" />
      <UBadge v-if="diff.episodes.unplaced.length" :label="`${diff.episodes.unplaced.length} episodes become unassigned`" color="error" variant="subtle" />
    </div>

    <ul class="divide-y divide-default rounded-md border border-default">
      <li v-for="p in changed" :key="p.id" class="px-3 py-2">
        <div class="flex items-center gap-3">
          <UCheckbox :model-value="selected.has(p.id)" :aria-label="`Accept ${p.name}`" @update:model-value="v => toggle(p.id, v)" />
          <UBadge :label="STATUS[p.status].label" :color="STATUS[p.status].color" variant="subtle" size="sm" class="w-20 justify-center" />
          <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" @click="toggleExpanded(p.id)">
            <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-muted transition-transform" :class="{ 'rotate-90': expanded.has(p.id) }" />
            <span class="truncate font-medium">{{ p.name }}</span>
            <span v-if="(p.proposed ?? p.current)?.kind === 'series'" class="text-xs text-muted">series</span>
            <span class="ml-auto shrink-0 text-sm text-muted">{{ summary(p) }}</span>
          </button>
        </div>

        <div v-if="expanded.has(p.id)" class="mt-2 ml-10 space-y-2 text-sm">
          <p v-if="p.proposed?.description" class="text-muted">
            {{ p.proposed.description }}
          </p>
          <p v-if="p.proposed?.era" class="text-muted">
            Era: {{ formatEra(p.proposed.era) }}
          </p>
          <p v-if="p.detailChanges.includes('name') && p.current" class="text-muted">
            Renamed from "{{ p.current.name }}"
          </p>
          <!-- Full proposed order whenever positions matter, with added episodes highlighted. -->
          <ol v-if="p.proposed && (p.status === 'new' || p.reordered || p.added.length)" class="list-decimal space-y-0.5 pl-6">
            <li v-for="guid in p.proposed!.episodes" :key="guid" :class="p.added.includes(guid) && p.status !== 'new' ? 'text-success' : ''">
              {{ title(guid) }}
            </li>
          </ol>
          <ul v-else class="space-y-0.5">
            <li v-for="guid in p.added" :key="`+${guid}`" class="text-success">
              + {{ title(guid) }}
            </li>
          </ul>
          <ul class="space-y-0.5">
            <li v-for="guid in p.removed" :key="`-${guid}`" class="text-error">
              − {{ title(guid) }}
            </li>
          </ul>
        </div>
      </li>

      <li v-if="exclusionChanges" class="px-3 py-2">
        <div class="flex items-center gap-3">
          <UCheckbox v-model="acceptExclusions" aria-label="Accept exclusion changes" />
          <UBadge label="Exclusions" color="neutral" variant="subtle" size="sm" class="w-20 justify-center" />
          <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" @click="toggleExpanded('__excluded')">
            <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-muted transition-transform" :class="{ 'rotate-90': expanded.has('__excluded') }" />
            <span class="font-medium">Excluded episodes</span>
            <span class="ml-auto text-sm text-muted">
              +{{ diff.exclusions.added.length }} · −{{ diff.exclusions.removed.length }}<template v-if="diff.exclusions.changed.length"> · {{ diff.exclusions.changed.length }} new reason</template>
            </span>
          </button>
        </div>
        <ul v-if="expanded.has('__excluded')" class="mt-2 ml-10 space-y-0.5 text-sm">
          <li v-for="e in diff.exclusions.added" :key="`+${e.guid}`" class="text-success">
            + {{ title(e.guid) }} ({{ EXCLUDE_REASON_LABELS[e.reason] }})
          </li>
          <li v-for="e in diff.exclusions.changed" :key="`~${e.guid}`" class="text-warning">
            ~ {{ title(e.guid) }} ({{ EXCLUDE_REASON_LABELS[e.reason] }})
          </li>
          <li v-for="guid in diff.exclusions.removed" :key="`-${guid}`" class="text-error">
            − {{ title(guid) }} (included again)
          </li>
        </ul>
      </li>
    </ul>

    <div v-if="unchanged.length">
      <UButton
        :label="showUnchanged ? 'Hide unchanged playlists' : `Show ${unchanged.length} unchanged playlists`"
        color="neutral"
        variant="ghost"
        size="sm"
        @click="showUnchanged = !showUnchanged"
      />
      <p v-if="showUnchanged" class="mt-1 text-sm text-muted">
        {{ unchanged.map(p => p.name).join(', ') }}
      </p>
    </div>
  </div>
</template>
