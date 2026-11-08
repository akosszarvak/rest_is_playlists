<script setup lang="ts">
import { MAX_DESCRIPTION_LENGTH, type Playlist } from '#shared/grouping'
import type { PlaylistDetails } from '#shared/grouping-ops'

const props = defineProps<{
  title: string
  submitLabel: string
  /** Initial values; omit for a new playlist. */
  initial?: PlaylistDetails
  /** Id of the playlist being edited, so it can't be its own parent. */
  editingId?: string
  playlists: Playlist[]
}>()

const emit = defineEmits<{ submit: [details: PlaylistDetails] }>()

const NO_PARENT = '__none__'
const open = defineModel<boolean>('open', { required: true })

const form = reactive({
  name: '',
  description: '',
  kind: 'broad' as Playlist['kind'],
  // Select items can't use null as a value, so "no parent" is a sentinel string.
  parent: NO_PARENT as string,
  eraStart: '',
  eraEnd: ''
})
const error = ref('')

watch(open, (isOpen) => {
  if (!isOpen) return
  const initial = props.initial
  form.name = initial?.name ?? ''
  form.description = initial?.description ?? ''
  form.kind = initial?.kind ?? 'broad'
  form.parent = initial?.parent ?? NO_PARENT
  form.eraStart = initial?.era ? String(initial.era.start) : ''
  form.eraEnd = initial?.era ? String(initial.era.end) : ''
  error.value = ''
}, { immediate: true })

const kindItems = [
  { label: 'Broad', value: 'broad', description: 'An era or theme bucket, e.g. Ancient Rome.' },
  { label: 'Series', value: 'series', description: 'A multi-part series that also sits inside a broad playlist.' }
]

const parentItems = computed(() => [
  { label: 'No parent', value: NO_PARENT },
  ...props.playlists
    .filter(p => p.kind === 'broad' && p.id !== props.editingId)
    .map(p => ({ label: p.name, value: p.id }))
])

/** A number input's v-model can hold a number at runtime, despite the string type. */
function toYear(value: string | number | null | undefined): number | null {
  const text = String(value ?? '').trim()
  if (text === '') return null
  const n = Number(text)
  return Number.isInteger(n) ? n : Number.NaN
}

function submit() {
  const name = form.name.trim()
  if (!name) return void (error.value = 'Name is required.')
  if (form.description.length > MAX_DESCRIPTION_LENGTH) {
    return void (error.value = `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`)
  }
  const start = toYear(form.eraStart)
  const end = toYear(form.eraEnd)
  if (Number.isNaN(start) || Number.isNaN(end)) return void (error.value = 'Era years must be whole numbers.')
  if ((start === null) !== (end === null)) return void (error.value = 'Give both era years, or neither.')
  if (start !== null && end !== null && start > end) return void (error.value = 'Era start must not be after its end.')

  emit('submit', {
    name,
    description: form.description.trim(),
    kind: form.kind,
    parent: form.kind === 'series' && form.parent !== NO_PARENT ? form.parent : null,
    era: start !== null && end !== null ? { start, end } : null
  })
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="title">
    <template #body>
      <form id="playlist-details" class="space-y-4" @submit.prevent="submit">
        <UFormField label="Name" required>
          <UInput v-model="form.name" autofocus class="w-full" />
        </UFormField>

        <UFormField label="Description" :help="`${form.description.length}/${MAX_DESCRIPTION_LENGTH} characters. Used as the Spotify playlist description.`">
          <UTextarea v-model="form.description" :rows="3" autoresize class="w-full" />
        </UFormField>

        <UFormField label="Kind">
          <URadioGroup v-model="form.kind" :items="kindItems" />
        </UFormField>

        <UFormField v-if="form.kind === 'series'" label="Parent playlist" help="The broad playlist that should also contain every episode of this series.">
          <USelect v-model="form.parent" :items="parentItems" class="w-full" />
        </UFormField>

        <UFormField label="Era (optional)" help="Years the playlist covers. Use negative numbers for BC, e.g. -753 to 476.">
          <div class="flex items-center gap-2">
            <UInput v-model="form.eraStart" type="number" placeholder="Start" class="w-32" />
            <span class="text-muted">to</span>
            <UInput v-model="form.eraEnd" type="number" placeholder="End" class="w-32" />
          </div>
        </UFormField>

        <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-x" :description="error" />
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
        <UButton :label="submitLabel" type="submit" form="playlist-details" />
      </div>
    </template>
  </UModal>
</template>
