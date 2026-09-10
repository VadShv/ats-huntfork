<script setup lang="ts">
/**
 * Template picker — canned responses for the composer.
 * Dropdown triggered by a "Templates" button. Shows categories + search.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { FileText, Search, Check } from 'lucide-vue-next'

const props = defineProps<{
  candidateName?: string
  jobTitle?: string
}>()

const emit = defineEmits<{
  insert: [text: string]
  close: []
}>()

const { t } = useI18n()

interface Template {
  id: string
  key: string | null
  title: string
  body: string
  category: string
  isSystem: boolean
}

const templates = ref<Template[]>([])
const loading = ref(true)
const searchQuery = ref('')
const dropdownRoot = ref<HTMLElement | null>(null)
const open = ref(false)

async function fetchTemplates() {
  try {
    const res = await $fetch<Template[]>('/api/message-templates')
    templates.value = res ?? []
  } catch {
    templates.value = []
  } finally {
    loading.value = false
  }
}

onMounted(fetchTemplates)

const filtered = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return templates.value
  return templates.value.filter(t => t.title.toLowerCase().includes(q) || t.body.toLowerCase().includes(q))
})

const categoryLabel = (cat: string) => {
  const map: Record<string, string> = {
    interview: 'Интервью', rejection: 'Отказ', request: 'Запрос', offer: 'Оффер', custom: 'Свои',
  }
  return map[cat] ?? cat
}

function renderTemplate(body: string): string {
  return body
    .replace(/\{\{candidate_name\}\}/g, props.candidateName ?? '')
    .replace(/\{\{job_title\}\}/g, props.jobTitle ?? '')
    .replace(/\{\{deadline\}\}/g, '')
}

function onPick(tpl: Template) {
  emit('insert', renderTemplate(tpl.body))
  open.value = false
  emit('close')
}

function handleDocClick(e: MouseEvent) {
  if (!open.value) return
  if (dropdownRoot.value && !dropdownRoot.value.contains(e.target as Node)) {
    open.value = false
    emit('close')
  }
}
onMounted(() => document.addEventListener('click', handleDocClick))
onBeforeUnmount(() => document.removeEventListener('click', handleDocClick))
</script>

<template>
  <div class="relative" ref="dropdownRoot">
    <button
      type="button"
      class="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer border-0 bg-transparent transition-colors"
      :class="open ? 'bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-200' : ''"
      @click="open = !open"
    >
      <FileText class="size-3" />
      <span class="hidden sm:inline">{{ t('comments.templates') }}</span>
    </button>

    <Transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="opacity-0 scale-95 -translate-y-1"
      enter-to-class="opacity-100 scale-100 translate-y-0"
      leave-active-class="transition duration-75 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="open"
        class="absolute bottom-[calc(100%+4px)] left-0 z-30 w-72 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-lg overflow-hidden"
      >
        <div class="p-2 border-b border-surface-100 dark:border-surface-800">
          <div class="flex items-center gap-1.5">
            <Search class="size-3 text-surface-400" />
            <input
              v-model="searchQuery"
              type="text"
              :placeholder="t('comments.search_placeholder')"
              class="flex-1 bg-transparent text-xs text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none"
            >
          </div>
        </div>
        <ul class="py-1 max-h-64 overflow-y-auto scrollbar-thin">
          <li
            v-for="tpl in filtered"
            :key="tpl.id"
            class="cursor-pointer px-3 py-2 hover:bg-surface-100 dark:hover:bg-surface-800"
            @click="onPick(tpl)"
          >
            <div class="flex items-center gap-1.5">
              <span class="text-xs font-medium text-surface-800 dark:text-surface-200">{{ tpl.title }}</span>
              <span class="rounded bg-surface-100 dark:bg-surface-800 px-1 text-[9px] text-surface-500">{{ categoryLabel(tpl.category) }}</span>
            </div>
            <p class="mt-0.5 truncate text-[10px] text-surface-400">{{ tpl.body }}</p>
          </li>
          <li v-if="!loading && filtered.length === 0" class="px-3 py-3 text-center text-xs text-surface-400">
            Нет шаблонов
          </li>
        </ul>
      </div>
    </Transition>
  </div>
</template>
