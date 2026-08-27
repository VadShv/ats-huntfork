<script setup lang="ts">
/**
 * ApplicationHmDecisionCard — панель для рекрутера/админа в карточке заявки.
 * Показывает эффективное решение НМ (кто, когда, комментарий) и кнопку отмены.
 * Скрыта, если решения нет.
 */
import { BadgeCheck, BadgeX, RotateCcw } from 'lucide-vue-next'

interface Props {
  applicationId: string
}
const props = defineProps<Props>()
const emit = defineEmits<{ cancelled: [] }>()

interface HmDecisionResponse {
  decision: null | {
    id: string
    decision: 'approved' | 'rejected'
    decidedAt: string | Date
    comment: string | null
    hm: { userId: string; name: string | null; email: string | null }
  }
}

const { allowed: canCancel } = usePermission({ application: ['update'] })
const toast = useToast()

const { data, pending, refresh } = await useAsyncData<HmDecisionResponse>(
  () => `hm-decision-${props.applicationId}`,
  () => $fetch(`/api/applications/${props.applicationId}/hm-decision`),
  { server: false, watch: [() => props.applicationId] },
)

const isCancelling = ref(false)
const reason = ref('')
const showReason = ref(false)

async function cancel() {
  if (!data.value?.decision) return
  isCancelling.value = true
  try {
    await $fetch(`/api/hm/decisions/${data.value.decision.id}/cancel`, {
      method: 'POST',
      body: { reason: reason.value.trim() || undefined },
    })
    toast.success('Решение НМ отменено', 'Можно вернуть кандидата на предыдущий этап вручную')
    reason.value = ''
    showReason.value = false
    await refresh()
    emit('cancelled')
  }
  catch (err: any) {
    const msg = err?.data?.statusMessage ?? err?.statusMessage ?? err?.message ?? 'Не удалось отменить решение'
    toast.error('Ошибка', { message: String(msg) })
  }
  finally {
    isCancelling.value = false
  }
}
</script>

<template>
  <div v-if="!pending && data?.decision">
    <UiCard
      variant="tinted"
      :tone="data.decision.decision === 'approved' ? 'success' : 'warning'"
    >
      <div class="flex items-start gap-3">
        <component
          :is="data.decision.decision === 'approved' ? BadgeCheck : BadgeX"
          class="mt-0.5 size-5 shrink-0"
        />
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-surface-900 dark:text-surface-100">
            {{ data.decision.decision === 'approved' ? 'Одобрено НМ' : 'Отклонено НМ' }}
          </div>
          <div class="mt-0.5 text-xs text-surface-600 dark:text-surface-400">
            <span v-if="data.decision.hm.name">{{ data.decision.hm.name }}</span>
            <span v-else-if="data.decision.hm.email">{{ data.decision.hm.email }}</span>
            <span v-else>Нанимающий менеджер</span>
            · {{ new Date(data.decision.decidedAt).toLocaleString('ru-RU') }}
          </div>
          <div v-if="data.decision.comment" class="mt-2 whitespace-pre-line text-sm text-surface-700 dark:text-surface-300">
            {{ data.decision.comment }}
          </div>

          <div v-if="canCancel" class="mt-3">
            <template v-if="!showReason">
              <button
                type="button"
                class="inline-flex items-center gap-1.5 text-xs font-medium text-surface-600 underline-offset-2 hover:text-surface-900 hover:underline dark:text-surface-400 dark:hover:text-surface-100"
                @click="showReason = true"
              >
                <RotateCcw class="size-3" />
                Отменить решение
              </button>
            </template>
            <div v-else class="space-y-2">
              <input
                v-model="reason"
                type="text"
                placeholder="Причина отмены (необязательно)"
                class="w-full rounded-md border border-surface-200 bg-white px-2.5 py-1.5 text-xs text-surface-900 placeholder:text-surface-400 focus:border-brand-400 focus:outline-none dark:border-surface-700 dark:bg-surface-900 dark:text-surface-100"
              >
              <div class="flex gap-2">
                <UiButton
                  size="sm"
                  variant="danger"
                  :loading="isCancelling"
                  @click="cancel"
                >
                  Отменить решение
                </UiButton>
                <UiButton
                  size="sm"
                  variant="ghost"
                  :disabled="isCancelling"
                  @click="showReason = false; reason = ''"
                >
                  Не отменять
                </UiButton>
              </div>
              <p class="text-xs text-surface-500 dark:text-surface-400">
                Этап кандидата не откатится автоматически — верните его вручную через
                смену этапа выше.
              </p>
            </div>
          </div>
        </div>
      </div>
    </UiCard>
  </div>
</template>
