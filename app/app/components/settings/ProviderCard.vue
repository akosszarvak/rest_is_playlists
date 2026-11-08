<script setup lang="ts">
import type { AiProvider, ConnectionTestResult, FieldView, SecretView } from '#shared/settings'

const props = defineProps<{
  provider: AiProvider
  title: string
  apiKey: SecretView
  model: FieldView
  keyPlaceholder: string
  /** True while this card has unsaved edits, so the test would use stale values. */
  dirty: boolean
}>()

const emit = defineEmits<{ remove: [] }>()

const newKey = defineModel<string>('newKey', { required: true })
const modelName = defineModel<string>('modelName', { required: true })

const testing = ref(false)
const result = ref<ConnectionTestResult | null>(null)

const keyPlaceholderText = computed(() => {
  if (!props.apiKey.set) return props.keyPlaceholder
  return props.apiKey.hint ? `Saved (${props.apiKey.hint}). Type to replace.` : 'Saved. Type to replace.'
})

async function test() {
  testing.value = true
  result.value = null
  try {
    result.value = await $fetch<ConnectionTestResult>(`/api/settings/test/${props.provider}`, { method: 'POST' })
  } catch (error) {
    result.value = { ok: false, message: errorMessage(error) }
  } finally {
    testing.value = false
  }
}

// A new key or model makes the old test result meaningless.
watch(() => [props.apiKey.hint, props.model.value], () => { result.value = null })
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <h2 class="font-semibold">
          {{ title }}
        </h2>
        <UBadge v-if="apiKey.set" color="success" variant="subtle" label="Key saved" />
        <UBadge v-else color="neutral" variant="subtle" label="Not set" />
      </div>
      <p class="mt-1 text-sm text-muted">
        <slot name="description" />
      </p>
    </template>

    <div class="space-y-4">
      <UFormField
        label="API key"
        :name="`${provider}.apiKey`"
        :help="apiKey.source === 'env' ? `Set in .env (RIP_${provider.toUpperCase()}_API_KEY). Edit it there.` : undefined"
      >
        <div class="flex gap-2">
          <UInput
            v-model="newKey"
            type="password"
            autocomplete="off"
            :placeholder="keyPlaceholderText"
            :disabled="apiKey.source === 'env'"
            class="flex-1"
          />
          <UButton
            v-if="apiKey.set && apiKey.source === 'file'"
            label="Remove"
            color="error"
            variant="soft"
            icon="i-lucide-trash-2"
            @click="emit('remove')"
          />
        </div>
      </UFormField>

      <UFormField
        label="Model"
        :name="`${provider}.model`"
        :help="model.source === 'env' ? `Set in .env (RIP_${provider.toUpperCase()}_MODEL).` : undefined"
      >
        <UInput v-model="modelName" :disabled="model.source === 'env'" class="w-full" />
      </UFormField>

      <div class="flex flex-wrap items-center gap-3">
        <UButton
          label="Test connection"
          icon="i-lucide-plug-zap"
          color="neutral"
          variant="outline"
          :loading="testing"
          :disabled="!apiKey.set || dirty"
          @click="test"
        />
        <span v-if="dirty" class="text-sm text-muted">Save your changes before testing.</span>
      </div>

      <UAlert
        v-if="result"
        :color="result.ok ? 'success' : 'error'"
        variant="subtle"
        :icon="result.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
        :description="result.message"
      />
    </div>
  </UCard>
</template>
