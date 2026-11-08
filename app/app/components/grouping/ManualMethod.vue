<script setup lang="ts">
import type { BuiltPrompt, DetailLevel, ProposalMode, ProposalState } from '#shared/proposal'

const props = defineProps<{ mode: ProposalMode }>()
const emit = defineEmits<{ proposed: [state: ProposalState] }>()

const toast = useToast()

const detail = ref<DetailLevel>('short')
const detailItems = [
  { label: 'Short descriptions (recommended)', value: 'short' },
  { label: 'Longer descriptions (best results, largest)', value: 'full' },
  { label: 'Titles only (smallest)', value: 'titles' }
]

const built = ref<BuiltPrompt | null>(null)
const building = ref(false)
const showPrompt = ref(false)

// A different mode or detail level needs a new prompt.
watch(() => [props.mode, detail.value], () => { built.value = null; showPrompt.value = false })

async function buildPrompt(): Promise<BuiltPrompt | null> {
  building.value = true
  try {
    built.value = await $fetch<BuiltPrompt>('/api/grouping/prompt', { method: 'POST', body: { mode: props.mode, detail: detail.value } })
    return built.value
  } catch (error) {
    toast.add({ title: 'Could not build the prompt', description: errorMessage(error), color: 'error', icon: 'i-lucide-circle-x' })
    return null
  } finally {
    building.value = false
  }
}

async function copyPrompt() {
  const result = built.value ?? await buildPrompt()
  if (!result) return
  try {
    await navigator.clipboard.writeText(result.prompt)
    toast.add({ title: 'Prompt copied', description: `${result.episodeCount} episodes, about ${formatTokens(result.approxTokens)} tokens.`, color: 'success', icon: 'i-lucide-clipboard-check' })
  } catch {
    showPrompt.value = true
    toast.add({ title: 'Could not copy automatically', description: 'Select the prompt below and copy it, or download it as a file.', color: 'warning' })
  }
}

async function downloadPrompt() {
  const result = built.value ?? await buildPrompt()
  if (!result) return
  const url = URL.createObjectURL(new Blob([result.prompt], { type: 'text/plain' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: `rest-is-playlists-prompt-${props.mode}.txt` })
  link.click()
  URL.revokeObjectURL(url)
}

async function togglePrompt() {
  if (showPrompt.value) {
    showPrompt.value = false
    return
  }
  if (built.value || await buildPrompt()) showPrompt.value = true
}

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : String(tokens)
}

const answer = ref('')
const submitting = ref(false)
const answerError = ref('')

async function submitAnswer() {
  submitting.value = true
  answerError.value = ''
  try {
    const state = await $fetch<ProposalState>('/api/grouping/proposal/manual', { method: 'POST', body: { mode: props.mode, text: answer.value } })
    answer.value = ''
    emit('proposed', state)
  } catch (error) {
    answerError.value = errorMessage(error)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <section class="space-y-3">
      <h3 class="font-medium">
        1. Copy the prompt
      </h3>
      <p class="text-sm text-muted">
        The prompt holds the grouping rules, the answer format and the episode list. Paste it into any chatbot
        with a large context window (for example Claude, Gemini or ChatGPT). Smaller prompts are cheaper and fit
        more chatbots; longer descriptions help the chatbot judge what each episode is about.
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <USelect v-model="detail" :items="detailItems" class="w-80" />
        <UButton label="Copy prompt" icon="i-lucide-clipboard-copy" :loading="building" @click="copyPrompt" />
        <UButton label="Download" icon="i-lucide-download" color="neutral" variant="outline" :disabled="building" @click="downloadPrompt" />
        <UButton
          :label="showPrompt ? 'Hide prompt' : 'Show prompt'"
          color="neutral"
          variant="ghost"
          :disabled="building"
          @click="togglePrompt"
        />
      </div>
      <p v-if="built" class="text-sm text-muted">
        {{ built.episodeCount }} episodes · about {{ formatTokens(built.approxTokens) }} tokens
      </p>
      <UTextarea v-if="showPrompt && built" :model-value="built.prompt" readonly :rows="12" class="w-full font-mono text-xs" />
    </section>

    <section class="space-y-3">
      <h3 class="font-medium">
        2. Paste the answer
      </h3>
      <p class="text-sm text-muted">
        Paste the chatbot's whole reply. Extra text and code fences are fine. Nothing is saved yet:
        you'll review the changes first.
      </p>
      <UTextarea
        v-model="answer"
        :rows="8"
        placeholder="{ &quot;playlists&quot;: [ … ] }"
        class="w-full font-mono text-xs"
      />
      <UAlert v-if="answerError" color="error" variant="subtle" icon="i-lucide-circle-x" title="Could not read the answer" :description="answerError" />
      <UButton label="Review proposal" icon="i-lucide-git-compare" :loading="submitting" :disabled="!answer.trim()" @click="submitAnswer" />
    </section>
  </div>
</template>
