<script setup lang="ts">
import { X, AlertTriangle, HelpCircle } from 'lucide-vue-next'

const { state, close } = useConfirm()

function onOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget) close(false)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close(false)
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      leave-active-class="transition-all duration-150 ease-in"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="state.open"
        class="fixed inset-0 z-[200] flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="state.open ? 'confirm-dialog-title' : undefined"
        @click="onOverlayClick"
      >
        <!-- Overlay -->
        <div class="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm" />

        <!-- Card -->
        <Transition
          enter-active-class="transition-all duration-200 ease-out"
          leave-active-class="transition-all duration-150 ease-in"
          enter-from-class="opacity-0 scale-95 translate-y-2"
          enter-to-class="opacity-100 scale-100 translate-y-0"
          leave-from-class="opacity-100 scale-100 translate-y-0"
          leave-to-class="opacity-0 scale-95 translate-y-2"
        >
          <div
            v-if="state.open"
            class="relative z-10 w-full max-w-md rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 shadow-2xl"
          >
            <!-- Accent bar -->
            <div
              class="h-0.5 rounded-t-2xl"
              :class="state.variant === 'danger' ? 'bg-danger-500' : 'bg-brand-500'"
            />

            <div class="p-6">
              <!-- Header -->
              <div class="flex items-start gap-4 mb-4">
                <div
                  class="flex size-10 shrink-0 items-center justify-center rounded-xl"
                  :class="state.variant === 'danger'
                    ? 'bg-danger-50 dark:bg-danger-950'
                    : 'bg-brand-50 dark:bg-brand-950'"
                >
                  <AlertTriangle
                    v-if="state.variant === 'danger'"
                    class="size-5 text-danger-500"
                  />
                  <HelpCircle
                    v-else
                    class="size-5 text-brand-500"
                  />
                </div>
                <div class="flex-1 min-w-0">
                  <h2
                    id="confirm-dialog-title"
                    class="text-base font-semibold text-surface-900 dark:text-surface-100 leading-snug"
                  >
                    {{ state.title }}
                  </h2>
                  <p
                    v-if="state.message"
                    class="mt-1 text-sm text-surface-500 dark:text-surface-400 leading-relaxed"
                  >
                    {{ state.message }}
                  </p>
                </div>
                <button
                  type="button"
                  class="shrink-0 rounded-lg p-1 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                  aria-label="Закрыть"
                  @click="close(false)"
                >
                  <X class="size-4" />
                </button>
              </div>

              <!-- Actions -->
              <div class="flex items-center justify-end gap-2 mt-6">
                <button
                  type="button"
                  class="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors"
                  @click="close(false)"
                >
                  {{ state.cancelLabel ?? 'Отмена' }}
                </button>
                <button
                  type="button"
                  class="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
                  :class="state.variant === 'danger'
                    ? 'bg-danger-600 hover:bg-danger-700'
                    : 'bg-brand-600 hover:bg-brand-700'"
                  @click="close(true)"
                >
                  {{ state.confirmLabel ?? 'Подтвердить' }}
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
