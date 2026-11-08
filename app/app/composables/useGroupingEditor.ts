import type { InjectionKey } from 'vue'
import type { Episode, EpisodesFile } from '#shared/episodes'
import type { GroupingContent, GroupingState, Playlist } from '#shared/grouping'
import { computeUnassigned, findIssues, membership } from '#shared/grouping-ops'

const MAX_UNDO = 50

function contentOf(state: GroupingState): GroupingContent {
  // JSON round-trip: structuredClone rejects Vue's reactive proxies.
  return JSON.parse(JSON.stringify({ playlists: state.grouping.playlists, excluded: state.grouping.excluded }))
}

/**
 * Working copy of the grouping for the Playlists page. Edits are pure operations applied
 * locally (with undo); nothing touches data/grouping.json until `save()`.
 */
export function useGroupingEditor() {
  const toast = useToast()

  const { data: state, error: groupingError, refresh: reloadGrouping } = useFetch<GroupingState>('/api/grouping', {
    server: false,
    lazy: true
  })
  const { data: episodesDoc, error: episodesError } = useFetch<EpisodesFile | null>('/api/episodes', {
    server: false,
    lazy: true
  })

  const content = ref<GroupingContent | null>(null)
  const history = ref<GroupingContent[]>([])
  watch(state, (value) => {
    if (!value) return
    content.value = contentOf(value)
    history.value = []
  }, { immediate: true })

  const loading = computed(() => !content.value || episodesDoc.value === undefined)
  const loadError = computed(() => groupingError.value ?? episodesError.value ?? null)

  const episodes = computed(() => new Map<string, Episode>((episodesDoc.value?.episodes ?? []).map(e => [e.guid, e])))
  const allGuids = computed(() => episodesDoc.value?.episodes.map(e => e.guid) ?? [])

  const playlists = computed<Playlist[]>(() => content.value?.playlists ?? [])
  const playlistById = computed(() => new Map(playlists.value.map(p => [p.id, p])))
  const excluded = computed(() => content.value?.excluded ?? [])
  const unassigned = computed(() => (content.value ? computeUnassigned(content.value, allGuids.value) : []))
  const memberOf = computed(() => (content.value ? membership(content.value) : new Map<string, string[]>()))
  const issues = computed(() => (content.value ? findIssues(content.value, allGuids.value) : []))

  const dirty = computed(() => {
    if (!state.value || !content.value) return false
    return JSON.stringify(content.value) !== JSON.stringify(contentOf(state.value))
  })

  /** Applies a pure operation. Errors (e.g. a stale id) are shown instead of thrown. */
  function apply(operation: (current: GroupingContent) => GroupingContent): boolean {
    if (!content.value) return false
    try {
      const next = operation(content.value)
      history.value = [...history.value.slice(-(MAX_UNDO - 1)), content.value]
      content.value = next
      return true
    } catch (error) {
      toast.add({ title: 'Could not apply the change', description: errorMessage(error), color: 'error', icon: 'i-lucide-circle-x' })
      return false
    }
  }

  function undo() {
    const previous = history.value.at(-1)
    if (!previous) return
    content.value = previous
    history.value = history.value.slice(0, -1)
  }

  function discard() {
    if (state.value) content.value = contentOf(state.value)
    history.value = []
  }

  const saving = ref(false)
  async function save() {
    if (!state.value || !content.value) return
    saving.value = true
    try {
      state.value = await $fetch<GroupingState>('/api/grouping', {
        method: 'PUT',
        body: { revision: state.value.revision, ...content.value }
      })
      toast.add({ title: 'Playlists saved', description: 'Saved to data/grouping.json.', color: 'success', icon: 'i-lucide-check' })
    } catch (error) {
      toast.add({ title: 'Could not save', description: errorMessage(error), color: 'error', icon: 'i-lucide-circle-x' })
    } finally {
      saving.value = false
    }
  }

  const episodeLabel = (guid: string) => episodes.value.get(guid)?.title ?? `Unknown episode (${guid})`

  return {
    state, content, loading, loadError, reloadGrouping,
    episodes, allGuids, playlists, playlistById, excluded, unassigned, memberOf, issues,
    dirty, saving, canUndo: computed(() => history.value.length > 0),
    apply, undo, discard, save, episodeLabel
  }
}

export type GroupingEditor = ReturnType<typeof useGroupingEditor>
export const groupingEditorKey: InjectionKey<GroupingEditor> = Symbol('grouping-editor')

export function useInjectedGroupingEditor(): GroupingEditor {
  const editor = inject(groupingEditorKey)
  if (!editor) throw new Error('useInjectedGroupingEditor() needs a parent that provides the grouping editor.')
  return editor
}
