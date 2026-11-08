<script setup lang="ts">
import type { RunEstimate } from '#shared/ai-pipeline'
import type { RunStatus } from '#shared/ai-run'
import type { ProposalMode } from '#shared/proposal'
import type { AiProvider, SettingsView } from '#shared/settings'

const props = defineProps<{ mode: ProposalMode }>()
const emit = defineEmits<{ proposed: [] }>()

const toast = useToast()

const { data: settings } = useFetch<SettingsView>('/api/settings', { server: false, lazy: true })

const PROVIDERS: { id: AiProvider, name: string, note: string }[] = [
  { id: 'gemini', name: 'Google Gemini', note: 'Free tier. Free keys allow only a few requests per minute, so a run can take a few minutes.' },
  { id: 'anthropic', name: 'Anthropic Claude', note: 'Paid: usage is billed to your Anthropic account.' }
]

// --- Estimate -------------------------------------------------------------------------------

const estimate = ref<RunEstimate | null>(null)
const estimateError = ref('')
watch(() => props.mode, async (mode) => {
  estimate.value = null
  estimateError.value = ''
  try {
    estimate.value = await $fetch<RunEstimate>('/api/grouping/run/estimate', { method: 'POST', body: { mode } })
  } catch (error) {
    estimateError.value = errorMessage(error)
  }
}, { immediate: true })

const formatK = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n))

// --- Run status (polled while running) ------------------------------------------------------

const status = ref<RunStatus | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

async function poll() {
  clearTimeout(timer)
  try {
    const result = await $fetch<{ status: RunStatus | null }>('/api/grouping/run')
    const wasRunning = status.value?.state === 'running'
    status.value = result.status
    if (result.status?.state === 'running') {
      timer = setTimeout(poll, 1000)
    } else if (wasRunning && result.status?.state === 'done') {
      emit('proposed')
    }
  } catch {
    timer = setTimeout(poll, 3000)
  }
}

onMounted(poll) // picks up a run that is still going after a page reload
onBeforeUnmount(() => clearTimeout(timer))

const running = computed(() => status.value?.state === 'running')
const starting = ref<AiProvider | null>(null)

async function start(provider: AiProvider) {
  starting.value = provider
  try {
    const result = await $fetch<{ status: RunStatus }>('/api/grouping/run', { method: 'POST', body: { provider, mode: props.mode } })
    status.value = result.status
    timer = setTimeout(poll, 1000)
  } catch (error) {
    toast.add({ title: 'Could not start', description: errorMessage(error), color: 'error', icon: 'i-lucide-circle-x' })
  } finally {
    starting.value = null
  }
}

async function cancel() {
  try {
    const result = await $fetch<{ status: RunStatus | null }>('/api/grouping/run', { method: 'DELETE' })
    status.value = result.status
    poll()
  } catch (error) {
    toast.add({ title: 'Could not cancel', description: errorMessage(error), color: 'error' })
  }
}

const progress = computed(() => {
  const s = status.value
  return s && s.totalSteps ? Math.round((s.step / s.totalSteps) * 100) : 0
})
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-muted">
      The app sends the episodes in batches and turns the answers into a proposal for you to review.
      <template v-if="estimate">
        This run takes about {{ estimate.requests }} request{{ estimate.requests === 1 ? '' : 's' }} and
        {{ formatK(estimate.approxInputTokens) }} input tokens in total.
      </template>
    </p>
    <UAlert v-if="estimateError" color="warning" variant="subtle" icon="i-lucide-info" :description="estimateError" />

    <!-- Progress of the current or last run -->
    <div v-if="status && (running || status.state !== 'done')" class="space-y-3 rounded-md border border-default p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-sm font-medium">
          <template v-if="!running">Last run: </template>{{ PROVIDERS.find(p => p.id === status!.provider)?.name }} · {{ status.model }} ·
          {{ status.mode === 'full' ? 'full regroup' : 'new episodes only' }}
        </span>
        <UButton v-if="running" label="Cancel" color="neutral" variant="outline" size="sm" icon="i-lucide-square" @click="cancel" />
      </div>
      <UProgress v-if="running" :model-value="progress" />
      <UAlert v-if="status.state === 'error'" color="error" variant="subtle" icon="i-lucide-circle-x" title="The run failed" :description="status.error ?? undefined" />
      <UAlert v-if="status.state === 'cancelled'" color="neutral" variant="subtle" icon="i-lucide-square" description="Cancelled. Nothing was saved." />
      <ul class="max-h-48 space-y-0.5 overflow-y-auto font-mono text-xs text-muted">
        <li v-for="(entry, i) in status.log" :key="i">
          {{ new Date(entry.at).toLocaleTimeString('en-GB') }} {{ entry.text }}
        </li>
      </ul>
      <p class="text-xs text-muted">
        {{ status.usage.requests }} request{{ status.usage.requests === 1 ? '' : 's' }} · {{ status.usage.input.toLocaleString('en') }} input and
        {{ status.usage.output.toLocaleString('en') }} output tokens so far
      </p>
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <div v-for="provider in PROVIDERS" :key="provider.id" class="flex flex-col gap-2 rounded-md border border-default p-3">
        <div class="flex items-center justify-between gap-2">
          <span class="font-medium">{{ provider.name }}</span>
          <UBadge
            v-if="settings"
            :label="settings[provider.id].apiKey.set ? 'Key saved' : 'No key'"
            :color="settings[provider.id].apiKey.set ? 'success' : 'neutral'"
            variant="subtle"
            size="sm"
          />
        </div>
        <p class="text-sm text-muted">
          {{ provider.note }}
        </p>
        <p v-if="settings" class="text-sm">
          Model: <code>{{ settings[provider.id].model.value }}</code>
        </p>
        <div class="mt-auto pt-1">
          <UButton
            v-if="settings && !settings[provider.id].apiKey.set"
            label="Add a key in Settings"
            to="/settings"
            color="neutral"
            variant="outline"
            size="sm"
          />
          <UButton
            v-else
            :label="`Run with ${provider.name.split(' ').at(-1)}`"
            icon="i-lucide-sparkles"
            size="sm"
            :loading="starting === provider.id"
            :disabled="running || !estimate"
            @click="start(provider.id)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
