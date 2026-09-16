<script setup lang="ts">
import { Check, X, Minus, RotateCcw } from 'lucide-vue-next'

interface LogItem {
  id: string
  ruleId: string | null
  applicationId: string | null
  negotiationId: string | null
  hhAccountId: string | null
  status: string
  messagePreview: string | null
  error: string | null
  createdAt: string
  candidateFirstName: string | null
  candidateLastName: string | null
}

const props = withDefaults(defineProps<{
  items?: LogItem[]
  total?: number
}>(), {
  items: () => [],
  total: 0,
})

const emit = defineEmits<{
  'retried': []
}>()

const toast = useToast()

const displayItems = ref<LogItem[]>([])
const loadingMore = ref(false)
const retryingId = ref<string | null>(null)

watch(() => props.items, (val) => {
  displayItems.value = [...(val ?? [])]
}, { immediate: true })

const hasMore = computed(() => displayItems.value.length < (props.total ?? 0))

function candidateName(item: LogItem): string {
  const first = item.candidateFirstName ?? ''
  const last = item.candidateLastName ?? ''
  const name = `${first} ${last}`.trim()
  return name || '—'
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const res = await $fetch<{ items: LogItem[], total: number }>('/api/hh/auto-respond/log', {
      query: { limit: 50, offset: displayItems.value.length },
    })
    displayItems.value.push(...res.items)
  }
  catch (err: any) {
    toast.error('Не удалось загрузить ещё записи', {
      message: err?.data?.statusMessage ?? err?.message,
    })
  }
  finally {
    loadingMore.value = false
  }
}

async function retry(item: LogItem) {
  retryingId.value = item.id
  try {
    await $fetch(`/api/hh/auto-respond/log/${item.id}/retry`, { method: 'POST' })
    toast.success('Сообщение отправлено повторно')
    const idx = displayItems.value.findIndex(i => i.id === item.id)
    if (idx !== -1) {
      displayItems.value[idx] = { ...displayItems.value[idx], status: 'sent', error: null }
    }
    emit('retried')
  }
  catch (err: any) {
    toast.error('Не удалось отправить повторно', {
      message: err?.data?.statusMessage ?? err?.message,
    })
  }
  finally {
    retryingId.value = null
  }
}
</script>

<template>
  <div>
    <div v-if="displayItems.length === 0" class="py-8 text-center text-sm text-surface-400 dark:text-surface-500">
      Записей пока нет
    </div>

    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-surface-200 dark:border-surface-800 text-left text-xs text-surface-400 dark:text-surface-500">
            <th class="py-2 pr-3 font-medium">Время</th>
            <th class="py-2 pr-3 font-medium">Кандидат</th>
            <th class="py-2 pr-3 font-medium">Статус</th>
            <th class="py-2 pr-3 font-medium">Сообщение</th>
            <th class="py-2 pr-3 font-medium">Ошибка</th>
            <th class="py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in displayItems"
            :key="item.id"
            class="border-b border-surface-100 dark:border-surface-800/60 align-top"
          >
            <td class="py-2.5 pr-3 whitespace-nowrap text-surface-500 dark:text-surface-400">
              {{ formatTime(item.createdAt) }}
            </td>
            <td class="py-2.5 pr-3 text-surface-700 dark:text-surface-300">
              {{ candidateName(item) }}
            </td>
            <td class="py-2.5 pr-3">
              <span class="inline-flex items-center gap-1">
                <Check
                  v-if="item.status === 'sent'"
                  class="size-4 text-success-600 dark:text-success-400"
                />
                <X
                  v-else-if="item.status === 'failed'"
                  class="size-4 text-danger-600 dark:text-danger-400"
                />
                <Minus
                  v-else
                  class="size-4 text-surface-400 dark:text-surface-500"
                />
                <span class="text-xs text-surface-500 dark:text-surface-400">
                  {{ item.status === 'sent' ? 'Отправлено' : item.status === 'failed' ? 'Ошибка' : 'Пропущено' }}
                </span>
              </span>
            </td>
            <td class="py-2.5 pr-3 max-w-xs">
              <p class="text-surface-600 dark:text-surface-400 line-clamp-2">
                {{ item.messagePreview ?? '—' }}
              </p>
            </td>
            <td class="py-2.5 pr-3 max-w-xs">
              <p
                v-if="item.error"
                class="text-danger-600 dark:text-danger-400 line-clamp-2 text-xs"
              >
                {{ item.error }}
              </p>
              <span v-else class="text-surface-400 dark:text-surface-500">—</span>
            </td>
            <td class="py-2.5 whitespace-nowrap">
              <UiButton
                v-if="item.status === 'failed'"
                variant="ghost"
                size="sm"
                :icon-left="RotateCcw"
                :loading="retryingId === item.id"
                @click="retry(item)"
              >
                Повторить
              </UiButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="hasMore" class="mt-4 flex justify-center">
      <UiButton
        variant="secondary"
        size="sm"
        :loading="loadingMore"
        @click="loadMore"
      >
        Загрузить ещё
      </UiButton>
    </div>
  </div>
</template>
