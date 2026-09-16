<script setup lang="ts">
import { AlertTriangle, Send } from 'lucide-vue-next'

const props = defineProps<{
  modelValue: boolean
  applicationIds: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  done: []
}>()

const toast = useToast()
const { ask } = useConfirm()
const { runBulk, cancelBulk, current, progress, isRunning } = useHhBulkAction()

const messageText = ref('')
const sendError = ref('')

const total = computed(() => props.applicationIds.length)
const canSend = computed(() => messageText.value.trim().length > 0 && !isRunning.value)

function close() {
  if (isRunning.value) return
  emit('update:modelValue', false)
  messageText.value = ''
  sendError.value = ''
}

async function send() {
  if (!canSend.value) return
  sendError.value = ''

  const confirmed = await ask({
    title: `Отправить ${total.value} сообщений?`,
    message: 'Сообщение будет отправлено через hh.ru каждому выбранному кандидату. Действие нельзя отменить.',
    variant: 'danger',
    confirmLabel: 'Отправить',
  })
  if (!confirmed) return

  try {
    const result = await runBulk({
      actionType: 'send_message',
      targetType: 'application',
      itemIds: props.applicationIds,
      params: { messageText: messageText.value.trim() },
    })

    if (result.failedItems > 0) {
      toast.warning(
        `Отправлено: ${result.succeededItems} из ${result.totalItems}`,
        `Ошибок: ${result.failedItems}`,
      )
    } else {
      toast.success(`Успешно: ${result.succeededItems}`)
    }

    emit('done')
    emit('update:modelValue', false)
    messageText.value = ''
  } catch (err: any) {
    sendError.value = err?.data?.statusMessage ?? err?.message ?? 'Не удалось отправить сообщения'
  }
}
</script>

<template>
  <UiModal
    :model-value="modelValue"
    size="md"
    :close-on-backdrop="!isRunning"
    :close-on-esc="!isRunning"
    :hide-close="isRunning"
    @update:model-value="close"
  >
    <template #header>
      <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">
        Отправить сообщение {{ total }} кандидатам
      </h2>
    </template>

    <!-- Progress -->
    <div v-if="isRunning" class="space-y-3">
      <p class="text-sm text-surface-600 dark:text-surface-300">
        Отправка сообщений... {{ current?.processedItems ?? 0 }}/{{ current?.totalItems ?? total }}
      </p>
      <div class="h-2 w-full rounded-full bg-surface-100 dark:bg-surface-800 overflow-hidden">
        <div
          class="h-full rounded-full bg-brand-500 transition-all duration-300"
          :style="{ width: `${Math.round(progress * 100)}%` }"
        />
      </div>
      <UiButton variant="secondary" size="sm" @click="cancelBulk">
        Отменить операцию
      </UiButton>
    </div>

    <!-- Form -->
    <div v-else class="space-y-4">
      <div
        v-if="sendError"
        class="rounded-lg border border-danger-200 bg-danger-50 dark:bg-danger-950 p-3 text-sm text-danger-700 dark:text-danger-400"
      >
        {{ sendError }}
      </div>

      <UiTextarea
        v-model="messageText"
        label="Сообщение"
        :rows="6"
        placeholder="Здравствуйте! Спасибо за отклик на вакансию..."
        required
      />

      <div
        class="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 dark:bg-warning-950 p-3 text-sm text-warning-700 dark:text-warning-400"
      >
        <AlertTriangle class="size-4 shrink-0 mt-0.5" />
        <span>Будет отправлено через hh.ru каждому кандидату. Действие нельзя отменить.</span>
      </div>
    </div>

    <template #footer>
      <template v-if="!isRunning">
        <UiButton variant="secondary" @click="close">
          Отмена
        </UiButton>
        <UiButton
          variant="primary"
          :icon-left="Send"
          :disabled="!canSend"
          @click="send"
        >
          Отправить
        </UiButton>
      </template>
    </template>
  </UiModal>
</template>
