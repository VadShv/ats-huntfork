<script setup lang="ts">
import { Loader2, Inbox } from 'lucide-vue-next'

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
  items: NegotiationItem[]
  loading?: boolean
}>()

const emit = defineEmits<{
  open: [item: NegotiationItem]
  loadMore: []
}>()
</script>

<template>
  <div>
    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center gap-2 py-12 text-surface-400">
      <Loader2 class="size-5 animate-spin" />
      Загрузка откликов…
    </div>

    <!-- Empty -->
    <EmptyState
      v-else-if="items.length === 0"
      :icon="Inbox"
      title="Нет откликов"
      description="Отклики с hh.ru появятся здесь после синхронизации."
    />

    <!-- List -->
    <div v-else class="space-y-3">
      <HhNegotiationCard
        v-for="item in items"
        :key="item.id"
        :item="item"
        @open="emit('open', $event)"
      />
      <div class="flex justify-center pt-2">
        <UiButton variant="outline" size="sm" @click="emit('loadMore')">
          Показать ещё
        </UiButton>
      </div>
    </div>
  </div>
</template>
