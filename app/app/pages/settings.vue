<script setup lang="ts">
import type { AiProvider, SettingsUpdate, SettingsView } from '#shared/settings'

const SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:3000/api/spotify/callback'

const toast = useToast()
const { data: settings, error: loadError, refresh } = await useFetch<SettingsView>('/api/settings')

/** Editable copy of the settings. Secret inputs stay empty unless the user types a new key. */
const form = reactive({
  spotifyClientId: '',
  namePrefix: '',
  visibility: 'private' as 'private' | 'public',
  anthropicKey: '',
  anthropicModel: '',
  geminiKey: '',
  geminiModel: ''
})

function resetForm(view: SettingsView) {
  form.spotifyClientId = view.spotify.clientId.value
  form.namePrefix = view.playlists.namePrefix.value
  form.visibility = view.playlists.visibility.value
  form.anthropicKey = ''
  form.anthropicModel = view.anthropic.model.value
  form.geminiKey = ''
  form.geminiModel = view.gemini.model.value
}

watch(settings, (view) => { if (view) resetForm(view) }, { immediate: true })

/** Only the fields the user actually changed (and that aren't locked by .env). */
const changes = computed<SettingsUpdate>(() => {
  const view = settings.value
  if (!view) return {}
  const update: SettingsUpdate = {}

  if (view.spotify.clientId.source === 'file' && form.spotifyClientId.trim() !== view.spotify.clientId.value) {
    update.spotify = { clientId: form.spotifyClientId.trim() }
  }

  const playlists: NonNullable<SettingsUpdate['playlists']> = {}
  if (form.namePrefix !== view.playlists.namePrefix.value) playlists.namePrefix = form.namePrefix
  if (form.visibility !== view.playlists.visibility.value) playlists.visibility = form.visibility
  if (Object.keys(playlists).length) update.playlists = playlists

  for (const provider of ['anthropic', 'gemini'] as const) {
    const key = form[`${provider}Key`].trim()
    const model = form[`${provider}Model`].trim()
    const part: NonNullable<SettingsUpdate[typeof provider]> = {}
    if (key && view[provider].apiKey.source === 'file') part.apiKey = key
    if (view[provider].model.source === 'file' && model !== view[provider].model.value) part.model = model
    if (Object.keys(part).length) update[provider] = part
  }
  return update
})

const dirty = computed(() => Object.keys(changes.value).length > 0)
const saving = ref(false)

async function save(update: SettingsUpdate = changes.value, successMessage = 'Settings saved') {
  saving.value = true
  try {
    settings.value = await $fetch<SettingsView>('/api/settings', { method: 'PUT', body: update })
    toast.add({ title: successMessage, color: 'success', icon: 'i-lucide-check' })
  } catch (error) {
    toast.add({ title: 'Could not save settings', description: errorMessage(error), color: 'error', icon: 'i-lucide-circle-x' })
  } finally {
    saving.value = false
  }
}

function removeKey(provider: AiProvider) {
  save({ [provider]: { apiKey: null } }, 'API key removed')
}

function discard() {
  if (settings.value) resetForm(settings.value)
}

const visibilityItems = [
  { label: 'Private', value: 'private' },
  { label: 'Public', value: 'public' }
]

const prefixPreview = computed(() => `${form.namePrefix}Ancient Rome`)
const clientIdValid = computed(() => /^([0-9a-f]{32})?$/i.test(form.spotifyClientId.trim()))
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Settings">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton v-if="dirty" label="Discard" color="neutral" variant="ghost" @click="discard" />
          <UButton label="Save" icon="i-lucide-save" :loading="saving" :disabled="!dirty || !clientIdValid" @click="save()" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert
        v-if="loadError"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Could not load settings"
        :description="errorMessage(loadError)"
        :actions="[{ label: 'Retry', color: 'neutral', variant: 'outline', onClick: () => refresh() }]"
      />

      <div v-else-if="settings" class="mx-auto w-full max-w-3xl space-y-6">
        <p class="text-sm text-muted">
          Settings are stored in <code>.data/settings.json</code> on this machine and never committed.
          Keys stay on the server and are never sent back to the browser.
        </p>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <h2 class="font-semibold">
                Spotify
              </h2>
              <UBadge v-if="settings.spotify.clientId.value" color="success" variant="subtle" label="Client ID saved" />
              <UBadge v-else color="warning" variant="subtle" label="Needed for export" />
            </div>
            <p class="mt-1 text-sm text-muted">
              Create a free app in the
              <ULink to="https://developer.spotify.com/dashboard" target="_blank" class="text-primary">Spotify developer dashboard</ULink>
              and add this redirect URI: <code>{{ SPOTIFY_REDIRECT_URI }}</code>. No client secret is needed.
              You can test the connection when you log in on the Export page.
            </p>
          </template>

          <UFormField
            label="Client ID"
            name="spotify.clientId"
            :error="clientIdValid ? undefined : 'A Spotify Client ID is 32 hexadecimal characters.'"
            :help="settings?.spotify.clientId.source === 'env' ? 'Set in .env (RIP_SPOTIFY_CLIENT_ID). Edit it there.' : undefined"
          >
            <UInput
              v-model="form.spotifyClientId"
              placeholder="32-character Client ID"
              autocomplete="off"
              :disabled="settings?.spotify.clientId.source === 'env'"
              class="w-full font-mono"
            />
          </UFormField>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-semibold">
              Playlists
            </h2>
            <p class="mt-1 text-sm text-muted">
              How exported playlists are named and shared on Spotify.
            </p>
          </template>

          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Name prefix" name="playlists.namePrefix" :help="`Example: ${prefixPreview}`">
              <UInput v-model="form.namePrefix" class="w-full" />
            </UFormField>
            <UFormField label="Visibility" name="playlists.visibility">
              <USelect v-model="form.visibility" :items="visibilityItems" class="w-full" />
            </UFormField>
          </div>
        </UCard>

        <SettingsProviderCard
          v-if="settings"
          v-model:new-key="form.anthropicKey"
          v-model:model-name="form.anthropicModel"
          provider="anthropic"
          title="Anthropic Claude (optional, paid)"
          key-placeholder="sk-ant-…"
          :api-key="settings.anthropic.apiKey"
          :model="settings.anthropic.model"
          :dirty="Boolean(changes.anthropic)"
          @remove="removeKey('anthropic')"
        >
          <template #description>
            Groups episodes with the Claude API. Usage is billed to your Anthropic account. Get a key in the
            <ULink to="https://platform.claude.com/settings/keys" target="_blank" class="text-primary">Claude Console</ULink>.
          </template>
        </SettingsProviderCard>

        <SettingsProviderCard
          v-if="settings"
          v-model:new-key="form.geminiKey"
          v-model:model-name="form.geminiModel"
          provider="gemini"
          title="Google Gemini (optional, free tier)"
          key-placeholder="AIza…"
          :api-key="settings.gemini.apiKey"
          :model="settings.gemini.model"
          :dirty="Boolean(changes.gemini)"
          @remove="removeKey('gemini')"
        >
          <template #description>
            Free with a key from
            <ULink to="https://aistudio.google.com/apikey" target="_blank" class="text-primary">Google AI Studio</ULink>.
            On the free tier, Google may use prompts to improve its products. The prompts contain only public episode metadata.
          </template>
        </SettingsProviderCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
