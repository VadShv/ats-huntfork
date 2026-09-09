<script setup lang="ts">
/**
 * Центр аналитики: универсальное модальное окно drill-down.
 * Показывает пагинированный список кандидатов по клику на метрику.
 */
import { X, ChevronLeft, ChevronRight } from 'lucide-vue-next'

const props = defineProps<{
  /** URL эндпоинта drill-down, или null — закрыто. */
  url: string | null
  /** Query-параметры (фильтры + metric). */
  query: Record<string, string>
  title: string
}>()
const emit = defineEmits<{ close: [] }>()

const localePath = useLocalePath()
const { formatPersonName, formatDateTime } = useOrgSettings()

const page = ref(1)
watch(() => props.url, () => { page.value = 1 })

const { data, status } = useFetch(() => props.url ?? '', {
  key: computed(() => `drilldown-${props.url}-${JSON.stringify(props.query)}-${page.value}`),
  headers: useRequestHeaders(['cookie']),
  query: computed(() => ({ ...props.query, page: String(page.value), limit: '25' })),
  immediate: false,
  watch: [() => props.url, () => props.query, page],
})

const items = computed<any[]>(() => (data.value as any)?.items ?? [])
const total = computed(() => (data.value as any)?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / 25)))
const isLoading = computed(() => status.value === 'pending')

function onKeydown(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="url" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="emit('close')" />
      <div class="relative w-full max-w-lg max-h-[80vh] bg-white dark:bg-surface-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div class="px-5 py-4 border-b border-surface-100 dark:border-surface-800 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-50">
            {{ title }} <span class="text-surface-400 font-normal">({{ total }})</span>
          </h2>
          <button class="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300" @click="emit('close')">
            <X class="w-4 h-4" />
          </button>
        </div>

        <div v-if="isLoading" class="p-5 space-y-3">
          <div v-for="i in 4" :key="i" class="h-10 bg-surface-100 dark:bg-surface-800/60 rounded-lg animate-pulse" />
        </div>
        <div v-else-if="!items.length" class="p-8 text-center text-sm text-surface-400">Нет кандидатов</div>
        <template v-else>
          <ul class="divide-y divide-surface-100 dark:divide-surface-800 overflow-y-auto flex-1">
            <li v-for="item in items" :key="item.applicationId">
              <NuxtLink :to="localePath(`/dashboard/applications/${item.applicationId}`)" class="flex items-center gap-3 px-5 py-3 hover:bg-surface-50 dark:hover:bg-surface-800/50">
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">
                    {{ formatPersonName(item.candidateFirstName, item.candidateLastName) }}
                  </p>
                  <p class="text-xs text-surface-500 dark:text-surface-400 truncate">
                    {{ item.stageName }}<span v-if="item.jobTitle"> · {{ item.jobTitle }}</span>
                  </p>
                </div>
                <span v-if="item.changedAt" class="text-xs text-surface-400 shrink-0">{{ formatDateTime(item.changedAt) }}</span>
              </NuxtLink>
            </li>
          </ul>
          <div v-if="pages > 1" class="px-5 py-3 border-t border-surface-100 dark:border-surface-800 flex items-center justify-between">
            <button class="inline-flex items-center gap-1 text-xs font-medium text-surface-600 dark:text-surface-400 disabled:opacity-40" :disabled="page <= 1" @click="page--">
              <ChevronLeft class="w-3.5 h-3.5" /> Назад
            </button>
            <span class="text-xs text-surface-400 tabular-nums">{{ page }} / {{ pages }}</span>
            <button class="inline-flex items-center gap-1 text-xs font-medium text-surface-600 dark:text-surface-400 disabled:opacity-40" :disabled="page >= pages" @click="page++">
              Вперёд <ChevronRight class="w-3.5 h-3.5" />
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>
