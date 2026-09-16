<script setup lang="ts">
import { MessageSquare, ChevronRight } from 'lucide-vue-next'
import { HH_COLLECTION_LABELS } from '~~/shared/hh-collections'

interface NegotiationItem {
  id: string
  hhNegotiationId: string
  hhCollection: string | null
  hhState: string | null
  hhCreatedAt: string | null
  applicationId: string | null
  candidateName: string | null
  applicationStatus: string | null
}

const props = defineProps<{
  item: NegotiationItem
}>()

const emit = defineEmits<{
  open: [item: NegotiationItem]
}>()

const COLLECTION_TONES: Record<string, 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'> = {
  response: 'neutral',
  consider: 'warning',
  phone_interview: 'info',
  assessment: 'info',
  interview: 'info',
  offer: 'brand',
  hired: 'success',
  discard_by_employer: 'danger',
  discard_visible_by_opponent: 'danger',
  discard_after_interview: 'danger',
}

const collectionBadge = computed(() => {
  const c = props.item.hhCollection
  if (!c) return null
  return { label: HH_COLLECTION_LABELS[c] ?? c, tone: COLLECTION_TONES[c] ?? 'neutral' as const }
})

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })
}
</script>

<template>
  <UiCard class="hover:border-surface-300 dark:hover:border-surface-700 transition-colors">
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <h3 class="truncate text-sm font-semibold text-surface-900 dark:text-surface-100">
            {{ item.candidateName ?? 'Без имени' }}
          </h3>
          <UiBadge
            v-if="collectionBadge"
            :tone="collectionBadge.tone"
            size="sm"
          >
            {{ collectionBadge.label }}
          </UiBadge>
        </div>
        <div class="mt-1 flex items-center gap-3 text-xs text-surface-500 dark:text-surface-400">
          <span class="inline-flex items-center gap-1">
            <MessageSquare class="size-3" />
            {{ formatDate(item.hhCreatedAt) }}
          </span>
          <span v-if="item.applicationStatus" class="capitalize">
            {{ item.applicationStatus }}
          </span>
        </div>
      </div>
      <UiButton
        variant="ghost"
        size="sm"
        :icon-right="ChevronRight"
        @click="emit('open', item)"
      >
        Открыть
      </UiButton>
    </div>
  </UiCard>
</template>
