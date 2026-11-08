<script setup lang="ts">
/** One episode that wasn't found on Spotify, with a field to paste its Spotify link. */
const props = defineProps<{ guid: string, title: string, releaseDate: string }>()
const emit = defineEmits<{ matched: [episodeName: string] }>()

const link = ref('')
const error = ref('')
const saving = ref(false)

const searchUrl = computed(() => `https://open.spotify.com/search/${encodeURIComponent(props.title.replace(/^\d+[.:]\s*/, ''))}/episodes`)

async function save() {
  saving.value = true
  error.value = ''
  try {
    const result = await $fetch<{ episodeName: string }>('/api/spotify/match/manual', { method: 'POST', body: { guid: props.guid, link: link.value } })
    link.value = ''
    emit('matched', result.episodeName)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <li class="space-y-1 px-3 py-2">
    <div class="flex flex-wrap items-center gap-2">
      <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ title }}</span>
      <span class="text-xs text-muted">{{ formatDate(releaseDate) }}</span>
      <ULink :to="searchUrl" target="_blank" class="text-xs text-primary">
        Search on Spotify
      </ULink>
    </div>
    <form class="flex gap-2" @submit.prevent="save">
      <UInput v-model="link" placeholder="https://open.spotify.com/episode/…" size="sm" class="flex-1" />
      <UButton label="Save" type="submit" size="sm" :disabled="!link.trim()" :loading="saving" />
    </form>
    <p v-if="error" class="text-xs text-error">
      {{ error }}
    </p>
  </li>
</template>
