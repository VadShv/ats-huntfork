<script setup lang="ts">
import { ExternalLink, Briefcase, MapPin, Link2, Search } from 'lucide-vue-next'

interface HhSimilarVacancy {
  id: string
  name: string
  employer: { name: string, id: string }
  area: { name: string } | null
  salary: { from: number | null, to: number | null, currency: string | null } | null
  alternate_url: string
}

const props = defineProps<{ candidateId: string }>()
const emit = defineEmits<{
  createApplication: [vacancy: HhSimilarVacancy]
}>()

const { allowed: canRead } = usePermission({ hhSimilarVacancy: ['read'] })
const { connected } = useHhStatus()

const { data, status } = useFetch<{ items: HhSimilarVacancy[], fromCache: boolean }>(
  '/api/hh/similar-vacancies',
  {
    method: 'POST',
    body: { candidateId: props.candidateId },
    key: 'hh-similar-vac',
    lazy: true,
  },
)

const items = computed(() => data.value?.items ?? [])
const isLoading = computed(() => status.value === 'pending')

function formatSalary(salary: HhSimilarVacancy['salary']): string {
  if (!salary) return ''
  const { from, to, currency } = salary
  const parts: string[] = []
  if (from != null && to != null) {
    parts.push(`${from.toLocaleString('ru-RU')}–${to.toLocaleString('ru-RU')}`)
  }
  else if (from != null) {
    parts.push(`от ${from.toLocaleString('ru-RU')}`)
  }
  else if (to != null) {
    parts.push(`до ${to.toLocaleString('ru-RU')}`)
  }
  if (currency) parts.push(currency)
  return parts.join(' ')
}
</script>

<template>
  <div v-if="canRead && connected" class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-xs dark:shadow-none">
    <div class="flex items-center gap-2.5 px-5 py-4 border-b border-surface-100 dark:border-surface-800">
      <div class="flex items-center justify-center size-7 rounded-lg bg-surface-100 dark:bg-surface-800">
        <Search class="size-3.5 text-surface-500 dark:text-surface-400" />
      </div>
      <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-100">
        Похожие вакансии на hh.ru
      </h2>
      <span v-if="data?.fromCache" class="ml-auto text-[10px] font-medium text-surface-400 dark:text-surface-500">
        из кэша
      </span>
    </div>

    <div v-if="isLoading" class="p-5 space-y-3">
      <div v-for="i in 3" :key="i" class="h-20 rounded-lg bg-surface-100 dark:bg-surface-800 animate-pulse" />
    </div>

    <div v-else-if="items.length > 0" class="p-4 space-y-3">
      <div
        v-for="vac in items"
        :key="vac.id"
        class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 p-4 hover:border-surface-300 dark:hover:border-surface-700 transition-colors"
      >
        <div class="flex items-start justify-between gap-2">
          <a
            :href="vac.alternate_url"
            target="_blank"
            rel="noopener noreferrer"
            class="text-sm font-semibold text-surface-900 dark:text-surface-100 hover:text-brand-600 dark:hover:text-brand-400 transition-colors min-w-0"
          >
            {{ vac.name }}
          </a>
          <a
            :href="vac.alternate_url"
            target="_blank"
            rel="noopener noreferrer"
            class="shrink-0 text-surface-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
            title="На hh.ru"
          >
            <ExternalLink class="size-3.5" />
          </a>
        </div>

        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-surface-500 dark:text-surface-400">
          <span class="inline-flex items-center gap-1">
            <Briefcase class="size-3" />
            {{ vac.employer.name }}
          </span>
          <span v-if="vac.area" class="inline-flex items-center gap-1">
            <MapPin class="size-3" />
            {{ vac.area.name }}
          </span>
          <span v-if="vac.salary && formatSalary(vac.salary)" class="font-medium text-surface-600 dark:text-surface-300">
            {{ formatSalary(vac.salary) }}
          </span>
        </div>

        <div class="mt-3">
          <UiButton
            variant="secondary"
            size="xs"
            :icon-left="Link2"
            @click="emit('createApplication', vac)"
          >
            Связать
          </UiButton>
        </div>
      </div>
    </div>

    <div v-else class="px-5 py-10">
      <EmptyState title="Похожих вакансий не найдено" />
    </div>
  </div>
</template>
